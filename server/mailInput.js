const maxAttachmentBytes = 8 * 1024 * 1024;
export function validOutgoingMail(mail, { draft = false } = {}) {
  if (!mail || typeof mail !== "object" || Array.isArray(mail)) return false;
  if (
    typeof mail.to !== "string" ||
    (!draft &&
      ![mail.to, mail.cc, mail.bcc].some(
        (field) => typeof field === "string" && field.trim(),
      )) ||
    mail.to.length > 4096 ||
    /[\r\n]/.test(mail.to) ||
    (mail.cc !== undefined &&
      (typeof mail.cc !== "string" ||
        mail.cc.length > 4096 ||
        /[\r\n]/.test(mail.cc))) ||
    (mail.bcc !== undefined &&
      (typeof mail.bcc !== "string" ||
        mail.bcc.length > 4096 ||
        /[\r\n]/.test(mail.bcc))) ||
    (mail.subject !== undefined &&
      (typeof mail.subject !== "string" ||
        mail.subject.length > 998 ||
        /[\r\n]/.test(mail.subject))) ||
    (mail.inReplyTo !== undefined &&
      (typeof mail.inReplyTo !== "string" ||
        !/^<[^<>\r\n]{1,998}>$/.test(mail.inReplyTo))) ||
    (mail.references !== undefined &&
      (!Array.isArray(mail.references) ||
        mail.references.length > 30 ||
        mail.references.some(
          (id) => typeof id !== "string" || !/^<[^<>\r\n]{1,998}>$/.test(id),
        ))) ||
    typeof mail.text !== "string" ||
    mail.text.length > 500000 ||
    (mail.crypto !== undefined &&
      (!mail.crypto ||
        typeof mail.crypto !== "object" ||
        Array.isArray(mail.crypto) ||
        !["none", "pgp", "smime"].includes(mail.crypto.mode) ||
        typeof mail.crypto.sign !== "boolean" ||
        ![true, false, "auto"].includes(mail.crypto.encrypt) ||
        (mail.crypto.mode === "none" &&
          (mail.crypto.sign || mail.crypto.encrypt)) ||
        (!draft &&
          mail.crypto.mode !== "none" &&
          !mail.crypto.sign &&
          !mail.crypto.encrypt))) ||
    (mail.attachments !== undefined && !Array.isArray(mail.attachments))
  )
    return false;
  const attachments = mail.attachments || [];
  if (attachments.length > 8) return false;
  let totalBytes = 0;
  for (const file of attachments) {
    const data = file?.data;
    const padding =
      typeof data === "string"
        ? data.endsWith("==")
          ? 2
          : data.endsWith("=")
            ? 1
            : 0
        : 0;
    const content = padding ? data.slice(0, -padding) : data;
    if (
      !file ||
      typeof file.name !== "string" ||
      !file.name ||
      file.name.length > 255 ||
      /[\u0000-\u001f\u007f]/.test(file.name) ||
      typeof data !== "string" ||
      data.length > Math.ceil((maxAttachmentBytes * 4) / 3) + 4 ||
      data.length % 4 !== 0 ||
      content.includes("=") ||
      /[^A-Za-z0-9+/]/.test(content)
    )
      return false;
    totalBytes += (data.length / 4) * 3 - padding;
    if (totalBytes > maxAttachmentBytes) return false;
  }
  return true;
}
