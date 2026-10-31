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
  setPrimaryCalendar,
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
import { decrypt, encrypt } from "../server/security.js";

const event = {
  title: "Private meeting",
  start: "2026-11-01T09:00",
  end: "2026-11-01T10:00",
  timezone: "Europe/Berlin",
  reminder: 15,
};
test("primary calendars are personal, survive edits, allow writable CalDAV and do not change invitation targets", async (t) => {
  const db = await testDatabase(t);
  await insertTestUser(db);
  await insertTestUser(db, 2);
  const initial = await listCalendars(db, 1),
    other = await listCalendars(db, 2);
  const local = initial.calendars[0];
  const remote = await createCalendar(db, 1, {
    name: "Remote",
    kind: "caldav",
    url: "https://calendar.example.test/dav/",
    readOnly: false,
    setupPending: true,
  });
  await assert.rejects(setPrimaryCalendar(db, 1, remote.id), { status: 403 });
  await db.prepare("UPDATE calendars SET config_enc=? WHERE id=?").run(
    encrypt(
      JSON.stringify({
        url: "https://calendar.example.test/dav/",
        username: "fixture",
        password: "preserved",
      }),
    ),
    remote.id,
  );
  let preferences = await setPrimaryCalendar(db, 1, remote.id);
  assert.equal(preferences.primaryCalendarId, remote.id);
  assert.equal(
    preferences.defaultCalendarId,
    initial.preferences.defaultCalendarId,
  );
  assert.equal(preferences.autoImport, initial.preferences.autoImport);
  await updateCalendar(db, 1, remote.id, { name: "Renamed" });
  assert.equal(
    (await listCalendars(db, 1)).preferences.primaryCalendarId,
    remote.id,
  );
  const config = JSON.parse(
    decrypt(
      (
        await db
          .prepare("SELECT config_enc FROM calendars WHERE id=?")
          .get(remote.id)
      ).config_enc,
    ),
  );
  assert.equal(config.password, "preserved");
  await assert.rejects(setPrimaryCalendar(db, 1, other.calendars[0].id), {
    status: 404,
  });
  assert.equal(
    (await listCalendars(db, 2)).preferences.primaryCalendarId,
    null,
  );
  await setPrimaryCalendar(db, 1, local.id);
  assert.equal(
    (await listCalendars(db, 1)).preferences.primaryCalendarId,
    local.id,
  );
  await updateCalendar(db, 1, remote.id, { readOnly: true });
  await assert.rejects(setPrimaryCalendar(db, 1, remote.id), { status: 403 });
  await setPrimaryCalendar(db, 1, null);
  assert.equal(
    (await listCalendars(db, 1)).preferences.primaryCalendarId,
    null,
  );
  await assert.rejects(setPrimaryCalendar(db, 1, "1"));
});

test("parallel writes to different calendars cannot exceed the shared entry quota", async (t) => {
  const db = await testDatabase(t);
  await insertTestUser(db);
  const first = (await listCalendars(db, 1)).calendars[0];
  const calendars = [first];
  for (let i = 0; i < 3; i++)
    calendars.push(
      await createCalendar(db, 1, { name: `Synthetic ${i}`, kind: "local" }),
    );
  for (let offset = 0; offset < 9999; offset += 200) {
    const rows = Array.from(
      { length: Math.min(200, 9999 - offset) },
      (_, index) => {
        const number = offset + index,
          uid = `quota-${number}@example.test`;
        const raw = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART:20261101T090000Z\r\nSUMMARY:Synthetic quota fixture\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
        return [
          calendars[number < 5000 ? 0 : 1].id,
          uidHash(uid),
          encrypt(raw),
          1,
        ];
      },
    );
    await db
      .prepare(
        `INSERT INTO calendar_items(calendar_id,uid_hash,ical_enc,updated_at) VALUES ${rows.map(() => "(?,?,?,?)").join(",")}`,
      )
      .run(...rows.flat());
  }
  const result = await Promise.allSettled(
    calendars
      .slice(2)
      .map((calendar) => saveCalendarEvent(db, 1, calendar.id, event)),
  );
  assert.equal(
    result.filter((entry) => entry.status === "fulfilled").length,
    1,
  );
  assert.equal(
    result.find((entry) => entry.status === "rejected").reason.status,
    413,
  );
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM calendar_items").get()).n,
    10000,
  );
});

test("parallel calendar creation cannot bypass the per-user calendar limit", async (t) => {
  const db = await testDatabase(t);
  await insertTestUser(db);
  await listCalendars(db, 1);
  for (let i = 0; i < 28; i++)
    await createCalendar(db, 1, { name: `Synthetic ${i}`, kind: "local" });
  const result = await Promise.allSettled(
    [1, 2].map((number) =>
      createCalendar(db, 1, { name: `Concurrent ${number}`, kind: "local" }),
    ),
  );
  assert.equal(
    result.filter((entry) => entry.status === "fulfilled").length,
    1,
  );
  assert.equal((await listCalendars(db, 1)).calendars.length, 30);
});

test("local bulk imports use batches, skip duplicates and roll back completely on a failed write", async (t) => {
  const db = await testDatabase(t);
  await insertTestUser(db);
  const calendar = (await listCalendars(db, 1)).calendars[0];
  const raw =
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n" +
    Array.from(
      { length: 250 },
      (_, i) =>
        `BEGIN:VEVENT\r\nUID:bulk-${i}@example.test\r\nDTSTART:20261101T090000Z\r\nDTEND:20261101T100000Z\r\nSUMMARY:Synthetic ${i}\r\nEND:VEVENT\r\n`,
    ).join("") +
    "END:VCALENDAR\r\n";
  let inserts = 0;
  const instrumented = {
    ...db,
    prepare(sql) {
      if (sql.startsWith("INSERT INTO calendar_items(")) inserts++;
      return db.prepare(sql);
    },
  };
  assert.deepEqual(await importCalendar(instrumented, 1, calendar.id, raw), {
    imported: 250,
    skipped: 0,
  });
  assert.equal(
    inserts,
    3,
    "one write per 100 records instead of one worker and quota scan per record",
  );
  assert.deepEqual(await importCalendar(db, 1, calendar.id, raw), {
    imported: 0,
    skipped: 250,
  });
  const before = await db
    .prepare(
      "SELECT id,version,ical_enc FROM calendar_items WHERE calendar_id=? ORDER BY id",
    )
    .all(calendar.id);
  let writes = 0;
  const failing = {
    ...db,
    prepare(sql) {
      const statement = db.prepare(sql);
      if (sql.startsWith("INSERT INTO calendar_items("))
        return {
          ...statement,
          run: async (...args) => {
            if (++writes === 2) throw new Error("Synthetic storage failure");
            return statement.run(...args);
          },
        };
      return statement;
    },
  };
  await assert.rejects(
    importCalendar(
      failing,
      1,
      calendar.id,
      raw.replaceAll("Synthetic", "Replacement"),
      { replace: true },
    ),
    /Synthetic storage failure/,
  );
  assert.deepEqual(
    await db
      .prepare(
        "SELECT id,version,ical_enc FROM calendar_items WHERE calendar_id=? ORDER BY id",
      )
      .all(calendar.id),
    before,
  );
});
test("prepared calendars keep credentials empty and do not connect until explicitly activated", async (t) => {
  const db = await testDatabase(t);
  await insertTestUser(db);
  let calls = 0;
  const request = async () => {
    calls++;
    return {
      status: 207,
      headers: {},
      body: '<d:multistatus xmlns:d="DAV:"/>',
    };
  };
  const calendar = await createCalendar(
    db,
    1,
    {
      name: "Prepared",
      kind: "caldav",
      url: "https://calendar.example.test/cal/",
      username: "owner",
      setupPending: true,
      readOnly: false,
    },
    request,
  );
  assert.equal(calendar.setupPending, true);
  assert.equal(calendar.hasPassword, false);
  assert.equal(calls, 0);
  await updateCalendar(
    db,
    1,
    calendar.id,
    { name: "Still prepared", color: "#123456" },
    request,
  );
  await assert.rejects(syncCalendar(db, 1, calendar.id, request), {
    status: 409,
  });
  await assert.rejects(
    saveCalendarEvent(db, 1, calendar.id, event, null, request),
    { status: 409 },
  );
  assert.equal(calls, 0);
  await assert.rejects(
    updateCalendar(
      db,
      1,
      calendar.id,
      { setupPending: false, password: "wrong" },
      async () => {
        throw new CalendarError("Rejected", 502);
      },
    ),
    { status: 502 },
  );
  const pending = (await listCalendars(db, 1)).calendars.find(
    (c) => c.id === calendar.id,
  );
  assert.equal(pending.setupPending, true);
  assert.equal(pending.hasPassword, false);
  const ready = await updateCalendar(
    db,
    1,
    calendar.id,
    { setupPending: false, password: "synthetic-app-password" },
    request,
  );
  assert.equal(ready.setupPending, false);
  assert.equal(ready.hasPassword, true);
  assert.equal(ready.password, undefined);
  assert.equal(calls, 2);
  await assert.rejects(
    updateCalendar(
      db,
      1,
      calendar.id,
      { username: "another-user" },
      async (config) => {
        assert.equal(
          config.password,
          "",
          "a stored password is never reused for a changed username",
        );
        throw new CalendarError("Synthetic missing credentials", 502);
      },
    ),
    { status: 502 },
  );
  assert.equal(
    (await listCalendars(db, 1)).calendars.find(
      (item) => item.id === calendar.id,
    ).username,
    "owner",
  );
});

test("unchanged calendar syncs keep ciphertext and versions without per-item database writes", async (t) => {
  const db = await testDatabase(t);
  await insertTestUser(db);
  const raw =
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n" +
    Array.from(
      { length: 100 },
      (_, i) =>
        `BEGIN:VEVENT\r\nUID:sync-${i}@example.test\r\nDTSTART:20261101T090000Z\r\nDTEND:20261101T100000Z\r\nSUMMARY:Synthetic ${i}\r\nEND:VEVENT\r\n`,
    ).join("") +
    "END:VCALENDAR\r\n";
  const request = async () => ({
    status: 200,
    headers: { etag: '"1"' },
    body: raw,
  });
  const calendar = await createCalendar(
    db,
    1,
    {
      kind: "ics",
      name: "Synthetic subscription",
      url: "https://calendar.example.test/feed.ics",
    },
    request,
  );
  const before = await db
    .prepare(
      "SELECT id,version,ical_enc,updated_at FROM calendar_items WHERE calendar_id=? ORDER BY id",
    )
    .all(calendar.id);
  let writes = 0,
    itemReads = 0;
  const measured = {
    ...db,
    prepare(sql) {
      if (/^(?:INSERT INTO|UPDATE) calendar_items/.test(sql)) writes++;
      if (/^SELECT .* FROM calendar_items WHERE calendar_id=/.test(sql))
        itemReads++;
      return db.prepare(sql);
    },
  };
  await syncCalendar(measured, 1, calendar.id, request);
  assert.equal(writes, 0);
  assert.equal(
    itemReads,
    1,
    "load cached rows once instead of SELECT per event",
  );
  assert.deepEqual(
    await db
      .prepare(
        "SELECT id,version,ical_enc,updated_at FROM calendar_items WHERE calendar_id=? ORDER BY id",
      )
      .all(calendar.id),
    before,
  );
});
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
  await db
    .prepare(
      "UPDATE calendar_alerts SET dismissed=0,snooze_until=? WHERE user_id=1 AND item_id=?",
    )
    .run(now + 60000, item.id);
  assert.deepEqual(await calendarAlerts(db, 1, now), []);
  const snoozed = await calendarAlerts(db, 1, now + 60001);
  assert.equal(snoozed.length, 1);
  assert.equal(snoozed[0].snoozeUntil, now + 60000);
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
