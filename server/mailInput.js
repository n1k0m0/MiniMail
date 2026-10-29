import addressparser from "nodemailer/lib/addressparser";
import { validContact } from "./contacts.js";

const maxAttachmentBytes = 8 * 1024 * 1024;
const messageId = /^<[^<>\s\u0000-\u001f\u007f]{1,998}>$/;

export function normalizeReferences(references) {
  if (!Array.isArray(references) || references.length > 30) return references;
  const result = [];
  for (const value of references) {
    if (
      typeof value !== "string" ||
      value.length > 30000 ||
      /[\r\n]/.test(value)
    )
      return references;
    const ids = value.match(/<[^<>\s\u0000-\u001f\u007f]{1,998}>/g);
    if (
      !ids ||
      !/^[ ,;]*$/.test(
        value.replace(/<[^<>\s\u0000-\u001f\u007f]{1,998}>/g, ""),
      )
    )
      return references;
    result.push(...ids);
  }
  return [...new Set(result)].slice(-30);
}

export function outgoingMailError(mail, { draft = false } = {}) {
  if (!mail || typeof mail !== "object" || Array.isArray(mail))
    return "Ungültige Nachricht.";
  for (const [field, label] of [
    ["to", "An"],
    ["cc", "Cc"],
    ["bcc", "Bcc"],
  ]) {
    const value = mail[field];
    if (value === undefined && field !== "to") continue;
    if (typeof value !== "string" || /[\r\n\u0000]/.test(value))
      return `Empfänger im Feld ${label} sind ungültig (Adressen prüfen; keine Zeilenumbrüche).`;
    if (value.length > 4096)
      return `Das Feld ${label} ist zu lang (maximal 4096 Zeichen).`;
    if (!draft && value.trim()) {
      const addresses = addressparser(value);
      if (
        !addresses.length ||
        addresses.some((item) => !validContact(item.name || "", item.address))
      )
        return `Empfänger im Feld ${label} sind ungültig (Adressen prüfen; keine Zeilenumbrüche).`;
    }
  }
  if (!draft && ![mail.to, mail.cc, mail.bcc].some((value) => value?.trim()))
    return "Bitte mindestens einen Empfänger in An, Cc oder Bcc eingeben.";
  if (
    mail.subject !== undefined &&
    (typeof mail.subject !== "string" ||
      mail.subject.length > 998 ||
      /[\r\n\u0000]/.test(mail.subject))
  )
    return "Betreff ist ungültig (maximal 998 Zeichen, keine Zeilenumbrüche).";
  if (
    mail.inReplyTo !== undefined &&
    (typeof mail.inReplyTo !== "string" || !messageId.test(mail.inReplyTo))
  )
    return "Die Antwortkennung der ursprünglichen Nachricht ist ungültig. Bitte als neue Nachricht verfassen.";
  if (mail.references !== undefined) {
    mail.references = normalizeReferences(mail.references);
    if (
      !Array.isArray(mail.references) ||
      mail.references.length > 30 ||
      mail.references.some(
        (id) => typeof id !== "string" || !messageId.test(id),
      )
    )
      return "Die Referenzkennungen der ursprünglichen Nachricht sind ungültig. Bitte als neue Nachricht verfassen.";
  }
  if (typeof mail.text !== "string" || mail.text.length > 500000)
    return "Nachrichtentext fehlt oder überschreitet 500000 Zeichen.";
  const security = mail.crypto;
  if (
    security !== undefined &&
    (!security ||
      typeof security !== "object" ||
      Array.isArray(security) ||
      !["none", "pgp", "smime"].includes(security.mode) ||
      typeof security.sign !== "boolean" ||
      ![true, false, "auto"].includes(security.encrypt) ||
      (security.mode === "none" && (security.sign || security.encrypt)) ||
      (!draft &&
        security.mode !== "none" &&
        !security.sign &&
        !security.encrypt))
  )
    return "Die Einstellungen für Signatur oder Verschlüsselung sind ungültig.";
  if (mail.attachments !== undefined && !Array.isArray(mail.attachments))
    return "Anhänge sind ungültig. Dateien bitte erneut hinzufügen.";
  const attachments = mail.attachments || [];
  if (attachments.length > 8) return "Höchstens acht Anhänge sind erlaubt.";
  let total = 0;
  for (const file of attachments) {
    const data = file?.data;
    if (
      !file ||
      typeof file.name !== "string" ||
      !file.name ||
      file.name.length > 255 ||
      /[\u0000-\u001f\u007f]/.test(file.name) ||
      typeof data !== "string" ||
      data.length > Math.ceil((maxAttachmentBytes * 4) / 3) + 4 ||
      data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
    )
      return "Ein Anhang hat einen ungültigen Dateinamen oder Inhalt. Bitte erneut hinzufügen.";
    total +=
      (data.length / 4) * 3 -
      (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
    if (total > maxAttachmentBytes)
      return "Anhänge dürfen zusammen höchstens 8 MB groß sein.";
  }
  return null;
}

export function validOutgoingMail(mail, options) {
  return outgoingMailError(mail, options) === null;
}
