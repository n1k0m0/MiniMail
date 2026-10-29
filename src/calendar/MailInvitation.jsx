import { useState } from "react";
import { CalendarDays, Check, LoaderCircle } from "lucide-react";
import { api } from "../mailUi.js";
import { t } from "../i18n.js";

export default function MailInvitation({
  message,
  accountId,
  folder,
  onOpen,
  setError,
}) {
  const [items, setItems] = useState(message.calendarInvitations || []),
    [busy, setBusy] = useState(false);
  if (!message.hasInvitations) return null;
  async function add() {
    setBusy(true);
    try {
      const result = await api(
        `/calendar/mail/${accountId}/${message.uid}?folder=${encodeURIComponent(folder)}`,
        { method: "POST" },
      );
      if (!result.length)
        setError(
          t(
            "Keine passende Einladung gefunden. Bitte einen lokalen Zielkalender auswählen oder die ICS-Datei über den Kalender importieren.",
          ),
        );
      setItems(result);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mail-invitation" aria-label={t("Kalendereinladung")}>
      <CalendarDays size={22} />
      <div>
        <strong>{t("Kalendereinladung")}</strong>
        {items.length ? (
          items.map((item) => (
            <div key={item.id}>
              <span>{item.title}</span>
              <button onClick={() => onOpen(item.id)}>
                <Check size={14} />
                {t(
                  item.cancelled
                    ? "Absage im Kalender ansehen"
                    : "Im Kalender öffnen und antworten",
                )}
              </button>
            </div>
          ))
        ) : (
          <p>
            {t(
              "Diese Nachricht enthält Kalenderdaten. Antworten werden erst nach deinem Klick versendet.",
            )}
          </p>
        )}
      </div>
      {!items.length && (
        <button onClick={add} disabled={busy}>
          {busy ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <CalendarDays size={16} />
          )}
          {t("In Kalender übernehmen")}
        </button>
      )}
    </section>
  );
}
