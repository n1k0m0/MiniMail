import { useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  Copy,
  Download,
  LoaderCircle,
  Mail,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../mailUi.js";
import { t, choose } from "../i18n.js";
import { eventForm, timezones } from "./calendarUi.js";
import CalendarDialog from "./CalendarDialog.jsx";
import { DateTime } from "luxon";

export default function EventEditor({
  event,
  calendars,
  accounts,
  defaultCalendarId,
  zone,
  onClose,
  onSaved,
  setError,
  notify,
}) {
  const [form, setForm] = useState(() =>
    eventForm(event, defaultCalendarId, zone),
  );
  const initial = useRef(form);
  const normalized = (data) =>
    JSON.stringify({
      ...data,
      calendarId: Number(data.calendarId),
      scope: "",
      recurrenceId: "",
    });
  const original = event?.id
    ? eventForm(
        form.scope === "series" && event.master ? event.master : event,
        defaultCalendarId,
        zone,
      )
    : initial.current;
  const dirty = normalized(form) !== normalized(original);
  function close() {
    if (
      !busy &&
      (!dirty ||
        window.confirm(t("Ungespeicherte Kalenderänderungen verwerfen?")))
    )
      onClose();
  }
  const [busy, setBusy] = useState(false),
    [attendee, setAttendee] = useState("");
  const [accountId, setAccountId] = useState(
    () =>
      accounts.find((a) =>
        event?.attendees?.some(
          (p) => p.email.toLowerCase() === a.email.toLowerCase(),
        ),
      )?.id ||
      accounts.find((a) => a.email.toLowerCase() === event?.organizer)?.id ||
      accounts.find((a) => a.is_primary)?.id ||
      accounts[0]?.id ||
      "",
  );
  const calendar = calendars.find((c) => c.id === Number(form.calendarId));
  const readOnly = !!calendar?.readOnly,
    task = form.kind === "vtodo";
  const set = (key, value) => setForm((old) => ({ ...old, [key]: value }));
  const canRespond = event?.attendees?.some((p) =>
    accounts.some((a) => a.email.toLowerCase() === p.email.toLowerCase()),
  );
  const organizerAccount = accounts.find(
    (a) => a.email.toLowerCase() === form.organizer.toLowerCase(),
  );
  const busyRun = async (callback) => {
    setBusy(true);
    try {
      await callback();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  async function save(e) {
    e.preventDefault();
    await busyRun(async () => {
      const payload = {
        ...form,
        calendarId: Number(form.calendarId),
        version: event?.version,
      };
      if (!payload.organizer) delete payload.organizer;
      if (event?.id) {
        const original = eventForm(
          form.scope === "series" && event.master ? event.master : event,
          defaultCalendarId,
          zone,
        );
        for (const field of [
          "attendees",
          "reminder",
          "organizer",
          "recurrence",
          "categories",
          "description",
          "location",
          "url",
          "privacy",
          "availability",
          "status",
          "priority",
          "percent",
          "title",
        ])
          if (
            JSON.stringify(payload[field]) === JSON.stringify(original[field])
          )
            delete payload[field];
      }
      const value = await api(
        event?.id
          ? `/calendar/events/${event.id}${Number(form.calendarId) !== event.calendarId ? "/move" : ""}`
          : `/calendar/calendars/${form.calendarId}/events`,
        {
          method:
            event?.id && Number(form.calendarId) === event.calendarId
              ? "PATCH"
              : "POST",
          body: payload,
        },
      );
      notify(t("Termin gespeichert."));
      onSaved(value);
      onClose();
    });
  }
  async function remove() {
    if (
      !window.confirm(
        t(
          form.scope === "occurrence"
            ? "Diese einzelne Wiederholung löschen?"
            : "Diesen Eintrag einschließlich aller Wiederholungen löschen?",
        ),
      )
    )
      return;
    await busyRun(async () => {
      await api(`/calendar/events/${event.id}`, {
        method: "DELETE",
        body: {
          version: event.version,
          recurrenceId:
            form.scope === "occurrence" ? event.recurrenceId : undefined,
        },
      });
      notify(t("Eintrag gelöscht."));
      onSaved();
      onClose();
    });
  }
  async function respond(status, method = "REPLY") {
    if (dirty) {
      setError(t("Bitte Änderungen zuerst speichern."));
      return;
    }
    if (
      !window.confirm(
        t(
          method === "REPLY"
            ? "Diese Antwort per E-Mail an den Organisator senden?"
            : method === "CANCEL"
              ? "Absage per E-Mail an alle Teilnehmer senden?"
              : "Einladung per E-Mail an alle Teilnehmer senden?",
        ),
      )
    )
      return;
    await busyRun(async () => {
      const value = await api(`/calendar/events/${event.id}/respond`, {
        method: "POST",
        body: {
          version: event.version,
          accountId: Number(
            method === "REPLY" ? accountId : organizerAccount?.id,
          ),
          status,
          method,
        },
      });
      notify(value.syncWarning || t("Kalendernachricht versendet."));
      onSaved(value);
      onClose();
    });
  }
  async function duplicate() {
    await busyRun(async () => {
      const payload = {
        ...form,
        title: `${form.title} (${t("Kopie")})`,
        recurrenceId: "",
        scope: "series",
      };
      if (!payload.organizer) delete payload.organizer;
      const target =
        calendars.find(
          (c) => c.id === Number(defaultCalendarId) && !c.readOnly,
        ) || calendars.find((c) => !c.readOnly);
      if (!target)
        throw new Error(t("Ein beschreibbarer Kalender wird benötigt."));
      await api(`/calendar/calendars/${target.id}/events`, {
        method: "POST",
        body: payload,
      });
      notify(t("Kopie gespeichert."));
      onSaved();
      onClose();
    });
  }
  function changeScope(scope) {
    setForm((old) => ({
      ...eventForm(
        scope === "series"
          ? {
              ...event.master,
              id: event.id,
              calendarId: event.calendarId,
              version: event.version,
            }
          : event,
        form.calendarId,
        zone,
      ),
      scope,
      recurrenceId: event.recurrenceId,
    }));
  }
  const recurrenceOptions = [
    ["", "Keine Wiederholung"],
    ["FREQ=DAILY", "Täglich"],
    ["FREQ=WEEKLY", "Wöchentlich"],
    ["FREQ=MONTHLY", "Monatlich"],
    ["FREQ=YEARLY", "Jährlich"],
  ];
  return (
    <CalendarDialog
      title={t(
        task ? "Aufgabe" : event?.id ? "Termin bearbeiten" : "Neuer Termin",
      )}
      onClose={close}
      wide
    >
      <form onSubmit={save} className="calendar-editor">
        <div className="calendar-dialog-content">
          {readOnly && (
            <p className="calendar-note">
              {t(
                "Dieser Kalender ist schreibgeschützt. Du kannst den Eintrag in einen eigenen Kalender kopieren.",
              )}
            </p>
          )}
          {event?.recurring && event.recurrenceId && (
            <label className="calendar-scope">
              {t("Änderungen anwenden auf")}
              <select
                value={form.scope}
                disabled={busy || readOnly}
                onChange={(e) => changeScope(e.target.value)}
              >
                <option value="occurrence">
                  {t("Nur diese Wiederholung")}
                </option>
                <option value="series">{t("Die gesamte Serie")}</option>
              </select>
            </label>
          )}
          <fieldset disabled={busy || readOnly} className="calendar-fields">
            <label className="calendar-full">
              {t("Titel")}
              <input
                required
                maxLength={500}
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
              />
            </label>
            <label>
              {t("Kalender")}
              <select
                value={form.calendarId}
                disabled={!!event?.recurrenceId && form.scope !== "series"}
                required
                onChange={(e) => set("calendarId", e.target.value)}
              >
                {calendars
                  .filter(
                    (c) =>
                      (!c.readOnly && !c.setupPending) ||
                      c.id === Number(form.calendarId),
                  )
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {t("Zeitzone")}
              <input
                list="event-timezones"
                value={form.timezone}
                onChange={(e) => set("timezone", e.target.value)}
              />
              <datalist id="event-timezones">
                {timezones().map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </datalist>
            </label>
            <label className="calendar-checkbox calendar-full">
              <input
                type="checkbox"
                checked={form.allDay}
                onChange={(e) => {
                  const allDay = e.target.checked;
                  setForm((f) => ({
                    ...f,
                    allDay,
                    start: allDay
                      ? f.start.slice(0, 10)
                      : `${f.start.slice(0, 10)}T09:00`,
                    end: allDay
                      ? f.end.slice(0, 10) <= f.start.slice(0, 10)
                        ? DateTime.fromISO(f.start)
                            .plus({ days: 1 })
                            .toISODate()
                        : f.end.slice(0, 10)
                      : `${f.end.slice(0, 10)}T10:00`,
                  }));
                }}
              />
              {t("Ganztägig")}
            </label>
            <label>
              {t(task ? "Beginn (optional)" : "Beginn")}
              <input
                type={form.allDay ? "date" : "datetime-local"}
                value={form.start}
                required={!task}
                onChange={(e) => set("start", e.target.value)}
              />
            </label>
            <label>
              {t(
                form.allDay
                  ? "Ende (exklusiv)"
                  : task
                    ? "Fällig am (optional)"
                    : "Ende",
              )}
              <input
                type={form.allDay ? "date" : "datetime-local"}
                value={form.end}
                onChange={(e) => set("end", e.target.value)}
              />
            </label>
            {form.allDay && (
              <p className="calendar-field-hint calendar-full">
                {t(
                  "Bei ganztägigen Terminen ist das Enddatum der erste Tag nach dem Termin.",
                )}
              </p>
            )}
            <label>
              {t("Ort")}
              <input
                maxLength={2000}
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
              />
            </label>
            <label>
              {t("Webseite / Videokonferenz")}
              <input
                type="url"
                maxLength={2000}
                value={form.url}
                onChange={(e) => set("url", e.target.value)}
              />
            </label>
            <label>
              {t("Wiederholung")}
              <select
                value={
                  recurrenceOptions.some(([v]) => v === form.recurrence)
                    ? form.recurrence
                    : "custom"
                }
                disabled={form.scope === "occurrence"}
                onChange={(e) =>
                  set(
                    "recurrence",
                    e.target.value === "custom"
                      ? "FREQ=WEEKLY;INTERVAL=2;COUNT=10"
                      : e.target.value,
                  )
                }
              >
                {recurrenceOptions.map(([v, label]) => (
                  <option key={v} value={v}>
                    {t(label)}
                  </option>
                ))}
                <option value="custom">{t("Benutzerdefiniert (RRULE)")}</option>
              </select>
            </label>
            <label>
              {t("Erinnerung")}
              <select
                value={form.reminder === null ? "" : form.reminder}
                onChange={(e) =>
                  set(
                    "reminder",
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              >
                <option value="">{t("Keine Erinnerung")}</option>
                {[0, 5, 10, 15, 30, 60, 120, 1440, 10080].map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes === 0
                      ? t("Bei Beginn")
                      : choose(
                          `${minutes} Minuten vorher`,
                          `${minutes} minutes before`,
                        )}
                  </option>
                ))}
                {form.reminder !== null &&
                  ![0, 5, 10, 15, 30, 60, 120, 1440, 10080].includes(
                    form.reminder,
                  ) && (
                    <option value={form.reminder}>
                      {form.reminder} {t("Minuten vorher")}
                    </option>
                  )}
              </select>
            </label>
            {form.recurrence && form.scope !== "occurrence" && (
              <label className="calendar-full">
                {t("Wiederholungsregel (RRULE)")}
                <input
                  value={form.recurrence}
                  maxLength={1000}
                  onChange={(e) => set("recurrence", e.target.value)}
                />
                <span className="calendar-field-hint">
                  {t(
                    "Beispiel: FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10. Importierte Ausnahmen bleiben erhalten.",
                  )}
                </span>
              </label>
            )}
            <label>
              {t("Status")}
              <select
                value={form.status}
                onChange={(e) => set("status", e.target.value)}
              >
                {(task
                  ? [
                      ["NEEDS-ACTION", "Offen"],
                      ["IN-PROCESS", "In Bearbeitung"],
                      ["COMPLETED", "Erledigt"],
                      ["CANCELLED", "Abgesagt"],
                    ]
                  : [
                      ["CONFIRMED", "Bestätigt"],
                      ["TENTATIVE", "Vorläufig"],
                      ["CANCELLED", "Abgesagt"],
                    ]
                ).map(([v, label]) => (
                  <option key={v} value={v}>
                    {t(label)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Privatsphäre")}
              <select
                value={form.privacy}
                onChange={(e) => set("privacy", e.target.value)}
              >
                <option value="PUBLIC">{t("Öffentlich")}</option>
                <option value="PRIVATE">{t("Privat")}</option>
                <option value="CONFIDENTIAL">{t("Vertraulich")}</option>
              </select>
            </label>
            <label>
              {t("Verfügbarkeit")}
              <select
                value={form.availability}
                onChange={(e) => set("availability", e.target.value)}
              >
                <option value="OPAQUE">{t("Beschäftigt")}</option>
                <option value="TRANSPARENT">{t("Frei")}</option>
              </select>
            </label>
            <label>
              {t("Kategorien (durch Komma getrennt)")}
              <input
                value={form.categories}
                maxLength={2000}
                onChange={(e) => set("categories", e.target.value)}
              />
            </label>
            {task && (
              <>
                <label>
                  {t("Priorität (0 = keine, 1 = hoch, 9 = niedrig)")}
                  <input
                    type="number"
                    min="0"
                    max="9"
                    value={form.priority}
                    onChange={(e) => set("priority", Number(e.target.value))}
                  />
                </label>
                <label>
                  {t("Fortschritt (%)")}
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={form.percent}
                    onChange={(e) => set("percent", Number(e.target.value))}
                  />
                </label>
              </>
            )}
            <label className="calendar-full">
              {t("Beschreibung")}
              <textarea
                rows={4}
                value={form.description}
                maxLength={30000}
                onChange={(e) => set("description", e.target.value)}
              />
            </label>
            <label className="calendar-full">
              {t("Organisator / Absender")}
              <select
                value={form.organizer}
                onChange={(e) => set("organizer", e.target.value)}
              >
                <option value="">{t("Keine Einladung versenden")}</option>
                {form.organizer &&
                  !accounts.some(
                    (a) =>
                      a.email.toLowerCase() === form.organizer.toLowerCase(),
                  ) && <option value={form.organizer}>{form.organizer}</option>}
                {accounts.map((a) => (
                  <option value={a.email} key={a.id}>
                    {a.email}
                  </option>
                ))}
              </select>
            </label>
            <div className="calendar-full calendar-attendees">
              <strong>{t("Teilnehmer")}</strong>
              {form.attendees.map((p, index) => (
                <div key={`${p.email}:${index}`}>
                  <Mail size={15} />
                  <span>{p.name ? `${p.name} <${p.email}>` : p.email}</span>
                  <small>
                    {t(
                      {
                        "NEEDS-ACTION": "Antwort ausstehend",
                        ACCEPTED: "Angenommen",
                        DECLINED: "Abgelehnt",
                        TENTATIVE: "Vorläufig",
                      }[p.status] || p.status,
                    )}
                  </small>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t("Teilnehmer entfernen")}
                    onClick={() =>
                      set(
                        "attendees",
                        form.attendees.filter((_, at) => at !== index),
                      )
                    }
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
              <div>
                <input
                  type="email"
                  value={attendee}
                  placeholder={t("E-Mail-Adresse des Teilnehmers")}
                  aria-label={t("Teilnehmer hinzufügen")}
                  onChange={(e) => setAttendee(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (
                      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(attendee) &&
                      !form.attendees.some((p) => p.email === attendee)
                    ) {
                      set("attendees", [
                        ...form.attendees,
                        {
                          email: attendee.toLowerCase(),
                          name: "",
                          status: "NEEDS-ACTION",
                        },
                      ]);
                      setAttendee("");
                    }
                  }}
                >
                  <Plus size={16} />
                  {t("Hinzufügen")}
                </button>
              </div>
            </div>
          </fieldset>
          {form.privacy !== "PUBLIC" && (
            <p className="calendar-field-hint">
              {t(
                "Die Privatsphäre wird als Kalenderkennzeichnung gespeichert. Freigaben auf dem CalDAV-Server werden dadurch nicht geändert.",
              )}
            </p>
          )}
          {event?.id && !readOnly && (canRespond || organizerAccount) && (
            <div className="calendar-invitation-actions">
              <h4>{t("Einladung per E-Mail")}</h4>
              <p>
                {t(
                  "Änderungen zuerst speichern. Antworten und Einladungen werden nur nach deinem Klick versendet.",
                )}
              </p>
              {canRespond && (
                <>
                  <label>
                    {t("Antwort senden von")}
                    <select
                      value={accountId}
                      disabled={busy || dirty}
                      onChange={(e) => setAccountId(e.target.value)}
                    >
                      {accounts
                        .filter((a) =>
                          event.attendees.some(
                            (p) =>
                              p.email.toLowerCase() === a.email.toLowerCase(),
                          ),
                        )
                        .map((a) => (
                          <option value={a.id} key={a.id}>
                            {a.email}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div>
                    <button
                      type="button"
                      disabled={busy || dirty}
                      onClick={() => respond("ACCEPTED")}
                    >
                      <Check size={16} />
                      {t("Zusagen")}
                    </button>
                    <button
                      type="button"
                      disabled={busy || dirty}
                      onClick={() => respond("TENTATIVE")}
                    >
                      {t("Vorläufig zusagen")}
                    </button>
                    <button
                      type="button"
                      disabled={busy || dirty}
                      onClick={() => respond("DECLINED")}
                    >
                      {t("Ablehnen")}
                    </button>
                  </div>
                </>
              )}
              {organizerAccount && event.attendees?.length > 0 && (
                <div>
                  <button
                    type="button"
                    disabled={busy || dirty}
                    onClick={() => respond(null, "REQUEST")}
                  >
                    <Mail size={16} />
                    {t("Einladung / Update senden")}
                  </button>
                  <button
                    type="button"
                    disabled={busy || dirty}
                    onClick={() => respond(null, "CANCEL")}
                  >
                    {t("Termin absagen und informieren")}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="calendar-dialog-footer">
          <div>
            {event?.id && (
              <>
                <button
                  type="button"
                  className="calendar-danger"
                  disabled={busy || readOnly}
                  onClick={remove}
                >
                  <Trash2 size={16} />
                  {t("Löschen")}
                </button>
                <button type="button" disabled={busy} onClick={duplicate}>
                  <Copy size={16} />
                  {t("Kopieren")}
                </button>
              </>
            )}
          </div>
          <div>
            <button type="button" disabled={busy} onClick={close}>
              {t("Schließen")}
            </button>
            <button
              className="primary-button"
              disabled={busy || readOnly || !form.calendarId}
              type="submit"
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Save size={16} />
              )}
              {t("Speichern")}
            </button>
          </div>
        </div>
      </form>
    </CalendarDialog>
  );
}
