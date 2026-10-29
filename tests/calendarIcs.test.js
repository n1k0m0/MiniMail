import test from "node:test";
import assert from "node:assert/strict";
import {
  editItem,
  itemDetails,
  expandItem,
  removeOccurrence,
  splitCalendar,
  joinCalendar,
  invitation,
  tentativeInvitation,
} from "../server/calendarIcs.js";
import {
  allowedAddress,
  calendarHref,
  calendarUrl,
  fetchRemoteCalendar,
  discoverCalendars,
} from "../server/calendarRemote.js";
import { runCalendar } from "../server/calendarWorker.js";

test("calendar series keep local time over DST and individual edits/exclusions survive", () => {
  let raw = editItem(null, {
    title: "Weekly",
    start: "2026-10-18T09:00",
    end: "2026-10-18T10:00",
    timezone: "Europe/Berlin",
    recurrence: "FREQ=WEEKLY;COUNT=5",
    reminder: 15,
  });
  let events = expandItem(raw, "2026-10-01T00:00:00Z", "2026-12-01T00:00:00Z");
  assert.equal(events.length, 5);
  assert.equal(events[0].start, "2026-10-18T07:00:00.000Z");
  assert.equal(events[1].start, "2026-10-25T08:00:00.000Z");
  assert.equal(events[0].alarms[0], Date.parse(events[0].start) - 15 * 60000);
  raw = editItem(raw, {
    scope: "occurrence",
    recurrenceId: events[1].recurrenceId,
    title: "Moved",
    start: "2026-10-26T11:00",
    end: "2026-10-26T12:00",
  });
  events = expandItem(raw, "2026-10-01T00:00:00Z", "2026-12-01T00:00:00Z");
  assert.equal(events[1].title, "Moved");
  assert.equal(events[1].start, "2026-10-26T10:00:00.000Z");
  raw = removeOccurrence(raw, events[2].recurrenceId);
  raw = removeOccurrence(raw, events[3].recurrenceId);
  assert.equal(
    expandItem(raw, "2026-10-01T00:00:00Z", "2026-12-01T00:00:00Z").length,
    3,
  );
});

test("all-day events, tasks, attendees and opaque provider properties round-trip", async () => {
  const event = editItem(null, {
    title: "Holiday",
    start: "2026-11-01",
    end: "2026-11-03",
    allDay: true,
    timezone: "UTC",
    description: "Line 1\nLine 2, semicolon;",
    categories: "Work, Travel",
  });
  assert.equal(itemDetails(event).start, "2026-11-01");
  assert.equal(
    expandItem(event, "2026-10-31T00:00:00Z", "2026-11-04T00:00:00Z")[0].end,
    "2026-11-03",
  );
  const task = editItem(
    null,
    {
      title: "Task",
      start: "",
      end: "2026-11-01T15:00",
      timezone: "UTC",
      priority: 1,
      percent: 30,
      status: "IN-PROCESS",
    },
    { kind: "vtodo" },
  );
  assert.equal(itemDetails(task).kind, "vtodo");
  assert.equal(itemDetails(task).percent, 30);
  assert.equal(
    expandItem(task, "2026-10-31T00:00:00Z", "2026-11-04T00:00:00Z").length,
    1,
  );
  const combined = joinCalendar([event, task]);
  assert.equal(splitCalendar(combined).length, 2);
  assert.equal((await runCalendar("splitCalendar", combined)).length, 2);
  assert.throws(
    () =>
      editItem(null, {
        title: "Bad",
        start: "2026-11-02T12:00",
        end: "2026-11-02T11:00",
      }),
    /Ende/,
  );
  assert.throws(
    () =>
      editItem(null, {
        title: "Bad",
        start: "2026-11-02T12:00",
        recurrence: "FREQ=SECONDLY",
      }),
    /häufig/,
  );
});

test("invitation responses only include the selected attendee and keep the original UID", () => {
  const raw = editItem(null, {
    title: "Meeting",
    start: "2026-11-01T10:00",
    end: "2026-11-01T11:00",
    timezone: "UTC",
    organizer: "organizer@example.test",
    attendees: [{ email: "one@example.test" }, { email: "two@example.test" }],
  });
  const reply = invitation(raw, {
    address: "one@example.test",
    status: "ACCEPTED",
  });
  const details = itemDetails(reply);
  assert.equal(details.uid, itemDetails(raw).uid);
  assert.equal(details.method, "REPLY");
  assert.deepEqual(
    details.attendees.map((p) => [p.email, p.status]),
    [["one@example.test", "ACCEPTED"]],
  );
  assert.throws(
    () =>
      invitation(raw, { address: "stranger@example.test", status: "ACCEPTED" }),
    /Teilnehmer/,
  );
  assert.equal(itemDetails(tentativeInvitation(raw)).status, "TENTATIVE");
});

test("calendar networking rejects private addresses and collection escapes", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
  ])
    assert.equal(allowedAddress(ip), false);
  assert.equal(allowedAddress("1.1.1.1"), true);
  assert.equal(
    calendarUrl("webcal://calendar.example.test/events.ics").protocol,
    "https:",
  );
  assert.throws(() => calendarUrl("https://user:password@example.test/"));
  assert.throws(() =>
    calendarHref(
      "https://example.test/cal/",
      "https://other.test/secret.ics",
      true,
    ),
  );
  assert.throws(() =>
    calendarHref("https://example.test/cal/", "/other.ics", true),
  );
  assert.throws(() =>
    calendarHref("https://example.test/cal/", "/cal/a%2f..%2fother.ics", true),
  );
  await assert.rejects(
    fetchRemoteCalendar(
      { url: "https://example.test/cal/" },
      "caldav",
      async () => ({
        status: 207,
        body: '<!DOCTYPE x [<!ENTITY evil "unsafe">]><multistatus/>',
      }),
    ),
    /XML/,
  );
  await assert.rejects(
    fetchRemoteCalendar(
      { url: "https://example.test/cal/" },
      "caldav",
      async () => ({
        status: 207,
        body: '<d:multistatus xmlns:d="DAV:"><d:response><d:propstat><d:prop/><d:status>HTTP/1.1 500 Error</d:status></d:propstat></d:response></d:multistatus>',
      }),
    ),
    /vollständig/,
  );
  const discovered = await discoverCalendars(
    { url: "https://example.test/cal/" },
    async () => ({
      body: '<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/cal/</d:href><d:propstat><d:prop><d:displayname>Personal</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>',
    }),
  );
  assert.equal(discovered[0].name, "Personal");
});
