import { useState } from "react";
import { Download, LoaderCircle, Search, Trash2 } from "lucide-react";
import { api } from "../mailUi.js";
import { t } from "../i18n.js";
import { browserZone } from "./calendarUi.js";
import CalendarDialog from "./CalendarDialog.jsx";

export default function CalendarConnection({
  calendar,
  onClose,
  onSaved,
  setError,
}) {
  const [form, setForm] = useState(() => ({
    name: "",
    color: "#5267df",
    kind: "local",
    url: "",
    username: "",
    password: "",
    readOnly: false,
    timezone: browserZone(),
    ...calendar,
  }));
  const [found, setFound] = useState([]),
    [busy, setBusy] = useState(false);
  const set = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(
        calendar ? `/calendar/calendars/${calendar.id}` : "/calendar/calendars",
        { method: calendar ? "PATCH" : "POST", body: form },
      );
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function discover() {
    setBusy(true);
    try {
      const results = await api("/calendar/discover", {
        method: "POST",
        body: form,
      });
      setFound(results);
      if (!results.length)
        setError(
          t(
            "Keine CalDAV-Kalender gefunden. Bitte eine direkte Kalenderadresse verwenden.",
          ),
        );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (
      !window.confirm(
        t(
          "Kalender aus MiniMail entfernen? Lokale Termine werden gelöscht; Online-Kalender bleiben auf ihrem Server erhalten.",
        ),
      )
    )
      return;
    setBusy(true);
    try {
      await api(`/calendar/calendars/${calendar.id}`, { method: "DELETE" });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <CalendarDialog
      title={t(calendar ? "Kalender verwalten" : "Kalender hinzufügen")}
      onClose={() => !busy && onClose()}
    >
      <form className="calendar-editor" onSubmit={save}>
        <div className="calendar-dialog-content">
          <fieldset className="calendar-fields" disabled={busy}>
            <label className="calendar-full">
              {t("Name")}
              <input
                required
                maxLength={200}
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </label>
            <label>
              {t("Kalendertyp")}
              <select
                value={form.kind}
                disabled={!!calendar}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    kind: e.target.value,
                    readOnly: e.target.value === "ics",
                  }))
                }
              >
                <option value="local">{t("Lokal in MiniMail")}</option>
                <option value="ics">{t("iCalendar / Webcal")}</option>
                <option value="caldav">CalDAV</option>
              </select>
            </label>
            <label>
              {t("Kalenderfarbe")}
              <input
                type="color"
                value={form.color}
                onChange={(e) => set("color", e.target.value)}
              />
            </label>
            {form.kind !== "local" && (
              <>
                <label className="calendar-full">
                  {t(
                    form.kind === "caldav"
                      ? "CalDAV-Adresse oder Serveradresse"
                      : "iCalendar-/Webcal-Adresse",
                  )}
                  <input
                    required
                    maxLength={2000}
                    autoComplete="off"
                    value={form.url}
                    onChange={(e) => set("url", e.target.value)}
                    placeholder="https://calendar.example.org/…"
                  />
                </label>
                <label>
                  {t("Benutzername (optional)")}
                  <input
                    autoComplete="off"
                    value={form.username}
                    maxLength={500}
                    onChange={(e) => set("username", e.target.value)}
                  />
                </label>
                <label>
                  {t("App-Passwort (optional)")}
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={form.password}
                    maxLength={2000}
                    placeholder={
                      calendar?.hasPassword
                        ? t("Gespeichertes Passwort bleibt erhalten")
                        : ""
                    }
                    onChange={(e) => set("password", e.target.value)}
                  />
                </label>
                {calendar?.hasPassword && (
                  <label className="calendar-checkbox calendar-full">
                    <input
                      type="checkbox"
                      checked={!!form.clearPassword}
                      onChange={(e) => set("clearPassword", e.target.checked)}
                    />
                    {t("Gespeichertes Kalenderpasswort entfernen")}
                  </label>
                )}
                {form.kind === "caldav" && (
                  <div className="calendar-full">
                    <button
                      type="button"
                      disabled={!form.url || busy}
                      onClick={discover}
                    >
                      <Search size={16} />
                      {t("Kalender auf dem Server suchen")}
                    </button>
                  </div>
                )}
                {found.length > 0 && (
                  <div className="calendar-discovered calendar-full">
                    {found.map((entry) => (
                      <button
                        type="button"
                        key={entry.url}
                        onClick={() => {
                          setForm((f) => ({
                            ...f,
                            url: entry.url,
                            name: f.name || entry.name,
                            color: /^#[0-9a-f]{6}$/i.test(entry.color)
                              ? entry.color
                              : f.color,
                            readOnly: entry.readOnly,
                          }));
                          setFound([]);
                        }}
                      >
                        <strong>{entry.name}</strong>
                        <span>{entry.url}</span>
                      </button>
                    ))}
                  </div>
                )}
                <label className="calendar-checkbox calendar-full">
                  <input
                    type="checkbox"
                    checked={form.readOnly}
                    onChange={(e) => set("readOnly", e.target.checked)}
                  />
                  {t("Schreibgeschützt abonnieren")}
                </label>
                {form.kind === "ics" && !form.readOnly && (
                  <p className="calendar-note calendar-full">
                    {t(
                      "Schreibzugriff benötigt HTTP PUT und ETags. Dabei wird die gesamte Kalenderdatei aktualisiert. Öffentliche Abonnements sind meist schreibgeschützt.",
                    )}
                  </p>
                )}
                <p className="calendar-field-hint calendar-full">
                  {t(
                    "Zugangsdaten und Kalenderadressen werden verschlüsselt auf deinem MiniMail-Server gespeichert. Die Verbindung erfolgt direkt zum Kalenderanbieter über HTTPS.",
                  )}
                </p>
              </>
            )}
            <p className="calendar-note calendar-full">
              {t(
                "Dieser Kalender gehört nur deinem MiniMail-Benutzerkonto. Berechtigungen und Freigaben auf einem externen Kalenderserver gelten zusätzlich.",
              )}
            </p>
          </fieldset>
        </div>
        <div className="calendar-dialog-footer">
          <div>
            {calendar && (
              <>
                <a
                  className="calendar-button"
                  href={`/api/calendar/calendars/${calendar.id}/export`}
                  download
                >
                  <Download size={16} />
                  {t("Exportieren")}
                </a>
                <button
                  type="button"
                  className="calendar-danger"
                  onClick={remove}
                  disabled={busy}
                >
                  <Trash2 size={16} />
                </button>
              </>
            )}
          </div>
          <div>
            <button type="button" disabled={busy} onClick={onClose}>
              {t("Abbrechen")}
            </button>
            <button className="primary-button" disabled={busy} type="submit">
              {busy && <LoaderCircle size={16} className="spin" />}
              {t(calendar ? "Speichern" : "Verbinden")}
            </button>
          </div>
        </div>
      </form>
    </CalendarDialog>
  );
}
