import {
  groupMessages,
  messageReferences,
  summarizeThread,
} from "./threading.js";
import { decrypt, encrypt } from "./security.js";
const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
const FETCH_BATCH_SIZE = 200;
const CACHED_FOLDERS = 3;
const states = new WeakMap();
const indexKey = (accountId, folder) => JSON.stringify([accountId, folder]);

function stateFor(database) {
  let state = states.get(database);
  if (!state) {
    state = {
      projections: new Map(),
      pendingProjections: new Map(),
      projectionVersions: new Map(),
      pendingSyncs: new Map(),
    };
    states.set(database, state);
  }
  return state;
}

function invalidateProjection(database, accountId, folder) {
  const { projections, pendingProjections, projectionVersions } =
    stateFor(database);
  const key = indexKey(accountId, folder);
  if (pendingProjections.has(key))
    projectionVersions.set(key, (projectionVersions.get(key) || 0) + 1);
  else projectionVersions.delete(key);
  projections.delete(key);
}

export function clearThreadProjections(database) {
  const { projections, pendingProjections, projectionVersions } =
    stateFor(database);
  for (const key of new Set([
    ...projections.keys(),
    ...pendingProjections.keys(),
    ...projectionVersions.keys(),
  ]))
    invalidateProjection(database, ...JSON.parse(key));
}

function projectionVariant(groups) {
  const entries = groups.map((group) =>
    group.thread.map((member) => member.uid),
  );
  const byUid = new Map();
  entries.forEach((uids, index) => {
    for (const uid of uids) byUid.set(uid, index);
  });
  return { entries, byUid };
}

async function threadProjection(database, accountId, folder) {
  const { projections, pendingProjections, projectionVersions } =
    stateFor(database);
  const key = indexKey(accountId, folder);
  for (;;) {
    const version = projectionVersions.get(key) || 0;
    const cached = projections.get(key);
    if (cached?.version === version) {
      projections.delete(key);
      projections.set(key, cached);
      return cached;
    }
    let pending = pendingProjections.get(key);
    if (!pending || pending.version !== version) {
      const promise = indexedMessages(database, accountId, folder).then(
        (items) => ({
          normal: projectionVariant(groupMessages(items)),
          unread: projectionVariant(groupMessages(items, { unreadOnly: true })),
          count: items.length,
          unreadCount: items.filter((item) => !item.seen).length,
          version,
        }),
      );
      pending = { version, promise };
      pendingProjections.set(key, pending);
    }
    try {
      const result = await pending.promise;
      if ((projectionVersions.get(key) || 0) !== version) continue;
      projections.set(key, result);
      while (projections.size > CACHED_FOLDERS) {
        const oldest = projections.keys().next().value;
        projections.delete(oldest);
        if (!pendingProjections.has(oldest)) projectionVersions.delete(oldest);
      }
      return result;
    } finally {
      if (pendingProjections.get(key) === pending)
        pendingProjections.delete(key);
    }
  }
}

export async function indexedThreadPage(
  database,
  accountId,
  folder,
  { page, pageSize, matches = null, unreadOnly = false },
) {
  const projection = await threadProjection(database, accountId, folder);
  const variant = unreadOnly ? projection.unread : projection.normal;
  const matchingIndexes = matches
    ? [
        ...new Set(
          matches
            .map((uid) => variant.byUid.get(uid))
            .filter((index) => index !== undefined),
        ),
      ].sort((a, b) => a - b)
    : null;
  const total = matchingIndexes?.length ?? variant.entries.length;
  const indexes = matchingIndexes
    ? matchingIndexes.slice(page * pageSize, (page + 1) * pageSize)
    : Array.from(
        { length: Math.max(0, Math.min(pageSize, total - page * pageSize)) },
        (_, index) => page * pageSize + index,
      );
  const entries = indexes.map((index) => variant.entries[index]);
  const uids = entries.flat();
  const indexedByUid = new Map();
  for (let start = 0; start < uids.length; start += FETCH_BATCH_SIZE) {
    const batch = uids.slice(start, start + FETCH_BATCH_SIZE);
    const rows = await database
      .prepare(
        `SELECT uid,data_enc FROM mail_index_messages WHERE account_id=? AND folder=? AND uid IN (${batch.map(() => "?").join(",")})`,
      )
      .all(accountId, folder, ...batch);
    for (const row of rows)
      indexedByUid.set(row.uid, JSON.parse(decrypt(row.data_enc)));
  }
  const messages = entries
    .map((entry) => entry.map((uid) => indexedByUid.get(uid)).filter(Boolean))
    .filter((members) => members.length)
    .map(summarizeThread);
  return {
    messages,
    indexedByUid,
    total,
    messageTotal: matches
      ? matches.length
      : unreadOnly
        ? projection.unreadCount
        : projection.count,
  };
}
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
  const { projections, pendingProjections, projectionVersions } =
    stateFor(database);
  for (const key of new Set([
    ...projections.keys(),
    ...pendingProjections.keys(),
    ...projectionVersions.keys(),
  ]))
    if (String(JSON.parse(key)[0]) === String(accountId))
      invalidateProjection(database, ...JSON.parse(key));
}
export async function clearFolderIndex(database, accountId, folder) {
  await database
    .prepare("DELETE FROM mail_index_messages WHERE account_id=? AND folder=?")
    .run(accountId, folder);
  await database
    .prepare("DELETE FROM mail_index_folders WHERE account_id=? AND folder=?")
    .run(accountId, folder);
  invalidateProjection(database, accountId, folder);
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
  const originalSeen = message.seen;
  const originalFlagged = message.flagged;
  if (flags.seen !== undefined) message.seen = !!flags.seen;
  if (flags.flagged !== undefined) message.flagged = !!flags.flagged;
  if (message.seen === originalSeen && message.flagged === originalFlagged)
    return;
  await database
    .prepare(
      "UPDATE mail_index_messages SET data_enc=? WHERE account_id=? AND folder=? AND uid=?",
    )
    .run(encrypt(JSON.stringify(message)), accountId, folder, uid);
  invalidateProjection(database, accountId, folder);
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
  let changed = false;
  await database.transaction(async () => {
    for (const row of rows) {
      const message = JSON.parse(decrypt(row.data_enc));
      if (!message.seen) {
        changed = true;
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
  if (changed) invalidateProjection(database, accountId, folder);
}
export async function removeIndexedMessage(database, accountId, folder, uid) {
  await database
    .prepare(
      "DELETE FROM mail_index_messages WHERE account_id=? AND folder=? AND uid=?",
    )
    .run(accountId, folder, uid);
  invalidateProjection(database, accountId, folder);
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
async function* fetchIndexBatches(client, range, summarize, options = {}) {
  let messages = [];
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
    if (messages.length === FETCH_BATCH_SIZE) {
      yield messages;
      messages = [];
    }
  }
  if (messages.length) yield messages;
}
async function storeIndexBatch(database, accountId, folder, messages) {
  const placeholders = messages.map(() => "(?,?,?,?)").join(",");
  await database
    .prepare(
      `INSERT INTO mail_index_messages (account_id,folder,uid,data_enc) VALUES ${placeholders} ON DUPLICATE KEY UPDATE data_enc=VALUES(data_enc)`,
    )
    .run(
      ...messages.flatMap((message) => [
        accountId,
        folder,
        message.uid,
        encrypt(JSON.stringify(message)),
      ]),
    );
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
  let indexChanged = reset;
  let currentUids = null;
  let flags = [];
  if (reset) {
    // Leave folder metadata unset until all batches arrive. A failed fetch is
    // retried as a reset, so a partial index is never treated as complete.
    await clearFolderIndex(database, accountId, folder);
    if (exists)
      for await (const batch of fetchIndexBatches(client, "1:*", summarize))
        await storeIndexBatch(database, accountId, folder, batch);
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
      if (missing.length) indexChanged = true;
      for (let start = 0; start < missing.length; start += FETCH_BATCH_SIZE) {
        for await (const batch of fetchIndexBatches(
          client,
          missing.slice(start, start + FETCH_BATCH_SIZE),
          summarize,
        ))
          await storeIndexBatch(database, accountId, folder, batch);
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
  const update = database.prepare(
    "UPDATE mail_index_messages SET data_enc=? WHERE account_id=? AND folder=? AND uid=?",
  );
  await database.transaction(async () => {
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
        if (!live.has(row.uid)) {
          indexChanged = true;
          await remove.run(accountId, folder, row.uid);
        }
    }
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
      indexChanged = true;
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
  if (indexChanged) invalidateProjection(database, accountId, folder);
}
export async function syncThreadIndex(
  database,
  accountId,
  folder,
  client,
  summarize,
) {
  const { pendingSyncs } = stateFor(database);
  const key = indexKey(accountId, folder);
  if (pendingSyncs.has(key)) return pendingSyncs.get(key);
  const pending = performSync(database, accountId, folder, client, summarize);
  pendingSyncs.set(key, pending);
  try {
    await pending;
  } finally {
    if (pendingSyncs.get(key) === pending) pendingSyncs.delete(key);
  }
}
