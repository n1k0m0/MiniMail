import { useState } from "react";
import { LockKeyhole, Mail, Plus, RefreshCw, Star, Trash2 } from "lucide-react";
import { api } from "../mailUi.js";
import { t, choose, dateLocale } from "../i18n.js";

export default function MailboxSettings({
  accounts,
  onAdd,
  onEdit,
  onCrypto,
  onPrimary,
  onDeleted,
  setError,
}) {
  const [primaryBusy, setPrimaryBusy] = useState(false);
  const [removingId, setRemovingId] = useState(null);
  async function makePrimary(id) {
    if (primaryBusy) return;
    setPrimaryBusy(true);
    try {
      await onPrimary(id);
    } catch (err) {
      setError(err.message);
    } finally {
      setPrimaryBusy(false);
    }
  }
  async function remove(account) {
    if (
      removingId !== null ||
      !window.confirm(
        choose(
          `Postfach „${account.name}“ aus MiniMail entfernen? E-Mails auf dem Server bleiben erhalten.`,
          `Remove mailbox “${account.name}” from MiniMail? Messages on the mail server will remain.`,
        ),
      )
    )
      return;
    setRemovingId(account.id);
    try {
      await api(`/accounts/${account.id}`, { method: "DELETE" });
      await onDeleted(account.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setRemovingId(null);
    }
  }
  function checkStatus(account) {
    if (account.needsCredentials) return t("Zugangsdaten fehlen");
    if (account.check_failed) return t("Prüfung fehlgeschlagen");
    if (account.check_interval_minutes === 0)
      return t("Automatischer Abruf aus");
    const interval = choose(
      `Alle ${account.check_interval_minutes ?? 5} Minuten`,
      `Every ${account.check_interval_minutes ?? 5} minutes`,
    );
    return (
      interval +
      (account.last_checked_at
        ? ` · ${choose("zuletzt", "last checked")} ${new Date(account.last_checked_at).toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" })}`
        : ` · ${t("noch nicht geprüft")}`)
    );
  }
  return (
    <>
      <div className="settings-section-toolbar">
        <span>
          {choose(
            `${accounts.length} verbundene Postfächer`,
            `${accounts.length} connected mailboxes`,
          )}
        </span>
        <button type="button" className="primary-button" onClick={onAdd}>
          <Plus size={16} />
          {t("Postfach verbinden")}
        </button>
      </div>
      {accounts.length ? (
        <div className="settings-mailbox-grid">
          {accounts.map((account) => (
            <article className="settings-mailbox-card" key={account.id}>
              <div className="settings-mailbox-heading">
                <div className="account-badge">
                  {account.name[0]?.toUpperCase()}
                </div>
                <div>
                  <strong>{account.name}</strong>
                  <span>{account.email}</span>
                </div>
                {account.is_primary && (
                  <span className="settings-primary-badge">
                    <Star size={12} fill="currentColor" />
                    {t("Primär")}
                  </span>
                )}
              </div>
              <p
                className={`settings-mailbox-status ${account.check_failed || account.needsCredentials ? "attention" : ""}`}
              >
                <RefreshCw size={13} />
                {checkStatus(account)}
              </p>
              <div className="settings-mailbox-actions">
                <button type="button" onClick={() => onEdit(account)}>
                  {t("Bearbeiten")}
                </button>
                <button type="button" onClick={() => onCrypto(account)}>
                  <LockKeyhole size={14} />
                  {t("Schlüssel")}
                </button>
                {!account.is_primary && (
                  <button
                    type="button"
                    disabled={primaryBusy}
                    onClick={() => makePrimary(account.id)}
                  >
                    <Star size={13} />
                    {t("Als primär")}
                  </button>
                )}
                <button
                  type="button"
                  className="settings-remove"
                  aria-label={choose(
                    `Postfach ${account.name} entfernen`,
                    `Remove mailbox ${account.name}`,
                  )}
                  title={t("Postfach entfernen")}
                  disabled={removingId !== null}
                  onClick={() => remove(account)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="settings-empty">
          <Mail size={32} />
          <strong>{t("Noch kein Postfach verbunden")}</strong>
          <p>
            {t(
              "Verbinde dein erstes Postfach, um E-Mails zu lesen und zu senden.",
            )}
          </p>
        </div>
      )}
      <div className="settings-note">
        <LockKeyhole size={17} />
        <p>
          {t(
            "Hier siehst und verwaltest du ausschließlich deine eigenen Postfächer. Absender, Signaturen und Verschlüsselung findest du beim jeweiligen Postfach.",
          )}
        </p>
      </div>
    </>
  );
}
