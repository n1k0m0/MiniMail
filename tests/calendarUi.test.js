import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { eventForm, calendarTextColor } from "../src/calendar/calendarUi.js";

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
    assert.ok(prepared.includes("Dieser Kalender ist vorbereitet."));
    assert.ok(prepared.includes('type="password"'));
  } finally {
    await vite.close();
  }
});
