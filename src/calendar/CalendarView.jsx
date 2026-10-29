import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import deLocale from "@fullcalendar/core/locales/de";
import { DateTime } from "luxon";
import {
  Bell,
  CalendarDays,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Download,
  List,
  LoaderCircle,
  Mail,
  MoreHorizontal,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Settings,
  Upload,
  X,
} from "lucide-react";
import { api } from "../mailUi.js";
import { t, choose, getLanguage, dateLocale } from "../i18n.js";
import { browserZone, calendarTextColor, formTime } from "./calendarUi.js";
import EventEditor from "./EventEditor.jsx";
import CalendarConnection from "./CalendarConnection.jsx";
import "./calendar.css";

const plugins = [
  dayGridPlugin,
  timeGridPlugin,
  listPlugin,
  interactionPlugin,
  luxonPlugin,
];
const views = [
  ["dayGridMonth", "Monat"],
  ["timeGridWeek", "Woche"],
  ["timeGridDay", "Tag"],
  ["fourWeeks", "Mehrere Wochen"],
  ["listMonth", "Terminliste"],
  ["tasks", "Aufgaben"],
];
export default function CalendarView({
  username,
  accounts,
  onMail,
  onSettings,
  setError,
  notify,
  openEventId,
  onEventOpened,
}) {
  const [calendars, setCalendars] = useState([]),
    [preferences, setPreferences] = useState({
      autoImport: true,
      defaultCalendarId: null,
    });
  const [events, setEvents] = useState([]),
    [tasks, setTasks] = useState([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [view, setView] = useState("dayGridMonth"),
    [title, setTitle] = useState("");
  const [zone, setZone] = useState(browserZone),
    [zoneInput, setZoneInput] = useState(browserZone),
    [weekends, setWeekends] = useState(true),
    [query, setQuery] = useState("");
  const [taskFilter, setTaskFilter] = useState("open"),
    [connection, setConnection] = useState(null),
    [editor, setEditor] = useState(null),
    [mobileNav, setMobileNav] = useState(false);
  const [range, setRange] = useState(() => ({
    start: DateTime.now().startOf("month").minus({ days: 7 }).toISO(),
    end: DateTime.now().endOf("month").plus({ days: 7 }).toISO(),
  }));
  const [importTarget, setImportTarget] = useState("");
  const calendarRef = useRef(null),
    importRef = useRef(null);
  const writable = calendars.filter((c) => !c.readOnly && !c.setupPending);
  const target =
    importTarget || preferences.defaultCalendarId || writable[0]?.id || "";
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [data, entries, todo] = await Promise.all([
        api("/calendar/calendars"),
        api(
          `/calendar/events?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}&timezone=${encodeURIComponent(zone)}`,
        ),
        api("/calendar/tasks"),
      ]);
      setCalendars(data.calendars);
      setPreferences(data.preferences);
      setEvents(entries);
      setTasks(todo);
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  }, [range.start, range.end, username, zone]);
  useEffect(() => {
    reload();
  }, [reload]);
  const datesSet = useCallback((info) => {
    setTitle(info.view.title);
    setRange((old) =>
      old.start === info.startStr && old.end === info.endStr
        ? old
        : { start: info.startStr, end: info.endStr },
    );
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden && !editor && !connection) reload();
    }, 60000);
    return () => clearInterval(timer);
  }, [reload, editor, connection]);
  async function openEvent(id, occurrence) {
    try {
      const master = await api(`/calendar/events/${id}`);
      setEditor({
        ...master,
        ...occurrence,
        id: master.id,
        version: master.version,
        master,
      });
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => {
    if (openEventId) {
      openEvent(openEventId);
      onEventOpened();
    }
  }, [openEventId]);
  function newEvent(kind = "vevent", selection = null) {
    const calendarId =
      writable.find((c) => c.id === preferences.defaultCalendarId)?.id ||
      writable[0]?.id;
    if (!calendarId) {
      setError(t("Ein beschreibbarer Kalender wird benötigt."));
      return;
    }
    setEditor({
      kind,
      calendarId,
      ...(selection
        ? {
            startLocal: formTime(selection.start, zone, selection.allDay),
            endLocal: formTime(selection.end, zone, selection.allDay),
            allDay: selection.allDay,
            timezone: zone,
          }
        : {}),
    });
  }
  function switchView(next) {
    setView(next);
  }
  useEffect(() => {
    if (view !== "tasks") {
      const calendar = calendarRef.current?.getApi();
      calendar?.changeView(view);
      calendar?.updateSize();
    }
  }, [view]);
  useEffect(() => {
    const key = (event) => {
      if (
        !editor &&
        !connection &&
        !document.querySelector('[role="dialog"]') &&
        event.key.toLowerCase() === "n" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)
      ) {
        event.preventDefault();
        newEvent(view === "tasks" ? "vtodo" : "vevent");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  async function toggleCalendar(calendar) {
    try {
      await api(`/calendar/calendars/${calendar.id}`, {
        method: "PATCH",
        body: { visible: !calendar.visible },
      });
      await reload();
    } catch (err) {
      setError(err.message);
    }
  }
  async function syncAll() {
    setBusy(true);
    try {
      for (const calendar of calendars.filter(
        (c) => c.kind !== "local" && !c.setupPending,
      ))
        await api(`/calendar/calendars/${calendar.id}/sync`, {
          method: "POST",
        });
      await reload();
      notify(t("Kalender synchronisiert."));
    } catch (err) {
      setError(err.message);
      await reload();
    } finally {
      setBusy(false);
    }
  }
  async function savePreferences(next) {
    try {
      setPreferences(
        await api("/calendar/preferences", {
          method: "PATCH",
          body: { ...preferences, ...next },
        }),
      );
    } catch (err) {
      setError(err.message);
    }
  }
  async function importFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!target || !writable.some((c) => c.id === Number(target))) {
      setError(t("Bitte einen beschreibbaren Zielkalender auswählen."));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError(t("Die Kalenderdatei ist größer als 5 MB."));
      return;
    }
    setBusy(true);
    try {
      const result = await api(`/calendar/calendars/${target}/import`, {
        method: "POST",
        body: { ics: await file.text() },
      });
      notify(
        choose(
          `${result.imported} Einträge importiert, ${result.skipped} vorhandene übersprungen.`,
          `${result.imported} items imported, ${result.skipped} existing items skipped.`,
        ),
      );
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function changeDates(info) {
    const entry = info.event.extendedProps;
    const effectiveZone =
      entry.timezone === "floating" ? zone : entry.timezone || zone;
    try {
      await api(`/calendar/events/${entry.eventId}`, {
        method: "PATCH",
        body: {
          version: entry.version,
          start: formTime(info.event.start, effectiveZone, info.event.allDay),
          end: formTime(info.event.end, effectiveZone, info.event.allDay),
          allDay: info.event.allDay,
          timezone: entry.timezone || effectiveZone,
          scope: entry.recurrenceId ? "occurrence" : "series",
          recurrenceId: entry.recurrenceId,
        },
      });
      await reload();
    } catch (err) {
      info.revert();
      setError(err.message);
    }
  }
  const matches = (event) =>
    `${event.title} ${event.location} ${event.description} ${event.categories}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
  const displayed = useMemo(
    () =>
      events.filter(matches).map((event) => ({
        ...event,
        backgroundColor: event.color,
        borderColor: event.color,
        textColor: calendarTextColor(event.color),
        editable: !event.readOnly,
        classNames:
          event.selfResponse === "DECLINED"
            ? ["calendar-declined"]
            : event.status === "TENTATIVE"
              ? ["calendar-tentative"]
              : [],
        extendedProps: { ...event },
      })),
    [events, query],
  );
  const visibleTasks = tasks
    .filter(matches)
    .filter(
      (task) =>
        taskFilter === "all" ||
        (taskFilter === "completed"
          ? task.status === "COMPLETED"
          : !["COMPLETED", "CANCELLED"].includes(task.status)),
    );
  const formatDate = (value) =>
    value
      ? DateTime.fromISO(value)
          .setZone(zone)
          .setLocale(dateLocale())
          .toLocaleString(DateTime.DATETIME_MED)
      : t("Ohne Fälligkeit");
  async function completeTask(task) {
    try {
      await api(`/calendar/events/${task.id}`, {
        method: "PATCH",
        body: {
          version: task.version,
          status: task.status === "COMPLETED" ? "NEEDS-ACTION" : "COMPLETED",
          percent: task.status === "COMPLETED" ? 0 : 100,
        },
      });
      await reload();
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <div className="calendar-layout">
      <aside
        className={`calendar-sidebar${mobileNav ? " calendar-sidebar-open" : ""}`}
      >
        <div className="calendar-sidebar-brand">
          <span>
            minimail<span>.</span>
          </span>
          <button
            className="icon-button"
            onClick={() => setMobileNav(false)}
            aria-label={t("Schließen")}
          >
            <X size={18} />
          </button>
        </div>
        <button
          className="primary-button calendar-create"
          onClick={() => newEvent(view === "tasks" ? "vtodo" : "vevent")}
        >
          <Plus size={18} />
          {t(view === "tasks" ? "Neue Aufgabe" : "Neuer Termin")}
        </button>
        <div className="calendar-today">
          <span>
            {DateTime.now().setLocale(dateLocale()).toFormat("cccc, LLLL yyyy")}
          </span>
          <strong>{DateTime.now().day}</strong>
          <button onClick={() => calendarRef.current?.getApi().today()}>
            {t("Heute anzeigen")}
          </button>
        </div>
        <div className="calendar-sidebar-heading">
          <h3>{t("MEINE KALENDER")}</h3>
          <button
            className="icon-button"
            onClick={() => setConnection({})}
            aria-label={t("Kalender hinzufügen")}
          >
            <Plus size={18} />
          </button>
        </div>
        <div className="calendar-list">
          {calendars.map((calendar) => (
            <div key={calendar.id} className="calendar-list-item">
              <label>
                <input
                  type="checkbox"
                  checked={calendar.visible}
                  onChange={() => toggleCalendar(calendar)}
                  style={{ accentColor: calendar.color }}
                />
                <span
                  className="calendar-color-dot"
                  style={{ background: calendar.color }}
                />
                <span>
                  <strong>{calendar.name}</strong>
                  <small>
                    {calendar.kind === "local"
                      ? t("Lokal")
                      : calendar.kind === "caldav"
                        ? "CalDAV"
                        : "iCalendar"}
                    {calendar.readOnly ? ` · ${t("Schreibgeschützt")}` : ""}
                  </small>
                </span>
              </label>
              <button
                className="icon-button"
                onClick={() => setConnection(calendar)}
                aria-label={`${t("Kalender verwalten")}: ${calendar.name}`}
              >
                <MoreHorizontal size={18} />
              </button>
              {calendar.syncError && (
                <p className="calendar-sync-error">{calendar.syncError}</p>
              )}
              {calendar.setupPending && (
                <button
                  className="calendar-setup-pending"
                  onClick={() => setConnection(calendar)}
                >
                  {t("Zugangsdaten ergänzen")}
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="calendar-mail-preferences">
          <h4>{t("Einladungen aus E-Mails")}</h4>
          <label className="calendar-checkbox">
            <input
              type="checkbox"
              checked={preferences.autoImport}
              onChange={(e) =>
                savePreferences({ autoImport: e.target.checked })
              }
            />
            {t("Automatisch vorläufig eintragen")}
          </label>
          <label>
            {t("Zielkalender")}
            <select
              value={preferences.defaultCalendarId || ""}
              onChange={(e) =>
                savePreferences({ defaultCalendarId: Number(e.target.value) })
              }
            >
              <option value="">{t("Bitte auswählen")}</option>
              {calendars
                .filter((c) => c.kind === "local" && !c.readOnly)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          <p>{t("Zu- und Absagen werden nur nach deinem Klick versendet.")}</p>
        </div>
        <div className="calendar-import-export">
          <h4>{t("Import und Export")}</h4>
          <label>
            {t("Zielkalender")}
            <select
              value={target}
              onChange={(e) => setImportTarget(e.target.value)}
            >
              {writable.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div>
            <button
              disabled={busy || !target}
              onClick={() => importRef.current.click()}
            >
              <Upload size={15} />
              {t("ICS importieren")}
            </button>
            {target && (
              <a
                className="calendar-button"
                href={`/api/calendar/calendars/${target}/export`}
                download
              >
                <Download size={15} />
                {t("Exportieren")}
              </a>
            )}
          </div>
          <input
            ref={importRef}
            type="file"
            accept=".ics,text/calendar"
            hidden
            onChange={importFile}
          />
        </div>
        <button className="calendar-back-mail" onClick={onMail}>
          <Mail size={17} />
          {t("Zurück zu E-Mail")}
        </button>
      </aside>
      <main className="calendar-workspace">
        <header className="calendar-topbar">
          <div>
            <button
              className="icon-button calendar-mobile-nav"
              onClick={() => setMobileNav(true)}
              aria-label={t("Kalenderliste öffnen")}
            >
              <List size={20} />
            </button>
            <CalendarDays size={22} />
            <h1>{t("Kalender")}</h1>
          </div>
          <label className="calendar-search">
            <Search size={17} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Termine und Aufgaben durchsuchen …")}
              aria-label={t("Termine und Aufgaben durchsuchen …")}
            />
          </label>
          <div>
            <button
              className="icon-button"
              onClick={syncAll}
              disabled={busy}
              title={t("Kalender synchronisieren")}
              aria-label={t("Kalender synchronisieren")}
            >
              <RefreshCw size={19} className={busy ? "spin" : ""} />
            </button>
            <button
              className="icon-button"
              onClick={() => window.print()}
              title={t("Drucken")}
              aria-label={t("Drucken")}
            >
              <Printer size={19} />
            </button>
            <button
              className="icon-button"
              onClick={onSettings}
              aria-label={t("Einstellungen")}
            >
              <Settings size={19} />
            </button>
            <button
              className="icon-button calendar-mobile-nav"
              onClick={onMail}
              title={t("E-Mail")}
              aria-label={t("E-Mail")}
            >
              <Mail size={19} />
            </button>
          </div>
        </header>
        <div className="calendar-toolbar">
          <div className="calendar-date-controls">
            <button
              className="icon-button"
              disabled={view === "tasks"}
              onClick={() => calendarRef.current?.getApi().prev()}
              aria-label={t("Vorheriger Zeitraum")}
            >
              <ChevronLeft size={19} />
            </button>
            <button
              className="icon-button"
              disabled={view === "tasks"}
              onClick={() => calendarRef.current?.getApi().next()}
              aria-label={t("Nächster Zeitraum")}
            >
              <ChevronRight size={19} />
            </button>
            <button
              disabled={view === "tasks"}
              onClick={() => calendarRef.current?.getApi().today()}
            >
              {t("Heute")}
            </button>
            <h2>{view === "tasks" ? t("Aufgaben") : title}</h2>
            {loading && (
              <LoaderCircle
                size={17}
                className="spin"
                aria-label={t("Wird geladen …")}
              />
            )}
          </div>
          <div className="calendar-view-controls">
            <select
              aria-label={t("Kalenderansicht")}
              value={view}
              onChange={(e) => switchView(e.target.value)}
            >
              {views.map(([v, label]) => (
                <option key={v} value={v}>
                  {t(label)}
                </option>
              ))}
            </select>
            <button
              className="calendar-new-mobile"
              onClick={() => newEvent(view === "tasks" ? "vtodo" : "vevent")}
            >
              <Plus size={16} />
              {t("Neu")}
            </button>
          </div>
        </div>
        <div className="calendar-options">
          <label>
            {t("Datum")}
            <input
              type="date"
              onChange={(e) => {
                if (e.target.value)
                  calendarRef.current?.getApi().gotoDate(e.target.value);
              }}
            />
          </label>
          <label>
            {t("Anzeigezeitzone")}
            <input
              value={zoneInput}
              list="calendar-zones"
              onChange={(e) => {
                setZoneInput(e.target.value);
              }}
              onBlur={() => {
                if (DateTime.now().setZone(zoneInput).isValid)
                  setZone(zoneInput);
                else {
                  setZoneInput(zone);
                  setError(t("Die Anzeigezeitzone ist ungültig."));
                }
              }}
            />
            <datalist id="calendar-zones">
              {["UTC", ...Intl.supportedValuesOf("timeZone")].map((z) => (
                <option key={z}>{z}</option>
              ))}
            </datalist>
          </label>
          <label className="calendar-checkbox">
            <input
              type="checkbox"
              checked={weekends}
              onChange={(e) => setWeekends(e.target.checked)}
            />
            {t("Wochenenden")}
          </label>
          {typeof window !== "undefined" &&
            "Notification" in window &&
            Notification.permission !== "granted" && (
              <button
                onClick={async () => {
                  const result = await Notification.requestPermission();
                  notify(
                    t(
                      result === "granted"
                        ? "Browserbenachrichtigungen aktiviert."
                        : "Erinnerungen bleiben innerhalb von MiniMail sichtbar.",
                    ),
                  );
                }}
              >
                <Bell size={15} />
                {t("Benachrichtigungen erlauben")}
              </button>
            )}
        </div>
        <div className="calendar-body" aria-busy={loading}>
          <div className="calendar-grid" hidden={view === "tasks"}>
            <FullCalendar
              ref={calendarRef}
              plugins={plugins}
              locales={[deLocale]}
              locale={getLanguage()}
              initialView="dayGridMonth"
              views={{
                fourWeeks: {
                  type: "dayGrid",
                  duration: { weeks: 4 },
                  dateAlignment: "week",
                },
              }}
              headerToolbar={false}
              firstDay={1}
              weekNumbers
              weekNumberCalculation="ISO"
              nowIndicator
              weekends={weekends}
              timeZone={zone}
              events={displayed}
              datesSet={datesSet}
              height="100%"
              selectable
              selectMirror
              editable
              eventResizableFromStart
              dayMaxEvents={4}
              eventTimeFormat={{
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              }}
              slotLabelFormat={{
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
              }}
              select={(selection) => {
                newEvent("vevent", selection);
                selection.view.calendar.unselect();
              }}
              eventClick={(info) =>
                openEvent(
                  info.event.extendedProps.eventId,
                  info.event.extendedProps,
                )
              }
              eventDrop={changeDates}
              eventResize={changeDates}
              noEventsText={t("Keine Termine in diesem Zeitraum.")}
            />
          </div>
          {view === "tasks" && (
            <section className="calendar-tasks">
              <div className="calendar-task-toolbar">
                <select
                  value={taskFilter}
                  aria-label={t("Aufgaben filtern")}
                  onChange={(e) => setTaskFilter(e.target.value)}
                >
                  <option value="open">{t("Offene Aufgaben")}</option>
                  <option value="completed">{t("Erledigte Aufgaben")}</option>
                  <option value="all">{t("Alle Aufgaben")}</option>
                </select>
                <span>
                  {visibleTasks.length} {t("Aufgaben")}
                </span>
              </div>
              {visibleTasks.length ? (
                visibleTasks
                  .sort(
                    (a, b) =>
                      (a.end || "z").localeCompare(b.end || "z") ||
                      a.priority - b.priority,
                  )
                  .map((task) => (
                    <article
                      key={task.id}
                      className={
                        task.status === "COMPLETED"
                          ? "calendar-task completed"
                          : "calendar-task"
                      }
                    >
                      <input
                        type="checkbox"
                        checked={task.status === "COMPLETED"}
                        disabled={task.readOnly}
                        onChange={() => completeTask(task)}
                        aria-label={choose(
                          `${task.title} als erledigt markieren`,
                          `Mark ${task.title} complete`,
                        )}
                      />
                      <button onClick={() => openEvent(task.id)}>
                        <strong>{task.title}</strong>
                        <span>
                          {task.calendarName} · {formatDate(task.end)}
                          {task.priority > 0 &&
                            ` · ${t("Priorität")} ${task.priority}`}
                        </span>
                      </button>
                      <span className="calendar-task-progress">
                        {task.percent}%
                      </span>
                      <i style={{ background: task.color }} />
                    </article>
                  ))
              ) : (
                <div className="calendar-empty">
                  <CheckSquare size={40} />
                  <h3>{t("Keine passenden Aufgaben")}</h3>
                  <p>
                    {t("Lege eine neue Aufgabe an oder ändere den Filter.")}
                  </p>
                </div>
              )}
            </section>
          )}
        </div>
        <footer className="calendar-status">
          <span>
            {calendars.filter((c) => c.visible).length}{" "}
            {t("Kalender eingeblendet")} · {zone}
          </span>
          <span>
            {t("Erinnerungen werden angezeigt, solange MiniMail geöffnet ist.")}
          </span>
        </footer>
      </main>
      {connection && (
        <CalendarConnection
          calendar={connection.id ? connection : null}
          onClose={() => setConnection(null)}
          onSaved={reload}
          setError={setError}
        />
      )}
      {editor && (
        <EventEditor
          key={`${editor.id || "new"}:${editor.recurrenceId || ""}`}
          event={editor}
          calendars={calendars}
          accounts={accounts}
          defaultCalendarId={preferences.defaultCalendarId}
          zone={zone}
          onClose={() => setEditor(null)}
          onSaved={reload}
          setError={setError}
          notify={notify}
        />
      )}
    </div>
  );
}
