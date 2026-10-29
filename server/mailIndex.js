import { messageReferences } from "./threading.js";
import { decrypt, encrypt } from "./security.js";
const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
const FETCH_BATCH_SIZE = 200;
const pendingSyncs = new Map();
export async function indexedMessages(database, accountId, folder) {
  return (
    await database
      .prepare(
        "SELECT data_enc FROM mail_index_messages WHERE account_id=? AND folder=?",
      )
      .all(accountId, folder)
  ).map((row) => JSON.parse(decrypt(row.data_enc)));
}
export async function clearAccountIndex(database, accountId) {
  await database
    .prepare("DELETE FROM mail_index_messages WHERE account_id=?")
    .run(accountId);
  await database
    .prepare("DELETE FROM mail_index_folders WHERE account_id=?")
    .run(accountId);
}
export async function clearFolderIndex(database, accountId, folder) {
  await database
    .prepare("DELETE FROM mail_index_messages WHERE account_id=? AND folder=?")
    .run(accountId, folder);
  await database
    .prepare("DELETE FROM mail_index_folders WHERE account_id=? AND folder=?")
    .run(accountId, folder);
}
export async function updateIndexedFlags(
  database,
  accountId,
  folder,
  uid,
  flags,
) {
  const row = await database
    .prepare(
      "SELECT data_enc FROM mail_index_messages WHERE account_id=? AND folder=? AND uid=?",
    )
    .get(accountId, folder, uid);
  if (!row) return;
  const message = JSON.parse(decrypt(row.data_enc));
  if (flags.seen !== undefined) message.seen = !!flags.seen;
  if (flags.flagged !== undefined) message.flagged = !!flags.flagged;
  await database
    .prepare(
      "UPDATE mail_index_messages SET data_enc=? WHERE account_id=? AND folder=? AND uid=?",
    )
    .run(encrypt(JSON.stringify(message)), accountId, folder, uid);
}
export async function markIndexedFolderRead(database, accountId, folder) {
  const rows = await database
    .prepare(
      "SELECT uid,data_enc FROM mail_index_messages WHERE account_id=? AND folder=?",
    )
    .all(accountId, folder);
  const update = database.prepare(
    "UPDATE mail_index_messages SET data_enc=? WHERE account_id=? AND folder=? AND uid=?",
  );
  await database.transaction(async () => {
    for (const row of rows) {
      const message = JSON.parse(decrypt(row.data_enc));
      if (!message.seen) {
        message.seen = true;
        await update.run(
          encrypt(JSON.stringify(message)),
          accountId,
          folder,
          row.uid,
        );
      }
    }
  });
}
export async function removeIndexedMessage(database, accountId, folder, uid) {
  await database
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
    {
      uid: true,
      ...options,
    },
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
  const previous = await database
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
        ? (await client.search(
            {
              all: true,
            },
            {
              uid: true,
            },
          )) || []
        : [];
      const known = new Set(
        (
          await database
            .prepare(
              "SELECT uid FROM mail_index_messages WHERE account_id=? AND folder=?",
            )
            .all(accountId, folder)
        ).map((row) => row.uid),
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
        {
          uid: true,
          flags: true,
        },
        modseqChanged
          ? {
              uid: true,
              changedSince: BigInt(previous.highest_modseq),
            }
          : {
              uid: true,
            },
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
    "INSERT INTO mail_index_messages (account_id,folder,uid,data_enc) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE data_enc=VALUES(data_enc)",
  );
  const update = database.prepare(
    "UPDATE mail_index_messages SET data_enc=? WHERE account_id=? AND folder=? AND uid=?",
  );
  await database.transaction(async () => {
    if (reset) await clearFolderIndex(database, accountId, folder);
    if (currentUids) {
      const live = new Set(currentUids);
      const rows = await database
        .prepare(
          "SELECT uid FROM mail_index_messages WHERE account_id=? AND folder=?",
        )
        .all(accountId, folder);
      const remove = database.prepare(
        "DELETE FROM mail_index_messages WHERE account_id=? AND folder=? AND uid=?",
      );
      for (const row of rows)
        if (!live.has(row.uid)) await remove.run(accountId, folder, row.uid);
    }
    for (const message of messages)
      await insert.run(
        accountId,
        folder,
        message.uid,
        encrypt(JSON.stringify(message)),
      );
    for (const flag of flags) {
      const row = await database
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
      await update.run(
        encrypt(JSON.stringify(message)),
        accountId,
        folder,
        flag.uid,
      );
    }
    await database
      .prepare(
        "INSERT INTO mail_index_folders (account_id,folder,uid_validity,uid_next,exists_count,highest_modseq,reconciled_at) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE uid_validity=VALUES(uid_validity),uid_next=VALUES(uid_next),exists_count=VALUES(exists_count),highest_modseq=VALUES(highest_modseq),reconciled_at=VALUES(reconciled_at)",
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
  });
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
