import { messageReferences } from "./threading.js";
import { decrypt, encrypt } from "./security.js";

const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
const FETCH_BATCH_SIZE = 200;
const pendingSyncs = new Map();

export function initializeMailIndex(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS mail_index_folders (
      account_id INTEGER NOT NULL, folder TEXT NOT NULL,
      uid_validity TEXT NOT NULL, uid_next INTEGER NOT NULL,
      exists_count INTEGER NOT NULL, highest_modseq TEXT,
      reconciled_at INTEGER NOT NULL,
      PRIMARY KEY (account_id, folder)
    );
    CREATE TABLE IF NOT EXISTS mail_index_messages (
      account_id INTEGER NOT NULL, folder TEXT NOT NULL, uid INTEGER NOT NULL,
      data_enc TEXT NOT NULL,
      PRIMARY KEY (account_id, folder, uid)
    );
  `);
}

export function indexedMessages(database, accountId, folder) {
  return database
    .prepare(
      "SELECT data_enc FROM mail_index_messages WHERE account_id=? AND folder=?",
    )
    .all(accountId, folder)
    .map((row) => JSON.parse(decrypt(row.data_enc)));
}

export function clearAccountIndex(database, accountId) {
  database
    .prepare("DELETE FROM mail_index_messages WHERE account_id=?")
    .run(accountId);
  database
    .prepare("DELETE FROM mail_index_folders WHERE account_id=?")
    .run(accountId);
}

export function clearFolderIndex(database, accountId, folder) {
  database
    .prepare("DELETE FROM mail_index_messages WHERE account_id=? AND folder=?")
    .run(accountId, folder);
  database
    .prepare("DELETE FROM mail_index_folders WHERE account_id=? AND folder=?")
    .run(accountId, folder);
}

export function updateIndexedFlags(database, accountId, folder, uid, flags) {
  const row = database
    .prepare(
      "SELECT data_enc FROM mail_index_messages WHERE account_id=? AND folder=? AND uid=?",
    )
    .get(accountId, folder, uid);
  if (!row) return;
  const message = JSON.parse(decrypt(row.data_enc));
  if (flags.seen !== undefined) message.seen = !!flags.seen;
  if (flags.flagged !== undefined) message.flagged = !!flags.flagged;
  database
    .prepare(
      "UPDATE mail_index_messages SET data_enc=? WHERE account_id=? AND folder=? AND uid=?",
    )
    .run(encrypt(JSON.stringify(message)), accountId, folder, uid);
}

export function markIndexedFolderRead(database, accountId, folder) {
  const rows = database
    .prepare(
      "SELECT uid,data_enc FROM mail_index_messages WHERE account_id=? AND folder=?",
    )
    .all(accountId, folder);
  const update = database.prepare(
    "UPDATE mail_index_messages SET data_enc=? WHERE account_id=? AND folder=? AND uid=?",
  );
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) {
      const message = JSON.parse(decrypt(row.data_enc));
      if (!message.seen) {
        message.seen = true;
        update.run(
          encrypt(JSON.stringify(message)),
          accountId,
          folder,
          row.uid,
        );
      }
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function removeIndexedMessage(database, accountId, folder, uid) {
  database
    .prepare(
      "DELETE FROM mail_index_messages WHERE account_id=? AND folder=? AND uid=?",
    )
    .run(accountId, folder, uid);
}

function indexedMessage(item, summarize) {
  const { size, hasAttachments, ...base } = summarize(item);
  return {
    ...base,
    messageId: item.envelope?.messageId || "",
    inReplyTo: item.envelope?.inReplyTo || "",
    references: messageReferences(item.headers),
    threadId: item.threadId == null ? null : String(item.threadId),
  };
}

async function fetchIndexMessages(client, range, summarize, options = {}) {
  const messages = [];
  for await (const item of client.fetch(
    range,
    {
      uid: true,
      envelope: true,
      flags: true,
      internalDate: true,
      headers: ["references"],
      threadId: true,
    },
    { uid: true, ...options },
  )) {
    messages.push(indexedMessage(item, summarize));
  }
  return messages;
}

async function performSync(database, accountId, folder, client, summarize) {
  const mailbox = client.mailbox;
  const uidValidity = String(mailbox.uidValidity ?? "");
  const uidNext = Number(mailbox.uidNext || 1);
  const exists = Number(mailbox.exists || 0);
  const modseq = mailbox.highestModseq?.toString() || null;
  const supportsChanges =
    !!modseq && client.enabled.has("CONDSTORE") && !mailbox.noModseq;
  const previous = database
    .prepare("SELECT * FROM mail_index_folders WHERE account_id=? AND folder=?")
    .get(accountId, folder);
  const reset = !previous || previous.uid_validity !== uidValidity;
  const now = Date.now();
  const reconcile =
    reset ||
    previous.uid_next !== uidNext ||
    previous.exists_count !== exists ||
    now - previous.reconciled_at >= RECONCILE_INTERVAL_MS;
  const modseqChanged =
    !reset &&
    supportsChanges &&
    previous.highest_modseq &&
    BigInt(modseq) > BigInt(previous.highest_modseq);
  if (!reconcile && !modseqChanged) return;
  let messages = [];
  let currentUids = null;
  let flags = [];

  if (reset) {
    if (exists) messages = await fetchIndexMessages(client, "1:*", summarize);
  } else {
    if (reconcile) {
      currentUids = exists
        ? (await client.search({ all: true }, { uid: true })) || []
        : [];
      const known = new Set(
        database
          .prepare(
            "SELECT uid FROM mail_index_messages WHERE account_id=? AND folder=?",
          )
          .all(accountId, folder)
          .map((row) => row.uid),
      );
      const missing = currentUids.filter((uid) => !known.has(uid));
      for (let start = 0; start < missing.length; start += FETCH_BATCH_SIZE) {
        messages.push(
          ...(await fetchIndexMessages(
            client,
            missing.slice(start, start + FETCH_BATCH_SIZE),
            summarize,
          )),
        );
      }
    }
    if (modseqChanged || (reconcile && !supportsChanges)) {
      for await (const item of client.fetch(
        "1:*",
        { uid: true, flags: true },
        modseqChanged
          ? { uid: true, changedSince: BigInt(previous.highest_modseq) }
          : { uid: true },
      )) {
        flags.push({
          uid: item.uid,
          seen: item.flags?.has("\\Seen") || false,
          flagged: item.flags?.has("\\Flagged") || false,
        });
      }
    }
  }

  const insert = database.prepare(
    "INSERT OR REPLACE INTO mail_index_messages (account_id,folder,uid,data_enc) VALUES (?,?,?,?)",
  );
  const update = database.prepare(
    "UPDATE mail_index_messages SET data_enc=? WHERE account_id=? AND folder=? AND uid=?",
  );
  database.exec("BEGIN IMMEDIATE");
  try {
    if (reset) clearFolderIndex(database, accountId, folder);
    if (currentUids) {
      const live = new Set(currentUids);
      const rows = database
        .prepare(
          "SELECT uid FROM mail_index_messages WHERE account_id=? AND folder=?",
        )
        .all(accountId, folder);
      const remove = database.prepare(
        "DELETE FROM mail_index_messages WHERE account_id=? AND folder=? AND uid=?",
      );
      for (const row of rows)
        if (!live.has(row.uid)) remove.run(accountId, folder, row.uid);
    }
    for (const message of messages)
      insert.run(
        accountId,
        folder,
        message.uid,
        encrypt(JSON.stringify(message)),
      );
    for (const flag of flags) {
      const row = database
        .prepare(
          "SELECT data_enc FROM mail_index_messages WHERE account_id=? AND folder=? AND uid=?",
        )
        .get(accountId, folder, flag.uid);
      if (!row) continue;
      const message = JSON.parse(decrypt(row.data_enc));
      if (message.seen === flag.seen && message.flagged === flag.flagged)
        continue;
      message.seen = flag.seen;
      message.flagged = flag.flagged;
      update.run(encrypt(JSON.stringify(message)), accountId, folder, flag.uid);
    }
    database
      .prepare(
        "INSERT OR REPLACE INTO mail_index_folders (account_id,folder,uid_validity,uid_next,exists_count,highest_modseq,reconciled_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        accountId,
        folder,
        uidValidity,
        uidNext,
        exists,
        modseq,
        reconcile ? now : previous.reconciled_at,
      );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export async function syncThreadIndex(
  database,
  accountId,
  folder,
  client,
  summarize,
) {
  const key = JSON.stringify([accountId, folder]);
  if (pendingSyncs.has(key)) return pendingSyncs.get(key);
  const pending = performSync(database, accountId, folder, client, summarize);
  pendingSyncs.set(key, pending);
  try {
    await pending;
  } finally {
    if (pendingSyncs.get(key) === pending) pendingSyncs.delete(key);
  }
}
