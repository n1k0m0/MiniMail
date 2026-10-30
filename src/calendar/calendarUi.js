import { DateTime } from "luxon";
export const browserZone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
export function preferredCalendarId(calendars, preferences = {}) {
  const writable = calendars.filter((c) => !c.readOnly && !c.setupPending);
  return (
    writable.find((c) => c.id === Number(preferences.primaryCalendarId))?.id ||
    writable.find((c) => c.id === Number(preferences.defaultCalendarId))?.id ||
    writable[0]?.id ||
    null
  );
}
export function formTime(value, zone, allDay = false) {
  if (!value) return "";
  const date =
    typeof value === "string"
      ? DateTime.fromISO(value, { zone })
      : DateTime.fromJSDate(value, { zone });
  return date.toFormat(allDay ? "yyyy-MM-dd" : "yyyy-MM-dd'T'HH:mm");
}
export function eventForm(event, calendarId, zone = browserZone()) {
  const now = DateTime.now().setZone(zone).startOf("hour").plus({ hours: 1 });
  return {
    calendarId: event?.calendarId || calendarId || "",
    title: event?.title || "",
    kind: event?.kind || "vevent",
    description: event?.description || "",
    location: event?.location || "",
    url: event?.url || "",
    timezone: event?.timezone || zone,
    start: event?.startLocal ?? now.toFormat("yyyy-MM-dd'T'HH:mm"),
    end:
      event?.endLocal ?? now.plus({ hours: 1 }).toFormat("yyyy-MM-dd'T'HH:mm"),
    allDay: !!event?.allDay,
    recurrence: event?.recurrence || "",
    reminder: event?.reminder ?? null,
    status:
      event?.status || (event?.kind === "vtodo" ? "NEEDS-ACTION" : "CONFIRMED"),
    privacy: event?.privacy || "PUBLIC",
    availability: event?.availability || "OPAQUE",
    categories: event?.categories || "",
    priority: event?.priority || 0,
    percent: event?.percent || 0,
    attendees: event?.attendees || [],
    organizer: event?.organizer || "",
    scope: event?.recurrenceId ? "occurrence" : "series",
    recurrenceId: event?.recurrenceId || "",
  };
}
export function calendarTextColor(color) {
  const rgb = [1, 3, 5]
    .map((at) => parseInt(color.slice(at, at + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179
    ? "#142039"
    : "#ffffff";
}
export function calendarEventInput(event) {
  return {
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
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
    // Keep imported URLs as editor data, never as FullCalendar navigation URLs.
    extendedProps: { ...event },
  };
}
export const timezones = () => [
  "UTC",
  "floating",
  ...Intl.supportedValuesOf("timeZone"),
];
