import { useState } from "react";
import {
  Contact,
  LockKeyhole,
  Moon,
  Plus,
  ShieldCheck,
  Star,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { api } from "./mailUi.js";
import { t, choose, dateLocale } from "./i18n.js";
import AiSettings from "./AiSettings.jsx";
import UserManagement from "./UserManagement.jsx";

export default function SettingsModal({
  accounts,
  auth,
  onClose,
  onEdit,
  onCrypto,
  onAdd,
  onOpenContacts,
  onCollectRecipientsChange,
  onLogout,
  setTheme,
  theme,
  language,
  onLanguageChange,
  threaded,
  onThreadedChange,
  setError,
  onDeleted,
  onPrimary,
}) {
  const [primaryBusy, setPrimaryBusy] = useState(false);
  const [collectBusy, setCollectBusy] = useState(false);
  async function toggleCollection() {
    if (collectBusy) return;
    setCollectBusy(true);
    try {
      await onCollectRecipientsChange(!auth.user.collectRecipients);
    } catch (err) {
      setError(err.message);
    } finally {
      setCollectBusy(false);
    }
  }
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
      !window.confirm(
        choose(
          `Postfach „${account.name}“ aus MiniMail entfernen? E-Mails auf dem Server bleiben erhalten.`,
          `Remove mailbox “${account.name}” from MiniMail? Messages on the mail server will remain.`,
        ),
      )
    )
      return;
    try {
      await api(`/accounts/${account.id}`, { method: "DELETE" });
      onDeleted(account.id);
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal settings-modal">
        <div className="modal-header">
          <div>
            <div className="eyebrow">{t("MINIMAIL")}</div>
            <h2>{t("Einstellungen")}</h2>
            <p>{t("Postfächer, Benutzer und Darstellung verwalten.")}</p>
          </div>
          <button className="icon-button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="settings-body">
          <h3>{t("Verbundene Postfächer")}</h3>
          {accounts.map((account) => (
            <div className="settings-account" key={account.id}>
              <div className="account-badge">
                {account.name[0]?.toUpperCase()}
              </div>
              <div>
                <strong>{account.name}</strong>
                <span>{account.email}</span>
                <span>
                  {account.check_interval_minutes === 0
                    ? t("Automatischer Abruf aus")
                    : choose(
                        `Alle ${account.check_interval_minutes} Minuten`,
                        `Every ${account.check_interval_minutes} minutes`,
                      ) +
                      ` · ${
                        account.check_failed
                          ? t("Prüfung fehlgeschlagen")
                          : account.last_checked_at
                            ? choose("zuletzt", "last checked") +
                              ` ${new Date(account.last_checked_at).toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" })}`
                            : t("noch nicht geprüft")
                      }`}
                </span>
              </div>
              <button
                className={`primary-account-button ${account.is_primary ? "is-primary" : ""}`}
                title={
                  account.is_primary
                    ? t("Primärpostfach")
                    : t("Als Primärpostfach festlegen")
                }
                onClick={() => makePrimary(account.id)}
                disabled={account.is_primary || primaryBusy}
              >
                <Star
                  size={14}
                  fill={account.is_primary ? "currentColor" : "none"}
                />
                {account.is_primary ? t("Primär") : t("Als primär")}
              </button>
              <button onClick={() => onEdit(account)}>{t("Bearbeiten")}</button>
              <button
                onClick={() => onCrypto(account)}
                title={t("Verschlüsselung und Schlüssel")}
              >
                <LockKeyhole size={14} /> {t("Schlüssel")}
              </button>
              <button
                className="danger-icon"
                title={t("Entfernen")}
                onClick={() => remove(account)}
              >
                <Trash2 size={17} />
              </button>
            </div>
          ))}
          <button className="settings-add" onClick={onAdd}>
            <Plus size={17} />
            {t(" Weiteres Postfach verbinden\n          ")}
          </button>
          <h3>{t("Adressbuch")}</h3>
          <div className="settings-row">
            <div>
              <strong>{t("Kontakte verwalten")}</strong>
              <span>{t("Adressen suchen, hinzufügen und bearbeiten.")}</span>
            </div>
            <button type="button" onClick={onOpenContacts}>
              <Contact size={16} /> {t("Öffnen")}
            </button>
          </div>
          <div className="settings-row">
            <div>
              <strong>{t("Gesendete Empfänger automatisch merken")}</strong>
              <span>
                {t(
                  "Neue Adressen nach erfolgreichem Senden im Adressbuch speichern.",
                )}
              </span>
            </div>
            <button
              type="button"
              aria-pressed={!!auth.user.collectRecipients}
              disabled={collectBusy}
              onClick={toggleCollection}
            >
              {auth.user.collectRecipients ? t("Ein") : t("Aus")}
            </button>
          </div>
          <AiSettings
            request={api}
            isAdmin={auth.user.role === "admin"}
            setError={setError}
          />
          {auth.user.role === "admin" && (
            <UserManagement
              request={api}
              currentUsername={auth.user.username}
              setError={setError}
            />
          )}
          <h3>{t("Darstellung")}</h3>
          <div className="settings-row">
            <div>
              <strong>{t("Farbschema")}</strong>
              <span>{t("Wähle deinen bevorzugten Modus.")}</span>
            </div>
            <button
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? <Sun size={17} /> : <Moon size={17} />}{" "}
              {theme === "light" ? t("Hell") : t("Dunkel")}
            </button>
          </div>
          <div className="settings-row">
            <div>
              <strong>{t("Sprache")}</strong>
              <span>{t("Wähle die Sprache der Oberfläche.")}</span>
            </div>
            <select
              className="language-select"
              aria-label={t("Sprache")}
              value={language}
              onChange={(event) => onLanguageChange(event.target.value)}
            >
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            </select>
          </div>
          <div className="settings-row">
            <div>
              <strong>{t("Konversationsansicht")}</strong>
              <span>
                {t("Zusammengehörige E-Mails als aufklappbare Kette anzeigen.")}
              </span>
            </div>
            <button
              type="button"
              aria-pressed={threaded}
              onClick={() => onThreadedChange(!threaded)}
            >
              {threaded ? t("Ein") : t("Aus")}
            </button>
          </div>
          <h3>{t("Sicherheit")}</h3>
          <div className="settings-row">
            <div>
              <strong>{t("Zwei-Faktor-Anmeldung")}</strong>
              <span>
                {choose(
                  `Für ${auth.user.username} aktiviert`,
                  `Enabled for ${auth.user.username}`,
                )}
              </span>
            </div>
            <ShieldCheck size={20} className="secure-green" />
          </div>
          <button className="logout-button" onClick={onLogout}>
            {t("\n            Abmelden\n          ")}
          </button>
        </div>
      </div>
    </div>
  );
}
