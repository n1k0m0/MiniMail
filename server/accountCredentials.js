import { decrypt } from "./security.js";

export class AccountInputError extends Error {}

// A blank password means "keep it" only for the same authentication target.
// Editing server settings must never disclose an existing secret to a new host.
export function accountCredentials(body, existing) {
  const context = (item, protocol) =>
    JSON.stringify([
      item[`${protocol}_host`].trim().toLowerCase(),
      Number(item[`${protocol}_port`]),
      !!item[`${protocol}_secure`],
      protocol === "smtp"
        ? item.smtp_username?.trim() || item.username.trim()
        : item.username.trim(),
      item.vpn_profile || "",
    ]);
  const imapChanged =
    existing && context(body, "imap") !== context(existing, "imap");
  const smtpChanged =
    existing && context(body, "smtp") !== context(existing, "smtp");
  if (imapChanged && !body.password)
    throw new AccountInputError(
      "Bei geänderten IMAP-Verbindungsdaten bitte das Postfach-Passwort erneut eingeben.",
    );
  if (
    smtpChanged &&
    (existing.smtp_password_enc
      ? !body.smtp_password
      : !body.smtp_password && !body.password)
  )
    throw new AccountInputError(
      "Bei geänderten SMTP-Verbindungsdaten bitte das SMTP-Passwort erneut eingeben.",
    );
  const password =
    body.password || (existing?.password_enc && decrypt(existing.password_enc));
  if (!password) throw new AccountInputError("Postfach-Passwort fehlt.");
  return {
    password,
    smtp_password:
      body.smtp_password ||
      (existing?.smtp_password_enc && decrypt(existing.smtp_password_enc)) ||
      null,
  };
}
