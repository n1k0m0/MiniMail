import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";
import sanitizeHtml from "sanitize-html";
import { decrypt } from "./security.js";

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
function imapClient(account) {
  const a = settings(account);
  return new ImapFlow({
    host: a.imap_host,
    port: Number(a.imap_port),
    secure: !!a.imap_secure,
    doSTARTTLS: a.imap_secure ? undefined : true,
    auth: { user: a.username, pass: a.password },
    logger: false,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
}
async function withImap(account, callback) {
  const client = imapClient(account);
  try {
    await client.connect();
    return await callback(client);
  } finally {
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
  const transporter = nodemailer.createTransport({
    host: a.smtp_host,
    port: Number(a.smtp_port),
    secure: !!a.smtp_secure,
    requireTLS: !a.smtp_secure,
    auth: { user: a.smtp_username, pass: a.smtp_password },
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
    const folders = await client.list({
      statusQuery: { messages: true, unseen: true },
    });
    return folders
      .filter((item) => !item.flags?.has("\\Noselect"))
      .map((item) => ({
        path: item.path,
        name: item.name,
        specialUse: item.specialUse || null,
        count: item.status?.messages || 0,
        unseen: item.status?.unseen || 0,
      }));
  });
}

export async function listMessages(account, folder, query, page = 0) {
  return inFolder(account, folder, async (client) => {
    const criteria = query
      ? {
          or: [
            { subject: query },
            { from: query },
            { to: query },
            { body: query },
          ],
        }
      : { all: true };
    const matches = (await client.search(criteria, { uid: true })) || [];
    const sorted = [...matches].sort((a, b) => b - a);
    const uids = sorted.slice(page * 40, page * 40 + 40);
    if (!uids.length) return { messages: [], total: sorted.length, page };
    const messages = await client.fetchAll(
      uids,
      {
        uid: true,
        envelope: true,
        flags: true,
        internalDate: true,
        size: true,
        bodyStructure: true,
      },
      { uid: true },
    );
    const byUid = new Map(messages.map((item) => [item.uid, summary(item)]));
    return {
      messages: uids.map((uid) => byUid.get(uid)).filter(Boolean),
      total: sorted.length,
      page,
    };
  });
}

async function parsedMessage(client, uid) {
  const item = await client.fetchOne(
    uid,
    { uid: true, source: true, flags: true },
    { uid: true },
  );
  if (!item?.source) return null;
  if (item.source.length > 25 * 1024 * 1024)
    throw new Error(
      "Diese Nachricht ist für die Webansicht zu groß (über 25 MB).",
    );
  const parsed = await simpleParser(item.source);
  return { item, parsed };
}
export async function getMessage(account, folder, uid) {
  return inFolder(account, folder, async (client) => {
    const result = await parsedMessage(client, uid);
    if (!result) return null;
    const { item, parsed } = result;
    await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });
    return {
      uid: item.uid,
      subject: parsed.subject || "(Kein Betreff)",
      date: parsed.date,
      from: address(parsed.from?.value),
      to: address(parsed.to?.value),
      cc: address(parsed.cc?.value),
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
    const result = await parsedMessage(client, uid);
    return result?.parsed.attachments[index] || null;
  });
}
export async function updateFlags(account, folder, uid, flags) {
  return inFolder(account, folder, async (client) => {
    for (const [flag, enabled] of Object.entries(flags)) {
      const imapFlag =
        flag === "seen" ? "\\Seen" : flag === "flagged" ? "\\Flagged" : null;
      if (!imapFlag) continue;
      if (enabled) await client.messageFlagsAdd(uid, [imapFlag], { uid: true });
      else await client.messageFlagsRemove(uid, [imapFlag], { uid: true });
    }
  });
}
export async function moveMessage(account, folder, uid, destination) {
  return inFolder(account, folder, (client) =>
    client.messageMove(uid, destination, { uid: true }),
  );
}
export async function deleteMessage(account, folder, uid) {
  return withImap(account, async (client) => {
    const folders = await client.list();
    const trash =
      folders.find((item) => item.specialUse === "\\Trash")?.path ||
      folders.find((item) => /^(trash|papierkorb|gelöscht)$/i.test(item.name))
        ?.path;
    const lock = await client.getMailboxLock(folder);
    try {
      if (trash && trash !== folder)
        await client.messageMove(uid, trash, { uid: true });
      else await client.messageDelete(uid, { uid: true });
    } finally {
      lock.release();
    }
  });
}
export async function sendMessage(account, mail) {
  const a = settings(account);
  const transporter = nodemailer.createTransport({
    host: a.smtp_host,
    port: Number(a.smtp_port),
    secure: !!a.smtp_secure,
    requireTLS: !a.smtp_secure,
    auth: { user: a.smtp_username, pass: a.smtp_password },
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  const outgoing = {
    from: { name: a.name, address: a.email },
    to: mail.to,
    cc: mail.cc || undefined,
    subject: mail.subject || "",
    text: mail.text || "",
    attachments: (mail.attachments || []).map((file) => ({
      filename: file.name,
      content: Buffer.from(file.data, "base64"),
    })),
  };
  const info = await transporter.sendMail(outgoing);
  transporter.close();
  try {
    await withImap(account, async (client) => {
      const folders = await client.list();
      const sent =
        folders.find((item) => item.specialUse === "\\Sent")?.path ||
        folders.find((item) => /^sent$/i.test(item.name))?.path;
      if (sent) {
        const raw = await new Promise((resolve, reject) => {
          nodemailer
            .createTransport({
              streamTransport: true,
              buffer: true,
              disableFileAccess: true,
              disableUrlAccess: true,
            })
            .sendMail(outgoing, (error, result) =>
              error ? reject(error) : resolve(result.message),
            );
        });
        await client.append(sent, raw, ["\\Seen"]);
      }
    });
  } catch {
    /* SMTP succeeded; some servers store Sent automatically or disallow APPEND. */
  }
  return { messageId: info.messageId };
}
