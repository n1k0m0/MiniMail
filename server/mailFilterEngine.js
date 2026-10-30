import crypto from "node:crypto";
import {
  loadMailRules,
  changeMailRules,
  changeMailRuleState,
  mailboxOperation,
  assertNoFolderOperation,
  MailRuleError,
  assertCurrentMailbox,
} from "./mailRuleStore.js";
import { ruleMatches } from "./mailFilterRules.js";
import {
  reconcileFolderDelete,
  allRemoteFolders,
  sameFolder,
} from "./folderActions.js";
import { removeIndexedMessage, updateIndexedFlags } from "./mailIndex.js";
import { requireMailResult } from "./mailActions.js";

const batchSize = 60;
export async function initializeFilterCursor(client) {
  const status = await client.status("INBOX", {
    uidValidity: true,
    uidNext: true,
  });
  if (!status)
    throw new MailRuleError(
      "Der Posteingang konnte nicht geprüft werden.",
      502,
    );
  return {
    validity: String(status.uidValidity),
    lastUid: Math.max(0, Number(status.uidNext || 1) - 1),
  };
}
export async function startFilterJob(db, account, client, folder, ruleIds) {
  const config = await loadMailRules(db, account.id);
  assertNoFolderOperation(config);
  if (config.job?.state === "running")
    throw new MailRuleError("Ein Filterlauf läuft bereits.", 409);
  if (
    typeof folder !== "string" ||
    !folder ||
    folder.length > 700 ||
    /[\x00-\x1f\x7f]/.test(folder)
  )
    throw new MailRuleError("Ungültiger Quellordner.");
  const ids =
    Array.isArray(ruleIds) && ruleIds.length
      ? ruleIds
      : config.rules.filter((rule) => rule.enabled).map((rule) => rule.id);
  if (
    !ids.length ||
    ids.length > 100 ||
    ids.some(
      (id) => !config.rules.some((rule) => rule.id === id && rule.enabled),
    )
  )
    throw new MailRuleError(
      "Bitte mindestens einen aktivierten Filter auswählen.",
    );
  const status = await client.status(folder, {
    uidValidity: true,
    uidNext: true,
    messages: true,
  });
  if (!status)
    throw new MailRuleError(
      "Der Quellordner konnte nicht geprüft werden.",
      502,
    );
  return changeMailRules(db, account.id, (current) => {
    if (current.pendingMessage)
      throw new MailRuleError(
        "Bitte die begonnene Filteraktion zuerst fortsetzen oder abbrechen.",
        409,
      );
    current.job = {
      id: crypto.randomUUID(),
      state: "running",
      folder,
      ruleIds: ids,
      validity: String(status.uidValidity),
      upperUid: Math.max(0, Number(status.uidNext || 1) - 1),
      lastUid: 0,
      processed: 0,
      matched: 0,
      moved: 0,
      total: Number(status.messages || 0),
      startedAt: Date.now(),
      error: "",
    };
  });
}
async function processBatch(
  db,
  account,
  client,
  config,
  { manual = false, beforeMove } = {},
) {
  const job = manual ? config.job : null;
  const folder = job?.folder || "INBOX";
  const rules = config.rules.filter(
    (rule) => rule.enabled && (!manual || job.ruleIds.includes(rule.id)),
  );
  if (!rules.length) return { idle: true };
  const folders = await allRemoteFolders(client);
  if (
    rules.some(
      (rule) => rule.actions.moveTo && !sameFolder(rule.actions.moveTo, folder),
    ) &&
    !client.capabilities?.has("MOVE")
  )
    throw new MailRuleError(
      "Dieser Mailserver unterstützt kein sicheres IMAP MOVE. Verschiebefilter werden nicht ausgeführt; bitte nur Statusaktionen verwenden oder IMAP MOVE auf dem Server aktivieren.",
      409,
    );
  for (const rule of rules)
    if (
      rule.actions.moveTo &&
      !folders.some((folder) => sameFolder(folder.path, rule.actions.moveTo))
    )
      throw new MailRuleError(
        `Der Zielordner des Filters „${rule.name}“ fehlt. Bitte den Filter bearbeiten.`,
        409,
      );
  const lock = await client.getMailboxLock(folder);
  try {
    const validity = String(client.mailbox.uidValidity),
      upper = manual
        ? job.upperUid
        : Math.max(0, Number(client.mailbox.uidNext || 1) - 1);
    if (manual && validity !== job.validity)
      throw new MailRuleError(
        "Der Quellordner hat sich geändert. Bitte den Filterlauf neu starten.",
        409,
      );
    if (!manual && (!config.cursor || config.cursor.validity !== validity)) {
      await changeMailRuleState(db, account.id, (current) => {
        current.cursor = { validity, lastUid: upper };
        current.lastError = "";
        current.pendingMessage = null;
      });
      return { initialized: true };
    }
    const last = manual ? job.lastUid : config.cursor.lastUid;
    if (last >= upper) {
      if (manual)
        await changeMailRuleState(db, account.id, (current) => {
          current.job = {
            ...current.job,
            state: "completed",
            finishedAt: Date.now(),
          };
        });
      return { done: true };
    }
    // UID ranges containing '*' can unexpectedly include older messages. Use
    // a fixed upper bound and discard UIDs outside the requested interval.
    const found = (
      (await client.search({ uid: `${last + 1}:${upper}` }, { uid: true })) ||
      []
    )
      .filter((uid) => Number.isSafeInteger(uid) && uid > last && uid <= upper)
      .sort((a, b) => a - b);
    const pending = config.pendingMessage;
    if (
      pending &&
      (pending.folder !== folder ||
        pending.validity !== validity ||
        pending.revision !== config.revision ||
        pending.jobId !== (job?.id || null))
    )
      throw new MailRuleError(
        "Eine begonnene Filteraktion passt nicht mehr zu diesem Lauf. Bitte den Lauf abbrechen und neu starten.",
        409,
      );
    const allUids = [...new Set([...found, ...(pending ? [pending.uid] : [])])]
      .filter((uid) => uid > last && uid <= upper)
      .sort((a, b) => a - b);
    const uids = allUids.slice(0, batchSize);
    if (!uids.length) {
      await changeMailRuleState(db, account.id, (current) => {
        if (manual)
          current.job = {
            ...current.job,
            lastUid: upper,
            state: "completed",
            finishedAt: Date.now(),
          };
        else current.cursor = { validity, lastUid: upper };
        current.lastError = "";
      });
      return { done: true };
    }
    const bodyMatches = new Map();
    for (const condition of rules
      .flatMap((rule) => rule.conditions)
      .filter((condition) => condition.field === "body")) {
      if (bodyMatches.has(condition.value)) continue;
      bodyMatches.set(
        condition.value,
        new Set(
          (await client.search(
            { uid: uids.join(","), body: condition.value },
            { uid: true },
          )) || [],
        ),
      );
    }
    const fetched = await client.fetchAll(
      uids,
      {
        uid: true,
        envelope: true,
        flags: true,
        bodyStructure: true,
        size: true,
      },
      { uid: true },
    );
    const messages = new Map(fetched.map((message) => [message.uid, message]));
    let matched = 0,
      moved = 0,
      processed = 0;
    for (const uid of uids) {
      const message = messages.get(uid);
      let plan = pending?.uid === uid ? pending : null;
      if (!plan && message) {
        const simulated = { ...message, flags: new Set(message.flags || []) };
        const flags = {};
        let hit = false,
          moveTo = null;
        for (const rule of rules) {
          if (!ruleMatches(rule, simulated, bodyMatches)) continue;
          hit = true;
          for (const [property, flag] of [
            ["seen", "\\Seen"],
            ["flagged", "\\Flagged"],
          ])
            if (rule.actions[property] !== null) {
              flags[property] = rule.actions[property];
              rule.actions[property]
                ? simulated.flags.add(flag)
                : simulated.flags.delete(flag);
            }
          if (rule.actions.moveTo && !sameFolder(rule.actions.moveTo, folder)) {
            moveTo = rule.actions.moveTo;
            break;
          }
          if (rule.stop) break;
        }
        if (hit) {
          plan = {
            id: crypto.randomUUID(),
            uid,
            folder,
            validity,
            revision: config.revision,
            jobId: job?.id || null,
            flags,
            moveTo,
          };
          await changeMailRuleState(db, account.id, (current) => {
            current.pendingMessage = plan;
          });
        }
      }
      // Pin the activity through remote mutations. A database restore waits
      // for this transaction instead of letting an old worker mutate IMAP
      // after restored credentials and journals have become authoritative.
      // Calendar imports commit before MOVE; a lost MOVE reply must not roll
      // them back after the source message has disappeared.
      if (plan?.moveTo && message && beforeMove)
        await beforeMove(client, folder, message);
      await db.transaction(async () => {
        const hit = !!plan;
        let didMove = false;
        if (plan && message) {
          for (const [property, enabled] of Object.entries(plan.flags)) {
            const flag = property === "seen" ? "\\Seen" : "\\Flagged";
            requireMailResult(
              await (enabled
                ? client.messageFlagsAdd(uid, [flag], { uid: true })
                : client.messageFlagsRemove(uid, [flag], { uid: true })),
              "Ein Nachrichtenstatus konnte nicht geändert werden.",
            );
          }
          if (Object.keys(plan.flags).length)
            await updateIndexedFlags(db, account.id, folder, uid, plan.flags);
          if (plan.moveTo) {
            requireMailResult(
              await client.messageMove(uid, plan.moveTo, { uid: true }),
              "Eine Nachricht konnte nicht verschoben werden.",
            );
            await removeIndexedMessage(db, account.id, folder, uid);
            moved++;
            didMove = true;
          }
        } else if (plan?.moveTo) {
          await removeIndexedMessage(db, account.id, folder, uid);
          didMove = true;
          moved++;
        }
        processed++;
        if (hit) matched++;
        // A checkpoint after every message limits retries to idempotent flag
        // updates or a source UID which no longer exists after a successful move.
        await changeMailRuleState(db, account.id, (current) => {
          if (plan && current.pendingMessage?.id !== plan.id)
            throw new MailRuleError("Die Filteraktion hat sich geändert.", 409);
          current.pendingMessage = null;
          if (manual) {
            if (current.job?.state !== "running")
              throw new MailRuleError("Der Filterlauf wurde beendet.", 409);
            current.job.lastUid = uid;
            current.job.processed++;
            current.job.matched += hit ? 1 : 0;
            current.job.moved += didMove ? 1 : 0;
          } else current.cursor = { validity, lastUid: uid };
        });
      });
    }
    await changeMailRuleState(db, account.id, (current) => {
      current.lastRun = { at: Date.now(), processed, matched, moved, manual };
      current.lastError = "";
      if (manual) {
        if (allUids.length <= batchSize)
          current.job = {
            ...current.job,
            lastUid: upper,
            state: "completed",
            finishedAt: Date.now(),
          };
      }
    });
    return { processed, matched, moved, more: allUids.length > batchSize };
  } finally {
    lock.release();
  }
}
export async function processMailFilters(
  db,
  account,
  client,
  { skipBusy = true, beforeMove } = {},
) {
  return mailboxOperation(
    account.id,
    async () => {
      await assertCurrentMailbox(db, account);
      try {
        let config = await loadMailRules(db, account.id);
        if (config.pendingFolder) {
          await reconcileFolderDelete(db, account, client);
          config = await loadMailRules(db, account.id);
        }
        assertNoFolderOperation(config);
        if (config.job?.state === "running")
          return await processBatch(db, account, client, config, {
            manual: true,
            beforeMove,
          });
        if (config.pendingMessage?.jobId) return { idle: true };
        if (config.automatic)
          return await processBatch(db, account, client, config, {
            beforeMove,
          });
        return { idle: true };
      } catch (error) {
        await changeMailRuleState(db, account.id, (current) => {
          current.lastError =
            error instanceof MailRuleError
              ? error.message
              : "Der Filterlauf konnte nicht abgeschlossen werden. Bitte Postfach und Zielordner prüfen.";
          if (current.job?.state === "running")
            current.job = {
              ...current.job,
              state: "failed",
              error: current.lastError,
              finishedAt: Date.now(),
            };
        });
        throw error;
      }
    },
    { skipBusy },
  );
}
