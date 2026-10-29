import { useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";
import { api } from "../mailUi.js";
import { t, dateLocale } from "../i18n.js";

export default function CalendarReminders({ username, onOpen, setError }) {
  const [alerts, setAlerts] = useState([]),
    shown = useRef(new Set());
  useEffect(() => {
    let active = true,
      busy = false;
    shown.current = new Set();
    setAlerts([]);
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const result = await api("/calendar/alerts");
        if (!active) return;
        setAlerts(result);
        for (const alert of result) {
          const key = `${alert.itemId}:${alert.occurrence}`;
          if (shown.current.has(key)) continue;
          shown.current.add(key);
          if (
            document.hidden &&
            "Notification" in window &&
            Notification.permission === "granted"
          ) {
            const notification = new Notification(alert.title, {
              body: new Date(alert.start).toLocaleString(dateLocale()),
              tag: `minimail-calendar-${key}`,
            });
            notification.onclick = () => {
              window.focus();
              onOpen(alert.itemId);
              notification.close();
            };
          }
        }
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
