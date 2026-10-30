import { useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import { api } from "../mailUi.js";
import { t, dateLocale } from "../i18n.js";
import { notifyOnce, showNotification } from "../notifications.js";

export default function CalendarReminders({
  username,
  desktopEnabled = false,
  onOpen,
  setError,
}) {
  const [alerts, setAlerts] = useState([]),
    shown = useRef(new Set());
  const current = useRef({ desktopEnabled, onOpen });
  current.current = { desktopEnabled, onOpen };
  useEffect(() => {
    let active = true,
      busy = false;
    shown.current = new Set();
    setAlerts([]);
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const result = await api(
          `/calendar/alerts?timezone=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC")}`,
        );
        if (!active) return;
        setAlerts(result);
        for (const alert of result) {
          const key = `${alert.itemId}:${alert.occurrence}:${alert.snoozeUntil || ""}`;
          if (shown.current.has(key)) continue;
          shown.current.add(key);
          if (current.current.desktopEnabled)
            void notifyOnce(username, "calendar", key, () => {
              if (!active || !current.current.desktopEnabled) return false;
              return showNotification(
                "MiniMail",
                {
                  body: `${t("Terminerinnerung")}: ${new Date(alert.start).toLocaleString(dateLocale())}`,
                  tag: `minimail-calendar-${key}`,
                },
                () => {
                  if (active) current.current.onOpen(alert.itemId);
                },
              );
            });
        }
        shown.current = new Set(
          result.map(
            (alert) =>
              `${alert.itemId}:${alert.occurrence}:${alert.snoozeUntil || ""}`,
          ),
        );
      } catch {
      } finally {
        busy = false;
      }
    };
    poll();
    const timer = setInterval(poll, 60000);
    window.addEventListener("focus", poll);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", poll);
    };
  }, [username]);
  async function action(alert, dismiss, minutes = 10) {
    try {
      await api("/calendar/alerts", {
        method: "POST",
        body: { ...alert, dismiss, minutes },
      });
      setAlerts((rows) => rows.filter((r) => r !== alert));
    } catch (error) {
      setError(error.message);
    }
  }
  if (!alerts.length) return null;
  return (
    <aside
      className="calendar-reminders"
      aria-label={t("Kalendererinnerungen")}
      aria-live="polite"
    >
      <header>
        <Bell size={17} />
        <strong>{t("Erinnerungen")}</strong>
        <span>{alerts.length}</span>
      </header>
      {alerts.map((alert) => (
        <div
          key={`${alert.itemId}:${alert.occurrence}`}
          className="calendar-reminder"
        >
          <button
            onClick={() => onOpen(alert.itemId)}
            className="calendar-reminder-title"
          >
            <span style={{ background: alert.color }} />
            <strong>{alert.title}</strong>
            <small>{new Date(alert.start).toLocaleString(dateLocale())}</small>
          </button>
          <div>
            <button onClick={() => action(alert, false)}>
              {t("10 Min. später")}
            </button>
            <button onClick={() => action(alert, true)}>
              <X size={14} />
              {t("Verwerfen")}
            </button>
          </div>
        </div>
      ))}
    </aside>
  );
}
