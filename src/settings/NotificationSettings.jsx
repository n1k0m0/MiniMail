import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { t } from "../i18n.js";
import { notificationSupport, showNotification } from "../notifications.js";
import SettingsRow from "./SettingsRow.jsx";

export default function NotificationSettings({
  preferences,
  onChange,
  setError,
}) {
  const [permission, setPermission] = useState(() =>
    notificationSupport() ? Notification.permission : "unsupported",
  );
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const update = () =>
      setPermission(
        notificationSupport() ? Notification.permission : "unsupported",
      );
    window.addEventListener("focus", update);
    return () => window.removeEventListener("focus", update);
  }, []);
  async function toggle(kind) {
    if (preferences[kind]) return onChange({ ...preferences, [kind]: false });
    setBusy(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === "granted") onChange({ ...preferences, [kind]: true });
    } catch {
      setError(t("Browserbenachrichtigungen konnten nicht aktiviert werden."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {[
        [
          "mail",
          "Neue E-Mails",
          "Bei neuen Nachrichten in deinen Posteingängen benachrichtigen. Es gelten die Abrufintervalle der Postfächer.",
        ],
        [
          "calendar",
          "Terminerinnerungen",
          "Zum eingestellten Erinnerungszeitpunkt eines Termins benachrichtigen. Erinnerungen in MiniMail bleiben immer sichtbar.",
        ],
      ].map(([kind, title, description]) => (
        <SettingsRow key={kind} title={title} description={description}>
          <button
            type="button"
            aria-label={t(title)}
            aria-pressed={preferences[kind]}
            disabled={
              busy ||
              (!preferences[kind] &&
                ["unsupported", "denied"].includes(permission))
            }
            onClick={() => toggle(kind)}
          >
            {preferences[kind] ? t("Ein") : t("Aus")}
          </button>
        </SettingsRow>
      ))}
      <p className="muted" role="status">
        {t(
          permission === "unsupported"
            ? "Dieser Browser unterstützt hier keine Benachrichtigungen. HTTPS und ein unterstützter Desktopbrowser sind erforderlich."
            : permission === "denied"
              ? "Benachrichtigungen sind im Browser gesperrt. Erlaube sie in den Website-Einstellungen und in den Benachrichtigungseinstellungen deines Betriebssystems."
              : "MiniMail muss in einem geöffneten Tab bleiben. Browser und Betriebssystem steuern, ob Pop-ups erscheinen; Fokusmodus kann sie unterdrücken.",
        )}
      </p>
      <button
        type="button"
        disabled={permission !== "granted"}
        onClick={() => {
          if (
            !showNotification("MiniMail", {
              body: t("Benachrichtigungen funktionieren."),
              tag: "minimail-test",
            })
          )
            setError(
              t("Browserbenachrichtigungen konnten nicht aktiviert werden."),
            );
        }}
      >
        <Bell size={16} />
        {t("Testbenachrichtigung")}
      </button>
    </>
  );
}
