import { useEffect, useRef, useState } from "react";
import {
  Info,
  ListFilter,
  DatabaseBackup,
  RefreshCw,
  ChevronRight,
  Contact,
  Globe,
  Inbox,
  LockKeyhole,
  Monitor,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { t } from "./i18n.js";
import { api } from "./mailUi.js";
import { settingsPage, settingsPages } from "./settingsPages.js";
import AiSettings from "./AiSettings.jsx";
import UserManagement from "./UserManagement.jsx";
import MailboxSettings from "./settings/MailboxSettings.jsx";
import ContactSettings from "./settings/ContactSettings.jsx";
import AppearanceSettings from "./settings/AppearanceSettings.jsx";
import SecuritySettings from "./settings/SecuritySettings.jsx";
import UpdateSettings from "./settings/UpdateSettings.jsx";
import BackupSettings from "./settings/BackupSettings.jsx";
import MailFilterSettings from "./settings/MailFilterSettings.jsx";

const icons = {
  mailboxes: Inbox,
  filters: ListFilter,
  contacts: Contact,
  appearance: Monitor,
  security: ShieldCheck,
  ai: Sparkles,
  users: Users,
  updates: RefreshCw,
  backups: DatabaseBackup,
};

export default function SettingsModal({
  accounts,
  accountId,
  auth,
  page = "mailboxes",
  onPageChange = () => {},
  onClose,
  onEdit,
  onCrypto,
  onAdd,
  onOpenContacts,
  onCollectRecipientsChange,
  onLogout,
  setTheme,
  theme = "light",
  language = "de",
  onLanguageChange,
  threaded = false,
  onThreadedChange,
  hideRead = false,
  onHideReadChange,
  setError,
  onDeleted,
  onPrimary,
}) {
  const role = auth.user.role;
  const isAdmin = role === "admin";
  const available = settingsPages(role);
  const current = settingsPage(role, page);
  const PageIcon = icons[current.id];
  const [visited, setVisited] = useState(() => new Set([current.id]));
  const panel = useRef(null);
  const dialog = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.querySelector('[aria-current="page"]')?.focus();
    function keydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = [
        ...dialog.current.querySelectorAll(
          'button:not(:disabled),select:not(:disabled),input:not(:disabled),a[href],[tabindex="0"]',
        ),
      ].filter((element) => element.getClientRects().length);
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus?.();
    };
  }, []);
  useEffect(() => {
    if (panel.current) panel.current.scrollTop = 0;
  }, [current.id]);

  function navigate(id) {
    setVisited((value) => new Set([...value, id]));
    onPageChange(id);
  }
  const footerHint =
    current.id === "appearance"
      ? t("Änderungen werden sofort übernommen.")
      : current.id === "ai" && isAdmin
        ? t("KI-Änderungen mit Speichern übernehmen.")
        : current.group === "shared"
          ? t(
              "Die Verwaltung gemeinsamer Einstellungen ist Administratoren vorbehalten.",
            )
          : t(
              "Deine persönlichen Daten bleiben deinem Benutzerkonto zugeordnet.",
            );

  return (
    <div
      className="modal-backdrop settings-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal settings-modal settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        ref={dialog}
      >
        <div className="modal-header settings-header">
          <div>
            <div className="eyebrow">MINIMAIL</div>
            <h2 id="settings-title">{t("Einstellungen")}</h2>
            <p>{t("Persönliche Einstellungen und Verwaltung an einem Ort.")}</p>
          </div>
          <div className="settings-header-actions">
            <div className="settings-user">
              <strong>{auth.user.username}</strong>
              <span>{isAdmin ? t("Administrator") : t("Benutzer")}</span>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label={t("Einstellungen schließen")}
              onClick={onClose}
            >
              <X size={21} />
            </button>
          </div>
        </div>
        <div className="settings-layout">
          <aside className="settings-navigation">
            <nav aria-label={t("Einstellungsbereiche")}>
              {[
                ["personal", t("Mein Bereich")],
                ["shared", isAdmin ? t("Administration") : t("Funktionen")],
              ].map(([group, title]) => (
                <div className="settings-nav-group" key={group}>
                  <div className="settings-nav-label">{title}</div>
                  {available
                    .filter((entry) => entry.group === group)
                    .map((entry) => {
                      const Icon = icons[entry.id];
                      return (
                        <button
                          type="button"
                          key={entry.id}
                          aria-current={
                            current.id === entry.id ? "page" : undefined
                          }
                          aria-controls={
                            visited.has(entry.id) || entry.id === current.id
                              ? `settings-page-${entry.id}`
                              : undefined
                          }
                          onClick={() => navigate(entry.id)}
                        >
                          <Icon size={18} />
                          <span>{t(entry.title)}</span>
                          <ChevronRight size={14} />
                        </button>
                      );
                    })}
                </div>
              ))}
            </nav>
            <div className="settings-nav-footer">
              <ShieldCheck size={17} />
              <span>
                {t("Persönliches und gemeinsame Einstellungen sind getrennt.")}
              </span>
            </div>
          </aside>
          <div className="settings-main" ref={panel}>
            {available
              .filter(
                (entry) => visited.has(entry.id) || entry.id === current.id,
              )
              .map((entry) => (
                <section
                  className="settings-page"
                  id={`settings-page-${entry.id}`}
                  key={entry.id}
                  hidden={entry.id !== current.id}
                  aria-labelledby={`settings-heading-${entry.id}`}
                >
                  <header className="settings-page-heading">
                    <div>
                      <span
                        className={`settings-scope ${entry.group === "shared" ? "shared" : ""}`}
                      >
                        {entry.group === "shared" ? (
                          <Globe size={12} />
                        ) : (
                          <LockKeyhole size={12} />
                        )}
                        {t(entry.scope)}
                      </span>
                      <h3 id={`settings-heading-${entry.id}`}>
                        {t(entry.title)}
                      </h3>
                      <p>{t(entry.description)}</p>
                    </div>
                    {entry.id === current.id && (
                      <div className="settings-page-icon">
                        <PageIcon size={26} />
                      </div>
                    )}
                  </header>
                  {entry.id === "mailboxes" && (
                    <MailboxSettings
                      accounts={accounts}
                      onAdd={onAdd}
                      onEdit={onEdit}
                      onCrypto={onCrypto}
                      onPrimary={onPrimary}
                      onDeleted={onDeleted}
                      setError={setError}
                    />
                  )}
                  {entry.id === "filters" && (
                    <MailFilterSettings
                      accounts={accounts}
                      accountId={accountId}
                      visible={current.id === "filters"}
                    />
                  )}
                  {entry.id === "contacts" && (
                    <ContactSettings
                      auth={auth}
                      onOpenContacts={onOpenContacts}
                      onCollectRecipientsChange={onCollectRecipientsChange}
                      setError={setError}
                    />
                  )}
                  {entry.id === "appearance" && (
                    <AppearanceSettings
                      theme={theme}
                      setTheme={setTheme}
                      language={language}
                      onLanguageChange={onLanguageChange}
                      threaded={threaded}
                      onThreadedChange={onThreadedChange}
                      hideRead={hideRead}
                      onHideReadChange={onHideReadChange}
                    />
                  )}
                  {entry.id === "security" && (
                    <SecuritySettings auth={auth} onLogout={onLogout} />
                  )}
                  {entry.id === "updates" && (
                    <UpdateSettings setError={setError} />
                  )}
                  {entry.id === "backups" && isAdmin && (
                    <BackupSettings setError={setError} />
                  )}
                  {entry.id === "ai" && (
                    <>
                      <div className="settings-note">
                        <Globe size={17} />
                        <p>
                          {t(
                            "Die KI-Verbindung gilt für alle Benutzer. Nur Administratoren können sie ändern; andere Benutzer sehen nur die Verfügbarkeit.",
                          )}
                        </p>
                      </div>
                      <AiSettings
                        request={api}
                        isAdmin={isAdmin}
                        setError={setError}
                        showHeading={false}
                      />
                    </>
                  )}
                  {entry.id === "users" && isAdmin && (
                    <UserManagement
                      request={api}
                      currentUsername={auth.user.username}
                      setError={setError}
                      showHeading={false}
                    />
                  )}
                </section>
              ))}
          </div>
        </div>
        <div className="settings-footer">
          <p>
            <Info size={14} />
            {footerHint}
          </p>
          <button type="button" className="settings-close" onClick={onClose}>
            {t("Schließen")}
          </button>
        </div>
      </div>
    </div>
  );
}
