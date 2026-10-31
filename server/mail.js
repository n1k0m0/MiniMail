import { listMessagePage, messageSearchCriteria } from "./messageList.js";
import { normalizeReferences } from "./mailInput.js";
import { requireMailResult, deleteMailboxMessage } from "./mailActions.js";
import { saveSentCopy } from "./sentCopy.js";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import sanitizeHtml from "sanitize-html";
import { decrypt, encrypt } from "./security.js";
import { isTrashFolder } from "./folderTypes.js";
import { groupMessages } from "./threading.js";
import { mailDestination } from "./mailNetwork.js";
import { inspectIncoming, protectOutgoing } from "./protectedMail.js";
import { collectMessageKeys } from "./keyDiscovery.js";
import { db } from "./db.js";
import { calendarPreferences, importMailInvitations } from "./calendars.js";
import { processMailFilters } from "./mailFilterEngine.js";
import { loadMailRules, mailboxOperation } from "./mailRuleStore.js";
import { reconcileFolderDelete } from "./folderActions.js";
import {
  clearFolderIndex,
  indexedMessages,
  markIndexedFolderRead,
  removeIndexedMessage,
  syncThreadIndex,
  updateIndexedFlags,
} from "./mailIndex.js";
function settings(account) {
  const password = account.password_enc
    ? decrypt(account.password_enc)
    : account.password;
  return {
    ...account,
    password,
    smtp_username: account.smtp_username || account.username,
    smtp_password: account.smtp_password_enc
      ? decrypt(account.smtp_password_enc)
      : account.smtp_password || password,
  };
}
async function imapClient(account) {
  const a = settings(account);
  const destination = await mailDestination(a, "imap");
  return new ImapFlow({
    ...destination,
    port: Number(a.imap_port),
    secure: !!a.imap_secure,
    doSTARTTLS: a.imap_secure ? undefined : true,
    disableCompression: true,
    auth: {
      user: a.username,
      pass: a.password,
    },
    logger: false,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
}
export async function withImap(account, callback, { timeout = 0 } = {}) {
  const client = await imapClient(account);
  const timer = timeout ? setTimeout(() => client.close(), timeout) : null;
  timer?.unref();
  try {
    await client.connect();
    return await callback(client);
  } finally {
    if (timer) clearTimeout(timer);
    if (client.usable) await client.logout().catch(() => {});
  }
}
async function inFolder(account, folder, callback) {
  return withImap(account, async (client) => {
    const lock = await client.getMailboxLock(folder || "INBOX");
    try {
      return await callback(client);
    } finally {
      lock.release();
    }
  });
}
const address = (list) =>
  (list || []).map((item) => ({
    name: item.name || "",
    address: item.address || "",
  }));
const summary = (item) => ({
  uid: item.uid,
  subject: item.envelope?.subject || "(Kein Betreff)",
  from: address(item.envelope?.from),
  to: address(item.envelope?.to),
  date: item.internalDate || item.envelope?.date,
  size: item.size,
  seen: item.flags?.has("\\Seen") || false,
  flagged: item.flags?.has("\\Flagged") || false,
  hasAttachments: !!item.bodyStructure?.childNodes?.some(
    (node) => node.disposition === "attachment",
  ),
});
export async function testAccount(account) {
  try {
    await withImap(account, async (client) => client.list());
  } catch (error) {
    error.mailStage = "IMAP";
    throw error;
  }
  const a = settings(account);
  const destination = await mailDestination(a, "smtp");
  const transporter = nodemailer.createTransport({
    ...destination,
    tls: { servername: destination.servername },
    port: Number(a.smtp_port),
    secure: !!a.smtp_secure,
    requireTLS: !a.smtp_secure,
    auth: {
      user: a.smtp_username,
      pass: a.smtp_password,
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
  try {
    await transporter.verify();
  } catch (error) {
    error.mailStage = "SMTP";
    throw error;
  } finally {
    transporter.close();
  }
}
export async function listFolders(account) {
  return withImap(account, async (client) => {
    const config = await loadMailRules(db, account.id);
    if (config.pendingFolder)
      await mailboxOperation(
        account.id,
        () => reconcileFolderDelete(db, account, client),
        { skipBusy: true },
      );
    const folders = await client.list({
      statusQuery: {
        messages: true,
        unseen: true,
      },
    });
    return folders
      .filter((item) => !item.flags?.has("\\Noselect"))
      .map((item) => ({
        path: item.path,
        name: item.name,
        delimiter: item.delimiter || "/",
        specialUse: item.specialUse || null,
        count: item.status?.messages || 0,
        unseen: item.status?.unseen || 0,
      }));
  });
}
export async function checkInbox(account) {
  return withImap(account, async (client) => {
    const status = await client.status("INBOX", {
      messages: true,
      unseen: true,
      uidNext: true,
    });
    if (!status)
      throw new Error("Der Posteingang konnte nicht geprüft werden.");
    // Calendar parsing must not make an otherwise healthy mail check fail.
    try {
      await scanInboxInvitations(client, account, status.uidNext || 1);
    } catch {
      console.error("Calendar invitation scan deferred", {
        accountId: account.id,
      });
    }
    // Invitation extraction happens before filters may move a new message.
    try {
      await processMailFilters(db, account, client, {
        beforeMove: (connection, folder, message) =>
          preserveFilteredInvitations(connection, account, folder, message),
      });
    } catch {
      console.error("Mail filters deferred", { accountId: account.id });
    }
    const updated = await client.status("INBOX", {
      unseen: true,
      uidNext: true,
    });
    return {
      unseen: updated?.unseen ?? status.unseen ?? 0,
      uidNext: updated?.uidNext ?? status.uidNext ?? 0,
    };
  });
}
export async function runAccountMailFilters(account) {
  return withImap(
    account,
    async (client) => {
      const result = await processMailFilters(db, account, client, {
        beforeMove: (connection, folder, message) =>
          preserveFilteredInvitations(connection, account, folder, message),
      });
      if (result?.processed) {
        const status = await client.status("INBOX", {
          unseen: true,
          uidNext: true,
        });
        if (status)
          await db
            .prepare(
              "UPDATE accounts SET inbox_unseen=?,inbox_uid_next=? WHERE id=?",
            )
            .run(status.unseen || 0, status.uidNext || 0, account.id);
      }
      return result;
    },
    { timeout: 45000 },
  );
}
function mightContainKey(item) {
  const headers = item.headers?.toString("utf8") || "";
  if (/^Autocrypt:/im.test(headers)) return true;
  if (/pkcs7-signature|smime-type\s*=\s*"?signed-data/i.test(headers))
    return true;
  const structure = JSON.stringify(item.bodyStructure || {}).toLowerCase();
  return /pgp-keys|\.(?:asc|pgp|cer|crt|pem|p7b|p7c)\b/.test(structure);
}
export async function scanAccountKeys(account, batchSize = 80) {
  return withImap(account, async (client) => {
    const folders = (await client.list()).filter(
      (item) => !item.flags?.has("\\Noselect"),
    );
    const checkpoints = new Map(
      (
        await db
          .prepare("SELECT * FROM key_scan_folders WHERE account_id=?")
          .all(account.id)
      ).map((item) => [item.folder, item]),
    );
    folders.sort(
      (left, right) =>
        (checkpoints.get(left.path)?.updated_at || 0) -
        (checkpoints.get(right.path)?.updated_at || 0),
    );
    for (const folder of folders) {
      const lock = await client.getMailboxLock(folder.path);
      try {
        const validity = String(client.mailbox.uidValidity || "");
        const latest = Number(client.mailbox.uidNext || 1) - 1;
        const checkpoint = checkpoints.get(folder.path);
        let lastUid =
          checkpoint?.uid_validity === validity ? checkpoint.last_uid : 0;
        if (lastUid >= latest) continue;
        let inlineUids;
        if (!checkpoint || checkpoint.uid_validity !== validity) {
          try {
            inlineUids =
              (await client.search(
                {
                  body: "BEGIN PGP PUBLIC KEY BLOCK",
                },
                {
                  uid: true,
                },
              )) || [];
          } catch (error) {
            console.error("Could not search inline PGP keys", {
              accountId: account.id,
              folder: folder.path,
              error: error.message,
            });
            inlineUids = [];
          }
        } else {
          inlineUids = JSON.parse(checkpoint.inline_uids || "[]");
        }
        const inlineSet = new Set(inlineUids);
        const all =
          (await client.search(
            {
              all: true,
            },
            {
              uid: true,
            },
          )) || [];
        const next = all.filter((uid) => uid > lastUid).sort((a, b) => a - b);
        const selected = next.slice(0, batchSize);
        if (!selected.length) selected.push(latest);
        const metadata =
          selected.length && next.length
            ? await client.fetchAll(
                selected,
                {
                  uid: true,
                  size: true,
                  headers: ["from", "autocrypt", "content-type"],
                  bodyStructure: true,
                },
                {
                  uid: true,
                },
              )
            : [];
        const byUid = new Map(metadata.map((item) => [item.uid, item]));
        const counts = {
          scanned: 0,
          stored: 0,
          alternate: 0,
        };
        for (const uid of selected) {
          const item = byUid.get(uid);
          if (
            item &&
            item.size <= 25 * 1024 * 1024 &&
            (mightContainKey(item) || inlineSet.has(uid) || item.size <= 32768)
          ) {
            const full = await client.fetchOne(
              uid,
              {
                uid: true,
                source: true,
              },
              {
                uid: true,
              },
            );
            try {
              if (full?.source) {
                const found = await collectMessageKeys(
                  db,
                  account,
                  full.source,
                );
                counts.stored += found.stored;
                counts.alternate += found.alternate;
              }
            } catch (error) {
              console.error("Could not inspect message keys", {
                accountId: account.id,
                folder: folder.path,
                uid,
                error: error.message,
              });
            }
          }
          lastUid = uid;
          counts.scanned++;
          await db
            .prepare(
              `INSERT INTO key_scan_folders (account_id,folder,uid_validity,last_uid,inline_uids,updated_at)
             VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE
             uid_validity=VALUES(uid_validity),last_uid=VALUES(last_uid),
             inline_uids=VALUES(inline_uids),updated_at=VALUES(updated_at)`,
            )
            .run(
              account.id,
              folder.path,
              validity,
              lastUid,
              JSON.stringify(inlineUids),
              Date.now(),
            );
        }
        return {
          ...counts,
          folder: folder.path,
          pending: true,
        };
      } finally {
        lock.release();
      }
    }
    return {
      scanned: 0,
      stored: 0,
      alternate: 0,
      pending: false,
    };
  });
}
export async function listMessages(
  account,
  folder,
  query,
  page = 0,
  threaded = false,
  unreadOnly = false,
) {
  return inFolder(account, folder, async (client) => {
    const path = folder || "INBOX";
    const pageSize = 60;
    if (threaded) {
      await syncThreadIndex(db, account.id, path, client, summary);
      const items = await indexedMessages(db, account.id, path);
      const matches = query
        ? (await client.search(messageSearchCriteria(query, unreadOnly), {
            uid: true,
          })) || []
        : null;
      const matchSet = matches ? new Set(matches) : null;
      const groups = groupMessages(items, { unreadOnly }).filter(
        (group) =>
          !matchSet || group.thread.some((member) => matchSet.has(member.uid)),
      );
      const visible = groups.slice(page * pageSize, (page + 1) * pageSize);
      const missingDetails = visible.filter((group) => group.size == null);
      if (missingDetails.length) {
        const detail = await client.fetchAll(
          missingDetails.map((group) => group.uid),
          {
            uid: true,
            size: true,
            bodyStructure: true,
          },
          {
            uid: true,
          },
        );
        const byUid = new Map(detail.map((item) => [item.uid, summary(item)]));
        const update = db.prepare(
          "UPDATE mail_index_messages SET data_enc=? WHERE account_id=? AND folder=? AND uid=?",
        );
        const byIndexedUid = new Map(items.map((item) => [item.uid, item]));
        for (const group of visible) {
          const extra = byUid.get(group.uid);
          if (!extra) continue;
          group.size = extra.size;
          group.hasAttachments = extra.hasAttachments;
          const indexed = byIndexedUid.get(group.uid);
          if (indexed) {
            indexed.size = extra.size;
            indexed.hasAttachments = extra.hasAttachments;
            await update.run(
              encrypt(JSON.stringify(indexed)),
              account.id,
              path,
              group.uid,
            );
          }
        }
      }
      return {
        messages: visible,
        total: groups.length,
        messageTotal: matches
          ? matches.length
          : unreadOnly
            ? items.filter((item) => !item.seen).length
            : items.length,
        page,
      };
    }
    return listMessagePage(client, summary, { query, page, unreadOnly });
  });
}
async function parsedMessage(client, uid, account) {
  const metadata = await client.fetchOne(
    uid,
    {
      uid: true,
      size: true,
    },
    {
      uid: true,
    },
  );
  if (!metadata) return null;
  if (metadata.size > 25 * 1024 * 1024)
    throw new Error(
      "Diese Nachricht ist für die Webansicht zu groß (über 25 MB).",
    );
  const item = await client.fetchOne(
    uid,
    {
      uid: true,
      source: true,
      flags: true,
    },
    {
      uid: true,
    },
  );
  if (!item?.source) return null;
  if (item.source.length > 25 * 1024 * 1024)
    throw new Error(
      "Diese Nachricht ist für die Webansicht zu groß (über 25 MB).",
    );
  const { parsed, security } = await inspectIncoming(account, item.source);
  return {
    item,
    parsed,
    security,
  };
}
export async function getMessage(account, folder, uid) {
  return inFolder(account, folder, async (client) => {
    const result = await parsedMessage(client, uid, account);
    if (!result) return null;
    const { item, parsed, security } = result;
    let calendarInvitations = [];
    try {
      calendarInvitations = await importMailInvitations(
        db,
        account,
        parsed.attachments,
        address(parsed.from?.value),
      );
    } catch {}
    return {
      uid: item.uid,
      subject: parsed.subject || "(Kein Betreff)",
      messageId: parsed.messageId || "",
      references: normalizeReferences(
        Array.isArray(parsed.references)
          ? parsed.references
          : parsed.references
            ? [parsed.references]
            : [],
      ),
      date: parsed.date,
      from: address(parsed.from?.value),
      replyTo: address(parsed.replyTo?.value),
      to: address(parsed.to?.value),
      cc: address(parsed.cc?.value),
      bcc: address(parsed.bcc?.value),
      security,
      calendarInvitations,
      hasInvitations: parsed.attachments.some(
        (part) =>
          /text\/calendar/i.test(part.contentType || "") ||
          /\.ics$/i.test(part.filename || ""),
      ),
      text: parsed.text || "",
      html: parsed.html
        ? sanitizeHtml(parsed.html, {
            allowedTags: sanitizeHtml.defaults.allowedTags.concat([
              "table",
              "thead",
              "tbody",
              "tr",
              "td",
              "th",
            ]),
            allowedAttributes: {
              ...sanitizeHtml.defaults.allowedAttributes,
              a: ["href", "name", "target"],
            },
            allowedSchemes: ["http", "https", "mailto"],
            transformTags: {
              a: sanitizeHtml.simpleTransform("a", {
                rel: "noopener noreferrer",
                target: "_blank",
              }),
            },
          })
        : "",
      attachments: parsed.attachments.map((part, index) => ({
        index,
        filename: part.filename || `Anhang ${index + 1}`,
        size: part.size,
        contentType: part.contentType,
      })),
    };
  });
}
export async function getAttachment(account, folder, uid, index) {
  return inFolder(account, folder, async (client) => {
    const result = await parsedMessage(client, uid, account);
    return result?.parsed.attachments[index] || null;
  });
}
export async function getInvitationParts(account, folder, uid) {
  return inFolder(account, folder, async (client) => {
    const result = await parsedMessage(client, uid, account);
    return {
      attachments: result?.parsed.attachments || [],
      from: address(result?.parsed.from?.value),
    };
  });
}
async function preserveFilteredInvitations(client, account, folder, message) {
  if (
    folder.toUpperCase() !== "INBOX" ||
    message.size > 1024 * 1024 ||
    !/text\/calendar|\.ics\b/i.test(JSON.stringify(message.bodyStructure || {}))
  )
    return;
  const preferences = await calendarPreferences(db, account.user_id);
  if (!preferences.autoImport || !preferences.defaultCalendarId) return;
  const result = await parsedMessage(client, message.uid, account);
  if (result)
    await importMailInvitations(
      db,
      account,
      result.parsed.attachments,
      address(result.parsed.from?.value),
    );
}
async function scanInboxInvitations(client, account, uidNext) {
  const preferences = await calendarPreferences(db, account.user_id);
  if (!preferences.autoImport || !preferences.defaultCalendarId) return;
  const lock = await client.getMailboxLock("INBOX");
  try {
    const validity = String(client.mailbox.uidValidity);
    const checkpoint = await db
      .prepare("SELECT * FROM calendar_mail_scan WHERE account_id=?")
      .get(account.id);
    let cursor =
      checkpoint?.uid_validity === validity ? checkpoint.last_uid : null;
    if (cursor === null) {
      const recent = await client.search(
        { since: new Date(Date.now() - 30 * 86400000) },
        { uid: true },
      );
      cursor = recent.length
        ? recent.reduce((lowest, uid) => Math.min(lowest, uid), Infinity) - 1
        : uidNext - 1;
    }
    const end = Math.min(uidNext - 1, cursor + 1000);
    if (end > cursor) {
      const uids = (
        await client.search({ uid: `${cursor + 1}:${end}` }, { uid: true })
      ).slice(0, 80);
      for (const uid of uids) {
        const metadata = await client.fetchOne(
          uid,
          { bodyStructure: true, size: true },
          { uid: true },
        );
        if (
          metadata &&
          metadata.size <= 1024 * 1024 &&
          /text\/calendar|\.ics\b/i.test(
            JSON.stringify(metadata.bodyStructure || {}),
          )
        ) {
          const result = await parsedMessage(client, uid, account);
          if (result)
            await importMailInvitations(
              db,
              account,
              result.parsed.attachments,
              address(result.parsed.from?.value),
            );
        }
      }
      cursor = uids.length === 80 ? uids.at(-1) : end;
    }
    await db
      .prepare(
        "INSERT INTO calendar_mail_scan(account_id,uid_validity,last_uid,updated_at) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE uid_validity=VALUES(uid_validity),last_uid=VALUES(last_uid),updated_at=VALUES(updated_at)",
      )
      .run(account.id, validity, cursor, Date.now());
  } finally {
    lock.release();
  }
}
export async function getMessageSource(account, folder, uid) {
  return inFolder(account, folder, async (client) => {
    const metadata = await client.fetchOne(
      uid,
      {
        uid: true,
        size: true,
      },
      {
        uid: true,
      },
    );
    if (!metadata) return null;
    if (metadata.size > 25 * 1024 * 1024)
      throw new Error(
        "Diese Nachricht ist für die Quelltextansicht zu groß (über 25 MB).",
      );
    const item = await client.fetchOne(
      uid,
      {
        uid: true,
        source: true,
      },
      {
        uid: true,
      },
    );
    return item?.source || null;
  });
}
export async function updateFlags(account, folder, uid, flags) {
  const result = await inFolder(account, folder, async (client) => {
    for (const [flag, enabled] of Object.entries(flags)) {
      const imapFlag =
        flag === "seen" ? "\\Seen" : flag === "flagged" ? "\\Flagged" : null;
      if (!imapFlag) continue;
      if (enabled)
        requireMailResult(
          await client.messageFlagsAdd(uid, [imapFlag], {
            uid: true,
          }),
          "Nachrichtenstatus konnte nicht geändert werden.",
        );
      else
        requireMailResult(
          await client.messageFlagsRemove(uid, [imapFlag], {
            uid: true,
          }),
          "Nachrichtenstatus konnte nicht geändert werden.",
        );
    }
  });
  await updateIndexedFlags(db, account.id, folder || "INBOX", uid, flags);
  return result;
}
export async function markFolderRead(account, folder) {
  const result = await inFolder(account, folder, (client) =>
    client
      .messageFlagsAdd(
        {
          seen: false,
        },
        ["\\Seen"],
      )
      .then((result) =>
        requireMailResult(
          result,
          "Nachrichtenstatus konnte nicht geändert werden.",
        ),
      ),
  );
  await markIndexedFolderRead(db, account.id, folder || "INBOX");
  return result;
}
export async function moveMessage(account, folder, uid, destination) {
  const result = await inFolder(account, folder, (client) =>
    client
      .messageMove(uid, destination, {
        uid: true,
      })
      .then((result) =>
        requireMailResult(result, "Nachricht konnte nicht verschoben werden."),
      ),
  );
  await removeIndexedMessage(db, account.id, folder || "INBOX", uid);
  return result;
}
export async function deleteMessage(account, folder, uid) {
  const result = await withImap(account, (client) =>
    deleteMailboxMessage(client, folder, uid),
  );
  await removeIndexedMessage(db, account.id, folder || "INBOX", uid);
  return result;
}
export async function emptyTrash(account, folder) {
  const result = await withImap(account, async (client) => {
    const target = (await client.list()).find((item) => item.path === folder);
    if (!target || target.flags?.has("\\Noselect") || !isTrashFolder(target))
      return null;
    const lock = await client.getMailboxLock(folder);
    try {
      const count = client.mailbox.exists || 0;
      if (
        count &&
        !(await client.messageDelete({
          all: true,
        }))
      )
        throw new Error("Der Papierkorb konnte nicht geleert werden.");
      return count;
    } finally {
      lock.release();
    }
  });
  if (result !== null) await clearFolderIndex(db, account.id, folder);
  return result;
}
export async function sendMessage(account, mail, calendarInvite = null) {
  const a = settings(account);
  const destination = await mailDestination(a, "smtp");
  const transporter = nodemailer.createTransport({
    ...destination,
    tls: { servername: destination.servername },
    port: Number(a.smtp_port),
    secure: !!a.smtp_secure,
    requireTLS: !a.smtp_secure,
    auth: {
      user: a.smtp_username,
      pass: a.smtp_password,
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  const outgoing = {
    from: {
      name: a.sender_name || a.name,
      address: a.email,
    },
    to: mail.to,
    cc: mail.cc || undefined,
    bcc: mail.bcc || undefined,
    subject: mail.subject || "",
    inReplyTo: mail.inReplyTo || undefined,
    references: mail.references?.length ? mail.references : undefined,
    text: mail.text || "",
    ...(calendarInvite ? { icalEvent: calendarInvite } : {}),
    attachments: (mail.attachments || []).map((file) => ({
      filename: file.name,
      content: Buffer.from(file.data, "base64"),
    })),
  };
  const protectedMessage = await protectOutgoing(account, mail, outgoing);
  let info;
  try {
    info = await transporter.sendMail(
      protectedMessage
        ? {
            raw: protectedMessage.smtpRaw,
            envelope: protectedMessage.envelope,
          }
        : outgoing,
    );
  } finally {
    transporter.close();
  }
  const sentCopy = await saveSentCopy(
    (callback) => withImap(account, callback),
    async () =>
      protectedMessage?.sentRaw ||
      (await new Promise((resolve, reject) => {
        nodemailer
          .createTransport({
            streamTransport: true,
            buffer: true,
            disableFileAccess: true,
            disableUrlAccess: true,
          })
          .sendMail(
            {
              ...outgoing,
              keepBcc: true,
              messageId: info.messageId,
            },
            (error, result) =>
              error ? reject(error) : resolve(result.message),
          );
      })),
  );
  return {
    messageId: protectedMessage?.messageId || info.messageId,
    sentCopy,
  };
}
