import ICAL from "ical.js";
import timezones from "@touch4it/ical-timezones";
import { DateTime } from "luxon";
import crypto from "node:crypto";

export class CalendarError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export const uidHash = (uid) =>
  crypto.createHash("sha256").update(uid).digest("hex");
const kinds = ["vevent", "vtodo"];
const value = (component, key, fallback = "") =>
  component.getFirstPropertyValue(key) ?? fallback;
const email = (input) =>
  String(input || "")
    .replace(/^mailto:/i, "")
    .toLowerCase();
export function validEmail(input) {
  return (
    typeof input === "string" &&
    /^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/.test(input) &&
    input.length <= 254
  );
}
export function parseCalendar(raw) {
  if (
    typeof raw !== "string" ||
    Buffer.byteLength(raw) > 5 * 1024 * 1024 ||
    !raw.trim()
  )
    throw new CalendarError(
      "Die Kalenderdatei fehlt oder ist größer als 5 MB.",
    );
  let root;
  try {
    root = new ICAL.Component(ICAL.parse(raw.replace(/^\uFEFF/, "")));
  } catch {
    throw new CalendarError(
      "Die Datei enthält keinen gültigen iCalendar-Kalender.",
    );
  }
  if (root.name !== "vcalendar")
    throw new CalendarError("Eine VCALENDAR-Datei wird benötigt.");
  if (root.getAllSubcomponents().length > 5000)
    throw new CalendarError("Der Kalender enthält zu viele Einträge.");
  // Resolve zones on this calendar, never in the process-wide registry. An
  // untrusted attachment must not redefine a timezone for another user.
  const known = new Set(
    root.getAllSubcomponents("vtimezone").map((c) => value(c, "tzid")),
  );
  for (const component of root
    .getAllSubcomponents()
    .filter((c) => kinds.includes(c.name))) {
    for (const prop of component.getAllProperties()) {
      const zone = prop.getParameter("tzid");
      if (!zone || known.has(zone) || zone === "UTC") continue;
      const definition = timezones.getVtimezoneComponent(zone);
      if (!definition)
        throw new CalendarError(
          "Eine Zeitzone dieses Kalenders wird nicht unterstützt.",
        );
      root.addSubcomponent(new ICAL.Component(ICAL.parse(definition)));
      known.add(zone);
    }
  }
  return root;
}
function newRoot() {
  const root = new ICAL.Component(["vcalendar", [], []]);
  root.updatePropertyWithValue("version", "2.0");
  root.updatePropertyWithValue("prodid", "-//MiniMail//Calendar//EN");
  return root;
}
function copy(component) {
  return new ICAL.Component(JSON.parse(JSON.stringify(component.toJSON())));
}
function main(root) {
  return (
    root
      .getAllSubcomponents()
      .find((c) => kinds.includes(c.name) && !c.hasProperty("recurrence-id")) ||
    root.getAllSubcomponents().find((c) => kinds.includes(c.name))
  );
}
export function splitCalendar(raw) {
  const root = parseCalendar(raw);
  const groups = new Map();
  for (const component of root
    .getAllSubcomponents()
    .filter((c) => kinds.includes(c.name))) {
    const uid = String(value(component, "uid"));
    if (!uid || uid.length > 1024)
      throw new CalendarError("Ein Termin hat keine gültige UID.");
    if (!groups.has(uid)) groups.set(uid, newRoot());
    groups.get(uid).addSubcomponent(copy(component));
  }
  if (groups.size > 2000)
    throw new CalendarError("Pro Import sind höchstens 2000 Einträge möglich.");
  return [...groups].map(([uid, entry]) => {
    for (const zone of root.getAllSubcomponents("vtimezone"))
      entry.addSubcomponent(copy(zone));
    const method = value(root, "method");
    if (method) entry.updatePropertyWithValue("method", method);
    const ics = entry.toString();
    if (Buffer.byteLength(ics) > 256 * 1024)
      throw new CalendarError(
        "Ein einzelner Kalendereintrag ist größer als 256 KB.",
      );
    return {
      uid,
      ics,
      kind: main(entry).name,
      method: String(method).toUpperCase(),
    };
  });
}
function dateString(time) {
  if (!time) return "";
  return time.isDate
    ? time.toString()
    : time.zone === ICAL.Timezone.localTimezone
      ? time.toString()
      : time.toJSDate().toISOString();
}
function localString(time) {
  return time
    ? time
        .toString()
        .replace(/Z$/, "")
        .slice(0, time.isDate ? 10 : 16)
    : "";
}
export function itemDetails(raw) {
  const root = parseCalendar(raw),
    component = main(root);
  if (!component)
    throw new CalendarError("Kein Termin oder keine Aufgabe gefunden.");
  const start = value(component, "dtstart", null),
    end = value(component, component.name === "vtodo" ? "due" : "dtend", null);
  const attendees = component.getAllProperties("attendee").map((prop) => ({
    email: email(prop.getFirstValue()),
    name: prop.getParameter("cn") || "",
    status: prop.getParameter("partstat") || "NEEDS-ACTION",
    role: prop.getParameter("role") || "REQ-PARTICIPANT",
  }));
  const alarm = component
    .getAllSubcomponents("valarm")
    .find((c) => value(c, "action") === "DISPLAY");
  const trigger = alarm?.getFirstPropertyValue("trigger");
  return {
    uid: String(value(component, "uid")),
    kind: component.name,
    title: String(value(component, "summary")),
    description: String(value(component, "description")),
    location: String(value(component, "location")),
    url: String(value(component, "url")),
    start: dateString(start),
    end: dateString(end),
    startLocal: localString(start),
    endLocal: localString(end),
    allDay: !!start?.isDate,
    timezone: start?.zone?.tzid || "floating",
    recurrence: String(value(component, "rrule")),
    recurring: component.hasProperty("rrule") || component.hasProperty("rdate"),
    status: String(
      value(
        component,
        "status",
        component.name === "vtodo" ? "NEEDS-ACTION" : "CONFIRMED",
      ),
    ),
    privacy: String(value(component, "class", "PUBLIC")),
    availability: String(value(component, "transp", "OPAQUE")),
    priority: Number(value(component, "priority", 0)),
    percent: Number(value(component, "percent-complete", 0)),
    categories: component
      .getAllProperties("categories")
      .flatMap((p) => p.getValues())
      .join(", "),
    organizer: email(value(component, "organizer")),
    attendees,
    sequence: Number(value(component, "sequence", 0)),
    stamp: dateString(value(component, "dtstamp", null)),
    method: String(value(root, "method")),
    reminder:
      trigger instanceof ICAL.Duration
        ? Math.max(0, -trigger.toSeconds() / 60)
        : null,
  };
}
function checkedText(input, max = 2000) {
  if (typeof input !== "string" || input.length > max || input.includes("\0"))
    throw new CalendarError("Ein Kalenderfeld ist ungültig oder zu lang.");
  return input;
}
function timeFromInput(input, zone, allDay) {
  if (!input) return null;
  checkedText(input, 50);
  const dt = DateTime.fromISO(input, {
    zone: zone === "floating" ? "local" : zone,
  });
  if (!dt.isValid) throw new CalendarError("Datum oder Zeitzone ist ungültig.");
  const time = ICAL.Time.fromString(
    dt.toFormat(allDay ? "yyyy-MM-dd" : "yyyy-MM-dd'T'HH:mm:ss"),
  );
  time.isDate = allDay;
  return time;
}
function setTime(component, key, time, zone) {
  component.removeAllProperties(key);
  if (!time) return;
  const prop = new ICAL.Property(key);
  prop.setValue(time);
  if (!time.isDate && zone !== "floating") prop.setParameter("tzid", zone);
  component.addProperty(prop);
}
function recurrenceTime(component, id) {
  const start = value(component, "dtstart");
  const result = ICAL.Time.fromString(id);
  result.zone = start.zone;
  result.isDate = start.isDate;
  return result;
}
export function editItem(
  raw,
  input,
  { uid = crypto.randomUUID(), kind = "vevent" } = {},
) {
  const root = raw ? parseCalendar(raw) : newRoot();
  let component = main(root);
  if (!component) {
    if (!kinds.includes(kind))
      throw new CalendarError("Unbekannter Eintragstyp.");
    component = new ICAL.Component([kind, [], []]);
    root.addSubcomponent(component);
    component.updatePropertyWithValue("uid", uid);
  }
  if (input.scope === "occurrence" && input.recurrenceId) {
    const original = component;
    component = root
      .getAllSubcomponents(original.name)
      .find((c) => String(value(c, "recurrence-id")) === input.recurrenceId);
    if (!component) {
      component = copy(original);
      for (const prop of ["rrule", "rdate", "exdate", "recurrence-id"])
        component.removeAllProperties(prop);
      setTime(
        component,
        "recurrence-id",
        recurrenceTime(original, input.recurrenceId),
        value(original, "dtstart").zone.tzid,
      );
      root.addSubcomponent(component);
    }
  }
  const old = itemDetails(root.toString());
  for (const [key, name, max] of [
    ["title", "summary", 500],
    ["description", "description", 30000],
    ["location", "location", 2000],
    ["url", "url", 2000],
  ]) {
    if (input[key] !== undefined)
      component.updatePropertyWithValue(name, checkedText(input[key], max));
  }
  if (!String(value(component, "summary")).trim())
    throw new CalendarError("Ein Titel wird benötigt.");
  const allDay = input.allDay ?? old.allDay,
    zone = input.timezone || old.timezone || "UTC";
  if (
    zone !== "floating" &&
    zone !== "UTC" &&
    !timezones.getVtimezoneComponent(zone)
  )
    throw new CalendarError("Die Zeitzone wird nicht unterstützt.");
  if (
    input.start !== undefined ||
    input.end !== undefined ||
    input.allDay !== undefined ||
    input.timezone !== undefined ||
    !raw
  ) {
    const start = timeFromInput(input.start ?? old.startLocal, zone, allDay);
    let end = timeFromInput(input.end ?? old.endLocal, zone, allDay);
    if (component.name === "vevent" && !start)
      throw new CalendarError("Ein Startdatum wird benötigt.");
    if (start && end && end.compare(start) <= 0)
      throw new CalendarError("Das Ende muss nach dem Beginn liegen.");
    if (component.name === "vevent" && !end) {
      end = start.clone();
      end.adjust(allDay ? 1 : 0, allDay ? 0 : 1, 0, 0);
    }
    component.removeAllProperties("duration");
    setTime(component, "dtstart", start, zone);
    setTime(component, component.name === "vtodo" ? "due" : "dtend", end, zone);
    if (
      zone !== "floating" &&
      zone !== "UTC" &&
      !root
        .getAllSubcomponents("vtimezone")
        .some((c) => value(c, "tzid") === zone)
    )
      root.addSubcomponent(
        new ICAL.Component(ICAL.parse(timezones.getVtimezoneComponent(zone))),
      );
  }
  if (input.recurrence !== undefined && input.scope !== "occurrence") {
    component.removeAllProperties("rrule");
    if (input.recurrence) {
      checkedText(input.recurrence, 1000);
      let rule;
      try {
        rule = ICAL.Recur.fromString(input.recurrence);
      } catch {
        throw new CalendarError("Die Wiederholungsregel ist ungültig.");
      }
      if (
        !rule.freq ||
        rule.interval < 1 ||
        (rule.count && rule.count > 10000) ||
        ["SECONDLY", "MINUTELY"].includes(rule.freq)
      )
        throw new CalendarError(
          "Die Wiederholungsregel ist zu häufig oder ungültig.",
        );
      component.updatePropertyWithValue("rrule", rule);
    }
  }
  for (const [key, prop, allowed] of [
    [
      "status",
      "status",
      component.name === "vtodo"
        ? ["NEEDS-ACTION", "IN-PROCESS", "COMPLETED", "CANCELLED"]
        : ["TENTATIVE", "CONFIRMED", "CANCELLED"],
    ],
    ["privacy", "class", ["PUBLIC", "PRIVATE", "CONFIDENTIAL"]],
    ["availability", "transp", ["OPAQUE", "TRANSPARENT"]],
  ]) {
    if (input[key] !== undefined) {
      if (!allowed.includes(input[key]))
        throw new CalendarError("Ungültiger Terminstatus.");
      component.updatePropertyWithValue(prop, input[key]);
    }
  }
  for (const [key, prop, max] of [
    ["priority", "priority", 9],
    ["percent", "percent-complete", 100],
  ]) {
    if (input[key] !== undefined) {
      if (!Number.isInteger(input[key]) || input[key] < 0 || input[key] > max)
        throw new CalendarError("Ungültiger Fortschritt oder Priorität.");
      component.updatePropertyWithValue(prop, input[key]);
    }
  }
  if (component.name === "vtodo") {
    if (input.status === "COMPLETED") {
      component.updatePropertyWithValue("percent-complete", 100);
      component.updatePropertyWithValue("completed", ICAL.Time.now());
    } else if (input.status) component.removeAllProperties("completed");
  }
  if (input.categories !== undefined) {
    component.removeAllProperties("categories");
    const parts = checkedText(input.categories, 2000)
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (parts.length) {
      const prop = new ICAL.Property("categories");
      prop.setValues(parts);
      component.addProperty(prop);
    }
  }
  if (input.attendees !== undefined) {
    if (
      !Array.isArray(input.attendees) ||
      input.attendees.length > 100 ||
      input.attendees.some((p) => !validEmail(p.email))
    )
      throw new CalendarError("Die Teilnehmerliste ist ungültig.");
    component.removeAllProperties("attendee");
    for (const entry of input.attendees) {
      const prop = new ICAL.Property("attendee");
      prop.setValue(`mailto:${entry.email.toLowerCase()}`);
      prop.setParameter("cn", checkedText(entry.name || "", 200));
      prop.setParameter(
        "partstat",
        ["ACCEPTED", "DECLINED", "TENTATIVE", "NEEDS-ACTION"].includes(
          entry.status,
        )
          ? entry.status
          : "NEEDS-ACTION",
      );
      prop.setParameter("role", "REQ-PARTICIPANT");
      prop.setParameter("rsvp", "TRUE");
      component.addProperty(prop);
    }
  }
  if (input.organizer !== undefined) {
    if (!validEmail(input.organizer))
      throw new CalendarError("Die Organisatoradresse ist ungültig.");
    component.updatePropertyWithValue(
      "organizer",
      `mailto:${input.organizer.toLowerCase()}`,
    );
  }
  if (input.reminder !== undefined) {
    if (
      input.reminder !== null &&
      (!Number.isInteger(input.reminder) ||
        input.reminder < 0 ||
        input.reminder > 40320)
    )
      throw new CalendarError("Die Erinnerungszeit ist ungültig.");
    component.removeAllSubcomponents("valarm");
    if (input.reminder !== null) {
      const alarm = new ICAL.Component(["valarm", [], []]);
      alarm.updatePropertyWithValue("action", "DISPLAY");
      alarm.updatePropertyWithValue(
        "description",
        String(value(component, "summary")),
      );
      alarm.updatePropertyWithValue(
        "trigger",
        ICAL.Duration.fromSeconds(-input.reminder * 60),
      );
      component.addSubcomponent(alarm);
    }
  }
  component.updatePropertyWithValue("dtstamp", ICAL.Time.now());
  component.updatePropertyWithValue("last-modified", ICAL.Time.now());
  component.updatePropertyWithValue("sequence", old.sequence + 1);
  root.removeAllProperties("method");
  return root.toString();
}
export function removeOccurrence(raw, recurrenceId) {
  const root = parseCalendar(raw),
    component = main(root);
  if (!component || !recurrenceId)
    throw new CalendarError("Die Wiederholung fehlt.");
  for (const item of root.getAllSubcomponents(component.name))
    if (String(value(item, "recurrence-id")) === recurrenceId)
      root.removeSubcomponent(item);
  const prop = new ICAL.Property("exdate");
  const time = recurrenceTime(component, recurrenceId);
  prop.setValue(time);
  if (!time.isDate && time.zone.tzid !== "floating")
    prop.setParameter("tzid", time.zone.tzid);
  component.addProperty(prop);
  component.updatePropertyWithValue(
    "sequence",
    Number(value(component, "sequence", 0)) + 1,
  );
  return root.toString();
}
export function expandItem(raw, from, to) {
  const root = parseCalendar(raw),
    component = main(root);
  if (!component) return [];
  const details = itemDetails(raw);
  if (details.kind === "vtodo") {
    // Tasks without dates remain in the task list; dated tasks also appear in
    // the agenda. Keep the actual VTODO unchanged in storage and exports.
    if (!details.start && !details.end) return [];
  }
  const working = copy(root);
  for (const todo of working.getAllSubcomponents("vtodo")) {
    todo.jCal[0] = "vevent";
    const due = todo.getFirstProperty("due");
    if (!todo.hasProperty("dtstart") && due)
      todo.updatePropertyWithValue("dtstart", due.getFirstValue().clone());
    if (due && value(todo, "dtstart").compare(due.getFirstValue()) < 0)
      todo.updatePropertyWithValue("dtend", due.getFirstValue().clone());
    todo.removeAllProperties("due");
  }
  const eventComponent = main(working),
    event = new ICAL.Event(eventComponent);
  if (!event.startDate) return [];
  const startMs = Date.parse(from),
    endMs = Date.parse(to);
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs <= startMs ||
    endMs - startMs > 370 * 86400000
  )
    throw new CalendarError(
      "Der Kalenderzeitraum ist ungültig oder größer als ein Jahr.",
    );
  const recurring = event.isRecurring(),
    iterator = recurring ? event.iterator() : null;
  const result = [];
  for (let count = 0; count < 30000; count++) {
    const occurrence = recurring ? iterator.next() : event.startDate;
    if (!occurrence) break;
    const current = event.getOccurrenceDetails(occurrence),
      item = current.item.component;
    const start = current.startDate,
      end = current.endDate;
    if (
      start.toJSDate().getTime() >= endMs &&
      occurrence.toJSDate().getTime() >= endMs
    )
      break;
    if (
      end.toJSDate().getTime() >= startMs &&
      start.toJSDate().getTime() < endMs &&
      value(item, "status") !== "CANCELLED"
    ) {
      const alarms = [];
      for (const alarm of item.getAllSubcomponents("valarm")) {
        if (value(alarm, "action") !== "DISPLAY") continue;
        const trigger = alarm.getFirstProperty("trigger"),
          delay = trigger?.getFirstValue();
        if (!delay) continue;
        alarms.push(
          delay instanceof ICAL.Duration
            ? (trigger.getParameter("related") === "END" ? end : start)
                .toJSDate()
                .getTime() +
                delay.toSeconds() * 1000
            : delay.toJSDate().getTime(),
        );
      }
      result.push({
        ...details,
        title: String(value(item, "summary")),
        location: String(value(item, "location")),
        status: String(value(item, "status", details.status)),
        start: dateString(start),
        end: dateString(end),
        startLocal: localString(start),
        endLocal: localString(end),
        recurrenceId: recurring ? occurrence.toString() : "",
        alarms,
      });
      if (result.length > 4000)
        throw new CalendarError(
          "Zu viele Wiederholungen. Bitte einen kleineren Zeitraum wählen.",
        );
    }
    if (!recurring) break;
    if (count === 29999)
      throw new CalendarError(
        "Dieser Serienkalender ist zu umfangreich. Bitte die Wiederholungen begrenzen.",
      );
  }
  return result;
}
export function joinCalendar(entries) {
  const root = newRoot(),
    zones = new Set();
  for (const raw of entries) {
    const parsed = parseCalendar(raw);
    for (const part of parsed.getAllSubcomponents()) {
      if (part.name === "vtimezone") {
        const id = value(part, "tzid");
        if (zones.has(id)) continue;
        zones.add(id);
      }
      root.addSubcomponent(copy(part));
    }
  }
  return root.toString();
}
export function invitation(raw, { status, address, method = "REPLY" }) {
  const root = parseCalendar(raw),
    component = main(root);
  if (!component || !["REPLY", "REQUEST", "CANCEL"].includes(method))
    throw new CalendarError("Ungültige Kalendereinladung.");
  root.updatePropertyWithValue("method", method);
  if (method === "REPLY") {
    if (!["ACCEPTED", "TENTATIVE", "DECLINED"].includes(status))
      throw new CalendarError("Ungültige Antwort auf die Einladung.");
    const attendee = component
      .getAllProperties("attendee")
      .find((p) => email(p.getFirstValue()) === address.toLowerCase());
    if (!attendee)
      throw new CalendarError(
        "Dieses Postfach ist kein Teilnehmer der Einladung.",
      );
    attendee.setParameter("partstat", status);
    attendee.setParameter("rsvp", "FALSE");
    component.removeAllProperties("attendee");
    component.addProperty(attendee);
  } else if (method === "CANCEL")
    component.updatePropertyWithValue("status", "CANCELLED");
  component.updatePropertyWithValue("dtstamp", ICAL.Time.now());
  return root.toString();
}
export function applyReply(raw, { address, status }) {
  const root = parseCalendar(raw),
    component = main(root);
  for (const attendee of component.getAllProperties("attendee"))
    if (email(attendee.getFirstValue()) === address.toLowerCase())
      attendee.setParameter("partstat", status);
  return root.toString();
}
export function tentativeInvitation(raw) {
  const root = parseCalendar(raw);
  for (const component of root.getAllSubcomponents("vevent"))
    if (value(root, "method") !== "CANCEL")
      component.updatePropertyWithValue("status", "TENTATIVE");
  return root.toString();
}
export function mergeInvitation(previous, incoming) {
  const root = parseCalendar(previous),
    update = parseCalendar(incoming);
  const part = main(update),
    recurrenceId = part?.getFirstPropertyValue("recurrence-id");
  if (!recurrenceId) return incoming;
  const old = root
    .getAllSubcomponents("vevent")
    .find((c) => String(value(c, "recurrence-id")) === recurrenceId.toString());
  if (old) root.removeSubcomponent(old);
  root.addSubcomponent(copy(part));
  for (const zone of update.getAllSubcomponents("vtimezone"))
    if (
      !root
        .getAllSubcomponents("vtimezone")
        .some((z) => value(z, "tzid") === value(zone, "tzid"))
    )
      root.addSubcomponent(copy(zone));
  return root.toString();
}
export function clientScheduling(raw) {
  const root = parseCalendar(raw);
  for (const component of root
    .getAllSubcomponents()
    .filter((c) => kinds.includes(c.name))) {
    for (const name of ["organizer", "attendee"])
      for (const prop of component.getAllProperties(name))
        prop.setParameter("schedule-agent", "CLIENT");
  }
  return root.toString();
}
export function expandItems(rows, from, to) {
  const result = [];
  for (const { ics, id, ...metadata } of rows) {
    for (const item of expandItem(ics, from, to))
      result.push({
        ...item,
        ...metadata,
        eventId: id,
        id: `${id}:${item.recurrenceId || "single"}`,
      });
    if (result.length > 10000)
      throw new CalendarError(
        "Zu viele Termine. Bitte weniger Kalender oder einen kleineren Zeitraum auswählen.",
      );
  }
  return result;
}
export function taskItems(rows) {
  return rows.flatMap(({ ics, ...metadata }) => {
    const item = itemDetails(ics);
    return item.kind === "vtodo" ? [{ ...item, ...metadata }] : [];
  });
}
export function splitResources(resources, kind) {
  return resources.flatMap((resource) => {
    const groups = splitCalendar(resource.ics);
    if (kind === "caldav" && groups.length !== 1)
      throw new CalendarError(
        "Ein CalDAV-Termin enthält mehrere UIDs. Die vorhandenen Daten bleiben erhalten.",
        502,
      );
    return groups.map((entry) => ({
      ...entry,
      href: resource.href,
      etag: resource.etag,
    }));
  });
}
