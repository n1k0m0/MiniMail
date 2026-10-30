import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import {
  eventForm,
  calendarTextColor,
  calendarEventInput,
  preferredCalendarId,
} from "../src/calendar/calendarUi.js";
import { loadCalendarData } from "../src/calendar/calendarLoad.js";
test("new events prefer a writable primary calendar while existing events keep their calendar", () => {
  const calendars = [
    { id: 1 },
    { id: 2 },
    { id: 3, readOnly: true },
    { id: 4, setupPending: true },
  ];
  assert.equal(
    preferredCalendarId(calendars, {
      primaryCalendarId: 2,
      defaultCalendarId: 1,
    }),
    2,
  );
  for (const id of [3, 4, 99])
    assert.equal(
      preferredCalendarId(calendars, {
        primaryCalendarId: id,
        defaultCalendarId: 1,
      }),
      1,
    );
  assert.equal(preferredCalendarId([]), null);
  assert.equal(eventForm({ calendarId: 1 }, 2).calendarId, 1);
  assert.equal(
    eventForm({}, preferredCalendarId(calendars, { primaryCalendarId: 2 }))
      .calendarId,
    2,
  );
});

test("imported event URLs remain editor data and cannot become navigation links", () => {
  for (const url of [
    "https://outside.example.test/phishing",
    "javascript:alert(1)",
    "data:text/html,test",
  ]) {
    const event = {
      id: "1-20261101",
      eventId: 1,
      title: "External",
      start: "2026-11-01",
      allDay: true,
      color: "#123456",
      url,
      readOnly: true,
    };
    const input = calendarEventInput(event);
    assert.equal(input.url, undefined);
    assert.equal(input.extendedProps.url, url);
    assert.equal(input.extendedProps.eventId, 1);
    assert.equal(input.editable, false);
  }
});

test("a failed event request does not hide updated connection status or tasks", async () => {
  const calendars = {
    calendars: [{ id: 1, setupPending: false }],
    preferences: { defaultCalendarId: 1 },
  };
  const tasks = [{ id: 2, title: "Synthetic task" }];
  const data = await loadCalendarData(
    async (path) => {
      if (path === "/calendar/calendars") return calendars;
      if (path === "/calendar/tasks") return tasks;
      throw new Error("Synthetic event timeout");
    },
    { start: "2026-10-01", end: "2026-11-01", zone: "Europe/Berlin" },
  );
  assert.deepEqual(data.calendars, calendars);
  assert.deepEqual(data.tasks, tasks);
  assert.equal(data.events, undefined);
  assert.deepEqual(data.errors, [
    { section: "events", message: "Synthetic event timeout" },
  ]);
});

test("calendar loading treats empty successful lists as current data", async () => {
  const data = await loadCalendarData(
    async (path) =>
      path === "/calendar/calendars" ? { calendars: [], preferences: {} } : [],
    { start: "2026-10-01", end: "2026-11-01", zone: "UTC" },
  );
  assert.deepEqual(data.events, []);
  assert.deepEqual(data.tasks, []);
  assert.deepEqual(data.errors, []);
});

test("calendar forms preserve floating times, all-day dates and readable calendar colors", () => {
  const form = eventForm(
    { timezone: "floating", startLocal: "2026-11-01T10:00", allDay: false },
    1,
    "Europe/Berlin",
  );
  assert.equal(form.timezone, "floating");
  assert.equal(form.start, "2026-11-01T10:00");
  assert.equal(calendarTextColor("#ffffff"), "#142039");
  assert.equal(calendarTextColor("#000000"), "#ffffff");
});

test("calendar views and editors render with writable/read-only controls and task fields", async () => {
  const vite = await createServer({
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: "custom",
  });
  try {
    const { default: View } = await vite.ssrLoadModule(
      "/src/calendar/CalendarView.jsx",
    );
    const html = renderToStaticMarkup(
      React.createElement(View, { username: "review", accounts: [] }),
    );
    assert.ok(html.includes('class="calendar-layout"'));
    assert.ok(html.includes("MEINE KALENDER"));
    const { default: Editor } = await vite.ssrLoadModule(
      "/src/calendar/EventEditor.jsx",
    );
    const props = {
      accounts: [],
      calendars: [{ id: 1, name: "Own", readOnly: false }],
      defaultCalendarId: 1,
      zone: "UTC",
    };
    const task = renderToStaticMarkup(
      React.createElement(Editor, { ...props, event: { kind: "vtodo" } }),
    );
    assert.ok(task.includes("Fortschritt (%)"));
    assert.ok(task.includes('role="dialog"'));
    const readOnly = renderToStaticMarkup(
      React.createElement(Editor, {
        ...props,
        calendars: [{ id: 1, name: "Feed", readOnly: true }],
        event: {
          id: 1,
          calendarId: 1,
          title: "External",
          startLocal: "2026-11-01T09:00",
          endLocal: "2026-11-01T10:00",
        },
      }),
    );
    assert.ok(readOnly.includes('fieldset disabled=""'));
    assert.ok(readOnly.includes("Kopieren"));
    const { default: Connection } = await vite.ssrLoadModule(
      "/src/calendar/CalendarConnection.jsx",
    );
    const prepared = renderToStaticMarkup(
      React.createElement(Connection, {
        calendar: {
          id: 1,
          kind: "caldav",
          name: "Prepared",
          url: "https://calendar.example.test/",
          username: "owner",
          setupPending: true,
          hasPassword: false,
        },
      }),
    );
    assert.ok(prepared.includes("Verbindung später einrichten"));
    assert.ok(prepared.includes('type="password"'));
  } finally {
    await vite.close();
  }
});
