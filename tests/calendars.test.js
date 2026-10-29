import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { testDatabase, insertTestUser } from "./mysqlTestHelper.js";
import {
  listCalendars,
  createCalendar,
  updateCalendar,
  deleteCalendar,
  saveCalendarEvent,
  getCalendarEvent,
  removeCalendarEvent,
  calendarEvents,
  importCalendar,
  exportCalendar,
  setCalendarPreferences,
  importMailInvitations,
  syncCalendar,
  calendarAlerts,
  moveCalendarEvent,
  registerCalendarRoutes,
} from "../server/calendars.js";
import {
  editItem,
  invitation,
  itemDetails,
  CalendarError,
  uidHash,
} from "../server/calendarIcs.js";
import { decrypt } from "../server/security.js";

const event = {
  title: "Private meeting",
  start: "2026-11-01T09:00",
  end: "2026-11-01T10:00",
  timezone: "Europe/Berlin",
  reminder: 15,
};
test("calendars isolate users, encrypt data, detect stale edits, and import/export without duplicates", async (t) => {
  const db = await testDatabase(t);
  await insertTestUser(db, 1);
  await insertTestUser(db, 2);
  const [one, again] = await Promise.all([
    listCalendars(db, 1),
    listCalendars(db, 1),
  ]);
  assert.equal(one.calendars.length, 1);
  assert.equal(again.calendars[0].id, one.calendars[0].id);
  const calendar = one.calendars[0];
  const own = await saveCalendarEvent(db, 1, calendar.id, event);
  const stored = await db
    .prepare("SELECT * FROM calendar_items WHERE id=?")
    .get(own.id);
  assert.ok(!stored.ical_enc.includes(event.title));
  assert.ok(decrypt(stored.ical_enc).includes(event.title));
  await assert.rejects(getCalendarEvent(db, 2, own.id), { status: 404 });
  await assert.rejects(saveCalendarEvent(db, 2, calendar.id, event), {
    status: 404,
  });
  await assert.rejects(updateCalendar(db, 2, calendar.id, { name: "stolen" }), {
    status: 404,
  });
  await assert.rejects(deleteCalendar(db, 2, calendar.id), { status: 404 });
  const changed = await saveCalendarEvent(
    db,
    1,
    calendar.id,
    { title: "Changed", version: own.version },
    own.id,
  );
  assert.equal(changed.version, 2);
  await assert.rejects(
    saveCalendarEvent(
      db,
      1,
      calendar.id,
      { title: "Stale", version: own.version },
      own.id,
    ),
    { status: 409 },
  );
  const exported = await exportCalendar(db, 1, calendar.id);
  assert.deepEqual(await importCalendar(db, 1, calendar.id, exported), {
    imported: 0,
    skipped: 1,
  });
  const copy = await createCalendar(db, 1, {
    name: "Copy",
    color: "#123abc",
    kind: "local",
  });
  assert.deepEqual(await importCalendar(db, 1, copy.id, exported), {
    imported: 1,
    skipped: 0,
  });
  await updateCalendar(db, 1, copy.id, { visible: false });
  assert.equal(
    (
      await calendarEvents(
        db,
        1,
        "2026-11-01T00:00:00Z",
        "2026-11-02T00:00:00Z",
      )
    ).length,
    1,
  );
  await removeCalendarEvent(db, 1, changed.id, { version: changed.version });
  await assert.rejects(getCalendarEvent(db, 1, changed.id), { status: 404 });
  assert.equal(
    (
      await calendarEvents(
        db,
        2,
        "2026-11-01T00:00:00Z",
        "2026-11-02T00:00:00Z",
      )
    ).length,
    0,
  );
});

test("CalDAV sync keeps the cache on errors, uses conditional writes, and respects read-only calendars", async (t) => {
  const db = await testDatabase(t);
  await insertTestUser(db);
  const raw = editItem(null, event, { uid: "remote@example.test" });
  let etag = '"one"',
    content = raw,
    fail = false;
  const calls = [];
  const request = async (_config, method, body, headers, target) => {
    calls.push({ method, headers, target });
    if (fail) throw new CalendarError("Synthetic conflict", 409);
    if (method === "REPORT")
      return {
        status: 207,
        headers: {},
        body: `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/cal/event.ics</d:href><d:propstat><d:prop><d:getetag>${etag}</d:getetag><c:calendar-data><![CDATA[${content}]]></c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,
      };
    if (method === "PUT") {
      assert.equal(headers["If-Match"], etag);
      content = body;
      etag = '"two"';
      return { status: 204, headers: { etag }, body: "" };
    }
    if (method === "DELETE") {
      assert.equal(headers["If-Match"], etag);
      return { status: 204, headers: {}, body: "" };
    }
    throw new Error(`unexpected method ${method}`);
  };
  const calendar = await createCalendar(
    db,
    1,
    {
      name: "DAV",
      kind: "caldav",
      url: "https://calendar.example.test/cal/",
      username: "owner",
      password: "app-password",
      readOnly: false,
    },
    request,
  );
  assert.equal(calendar.hasPassword, true);
  assert.equal(calendar.password, undefined);
  const saved = await db
    .prepare("SELECT config_enc FROM calendars WHERE id=?")
    .get(calendar.id);
  assert.ok(!saved.config_enc.includes("app-password"));
  const entries = await calendarEvents(
    db,
    1,
    "2026-11-01T00:00:00Z",
    "2026-11-02T00:00:00Z",
  );
  assert.equal(entries.length, 1);
  const id = entries[0].eventId;
  const changed = await saveCalendarEvent(
    db,
    1,
    calendar.id,
    { title: "Changed", version: 1 },
    id,
    request,
  );
  assert.equal(changed.version, 2);
  assert.ok(
    content.includes("SCHEDULE-AGENT") || !itemDetails(content).organizer,
  );
  fail = true;
  await assert.rejects(syncCalendar(db, 1, calendar.id, request), {
    status: 409,
  });
  assert.equal((await getCalendarEvent(db, 1, id)).title, "Changed");
  await assert.rejects(
    saveCalendarEvent(
      db,
      1,
      calendar.id,
      { title: "Conflict", version: 2 },
      id,
      request,
    ),
    { status: 409 },
  );
  assert.equal((await getCalendarEvent(db, 1, id)).version, 2);
  fail = false;
  await updateCalendar(db, 1, calendar.id, { readOnly: true }, request);
  await assert.rejects(
    saveCalendarEvent(
      db,
      1,
      calendar.id,
      { title: "Forbidden", version: 2 },
      id,
      request,
    ),
    { status: 403 },
  );
  await updateCalendar(db, 1, calendar.id, { readOnly: false }, request);
  await removeCalendarEvent(db, 1, id, { version: 2 }, request);
  assert.equal(calls.at(-1).method, "DELETE");
});

test("mail invitations are tentative, idempotent, sender checked, and automatic import can be disabled", async (t) => {
  const db = await testDatabase(t);
  await insertTestUser(db);
  const account = { user_id: 1, email: "own@example.test" };
  const raw = editItem(
    null,
    {
      ...event,
      organizer: "organizer@example.test",
      attendees: [{ email: account.email }],
    },
    { uid: "invite@example.test" },
  );
  const request = invitation(raw, { method: "REQUEST" });
  const attachments = [
    { contentType: "text/calendar", content: Buffer.from(request) },
  ];
  assert.equal(
    (
      await importMailInvitations(db, account, attachments, [
        { address: "forged@example.test" },
      ])
    ).length,
    0,
  );
  const imported = await importMailInvitations(db, account, attachments, [
    { address: "organizer@example.test" },
  ]);
  assert.equal(imported.length, 1);
  let stored = await getCalendarEvent(db, 1, imported[0].id);
  assert.equal(stored.status, "TENTATIVE");
  assert.equal(stored.attendees[0].status, "NEEDS-ACTION");
  await importMailInvitations(db, account, attachments, [
    { address: "organizer@example.test" },
  ]);
  assert.equal(
    (await getCalendarEvent(db, 1, imported[0].id)).version,
    stored.version,
  );
  const cancelled = invitation(editItem(raw, { title: "Cancelled" }), {
    method: "CANCEL",
  });
  await importMailInvitations(
    db,
    account,
    [{ contentType: "text/calendar", content: Buffer.from(cancelled) }],
    [{ address: "organizer@example.test" }],
  );
  assert.equal(
    (await getCalendarEvent(db, 1, imported[0].id)).status,
    "CANCELLED",
  );
  const data = await listCalendars(db, 1);
  await setCalendarPreferences(db, 1, {
    defaultCalendarId: data.preferences.defaultCalendarId,
    autoImport: false,
  });
  assert.deepEqual(
    await importMailInvitations(db, account, attachments, [
      { address: "organizer@example.test" },
    ]),
    [],
  );
});

test("reminders only expose the owner's due events and honor dismissal", async (t) => {
  const db = await testDatabase(t);
  await insertTestUser(db);
  await insertTestUser(db, 2);
  const data = await listCalendars(db, 1);
  const item = await saveCalendarEvent(
    db,
    1,
    data.preferences.defaultCalendarId,
    event,
  );
  const now = Date.parse("2026-11-01T07:50:00Z");
  const alerts = await calendarAlerts(db, 1, now);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].itemId, item.id);
  assert.deepEqual(await calendarAlerts(db, 2, now), []);
  await db
    .prepare(
      "INSERT INTO calendar_alerts(user_id,item_id,occurrence_hash,dismissed) VALUES (1,?,?,1)",
    )
    .run(item.id, uidHash(alerts[0].occurrence));
  assert.deepEqual(await calendarAlerts(db, 1, now), []);
});

test("moving calendars preserves a series and cannot cross user boundaries", async (t) => {
  const db = await testDatabase(t);
  await insertTestUser(db);
  await insertTestUser(db, 2);
  const data = await listCalendars(db, 1),
    other = await listCalendars(db, 2);
  const target = await createCalendar(db, 1, { name: "Target", kind: "local" });
  const old = await saveCalendarEvent(
    db,
    1,
    data.preferences.defaultCalendarId,
    { ...event, recurrence: "FREQ=WEEKLY;COUNT=3" },
  );
  await assert.rejects(
    moveCalendarEvent(db, 1, old.id, other.preferences.defaultCalendarId, {
      version: old.version,
    }),
    { status: 404 },
  );
  const moved = await moveCalendarEvent(db, 1, old.id, target.id, {
    version: old.version,
    title: "Moved series",
  });
  assert.equal(moved.uid, old.uid);
  assert.equal(moved.calendarId, target.id);
  assert.equal(moved.title, "Moved series");
  await assert.rejects(getCalendarEvent(db, 1, old.id), { status: 404 });
  assert.equal(
    (
      await calendarEvents(
        db,
        1,
        "2026-11-01T00:00:00Z",
        "2026-11-30T00:00:00Z",
      )
    ).length,
    3,
  );
});

test("mail import sends nothing, and an explicit RSVP sends one reply from an owned attendee mailbox", async (t) => {
  const db = await testDatabase(t);
  await insertTestUser(db);
  await db
    .prepare(
      "INSERT INTO accounts(user_id,name,email,imap_host,imap_port,imap_secure,smtp_host,smtp_port,smtp_secure,username,password_enc,created_at) VALUES (1,'Own','own@example.test','imap.example.test',993,1,'smtp.example.test',465,1,'own','synthetic',1)",
    )
    .run();
  const account = await db
    .prepare("SELECT * FROM accounts WHERE user_id=1")
    .get();
  const raw = editItem(null, {
    ...event,
    organizer: "organizer@example.test",
    attendees: [{ email: account.email }, { email: "other@example.test" }],
  });
  const imported = await importMailInvitations(
    db,
    account,
    [
      {
        contentType: "text/calendar",
        content: Buffer.from(invitation(raw, { method: "REQUEST" })),
      },
    ],
    [{ address: "organizer@example.test" }],
  );
  const sent = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 1 };
    next();
  });
  registerCalendarRoutes(app, db, {
    sendMessage: async (...args) => {
      sent.push(args);
      return { sentCopy: { saved: true } };
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  assert.equal(sent.length, 0);
  const item = await getCalendarEvent(db, 1, imported[0].id);
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/calendar/events/${item.id}/respond`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: account.id,
        version: item.version,
        status: "ACCEPTED",
      }),
    },
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.sent, true);
  assert.equal(result.status, "CONFIRMED");
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1].to, "organizer@example.test");
  assert.equal(sent[0][2].method, "REPLY");
  const reply = itemDetails(sent[0][2].content);
  assert.equal(reply.attendees.length, 1);
  assert.equal(reply.attendees[0].email, account.email);
});
