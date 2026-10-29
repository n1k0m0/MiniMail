import { CalendarError, uidHash, validEmail } from "./calendarIcs.js";
import { runCalendar } from "./calendarWorker.js";
import {
  calendarUrl,
  discoverCalendars,
  fetchRemoteCalendar,
  putRemoteItem,
  deleteRemoteItem,
  remoteRequest,
} from "./calendarRemote.js";
import { encrypt, decrypt } from "./security.js";
import crypto from "node:crypto";
import { DateTime } from "luxon";

const locks = new Map();
async function exclusive(id, callback) {
  if (locks.has(id))
    throw new CalendarError(
      "Dieser Kalender wird gerade verarbeitet. Bitte kurz warten und erneut versuchen.",
      409,
    );
  locks.set(id, true);
  try {
    return await callback();
  } finally {
    locks.delete(id);
  }
}
const configOf = (row) =>
  row.config_enc ? JSON.parse(decrypt(row.config_enc)) : {};
export function publicCalendar(row) {
  const config = configOf(row);
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    kind: row.kind,
    readOnly: !!row.read_only,
    visible: !!row.visible,
    timezone: row.timezone,
    lastSync: row.last_sync,
    syncError: row.sync_error || "",
    url: config.url || "",
    username: config.username || "",
    hasPassword: !!config.password,
  };
}
export async function calendarFor(db, userId, id, writable = false) {
  const row = await db
    .prepare("SELECT * FROM calendars WHERE id=? AND user_id=?")
    .get(Number(id) || 0, userId);
  if (!row) throw new CalendarError("Kalender nicht gefunden.", 404);
  if (writable && row.read_only)
    throw new CalendarError("Dieser Kalender ist schreibgeschützt.", 403);
  return row;
}
export async function calendarPreferences(db, userId) {
  return db.transaction(async () => {
    await db.prepare("SELECT id FROM users WHERE id=? FOR UPDATE").get(userId);
    let row = await db
      .prepare("SELECT * FROM calendar_preferences WHERE user_id=?")
      .get(userId);
    if (!row) {
      const result = await db
        .prepare(
          "INSERT INTO calendars(user_id,name,color,kind,timezone,created_at) VALUES (?,'Persönlich','#5267df','local','UTC',?)",
        )
        .run(userId, Date.now());
      await db
        .prepare(
          "INSERT INTO calendar_preferences(user_id,default_calendar_id,auto_import) VALUES (?,?,1)",
        )
        .run(userId, result.insertId);
      row = { default_calendar_id: result.insertId, auto_import: 1 };
    }
    return {
      defaultCalendarId: row.default_calendar_id,
      autoImport: !!row.auto_import,
    };
  });
}
export async function listCalendars(db, userId) {
  const preferences = await calendarPreferences(db, userId);
  const calendars = (
    await db
      .prepare("SELECT * FROM calendars WHERE user_id=? ORDER BY id")
      .all(userId)
  ).map(publicCalendar);
  return { calendars, preferences };
}
function calendarInput(body, existing) {
  const kind = existing?.kind || body.kind;
  const name = body.name ?? existing?.name,
    color = body.color ?? existing?.color ?? "#5267df",
    timezone = body.timezone ?? existing?.timezone ?? "UTC";
  if (
    !["local", "ics", "caldav"].includes(kind) ||
    typeof name !== "string" ||
    !name.trim() ||
    name.length > 200 ||
    !/^#[0-9a-f]{6}$/i.test(color) ||
    typeof timezone !== "string" ||
    timezone.length > 100 ||
    !DateTime.now().setZone(timezone).isValid
  )
    throw new CalendarError(
      "Name, Farbe oder Zeitzone des Kalenders ist ungültig.",
    );
  const old = existing ? configOf(existing) : {};
  let config = {};
  if (kind !== "local") {
    const url = calendarUrl(body.url ?? old.url).href;
    if (
      typeof (body.username ?? old.username ?? "") !== "string" ||
      (body.username ?? old.username ?? "").length > 500 ||
      typeof (body.password ?? "") !== "string" ||
      (body.password || "").length > 2000
    )
      throw new CalendarError("Die Kalender-Zugangsdaten sind ungültig.");
    config = {
      url,
      username: body.username ?? old.username ?? "",
      password: body.clearPassword
        ? ""
        : body.password || (url === old.url ? old.password : "") || "",
    };
    if (/[\r\n]/.test(config.username))
      throw new CalendarError("Der Kalender-Benutzername ist ungültig.");
  }
  return {
    name: name.trim(),
    color,
    kind,
    timezone,
    config,
    readOnly:
      kind === "local"
        ? false
        : (body.readOnly ?? (existing ? !!existing.read_only : true)),
    visible: body.visible ?? (existing ? !!existing.visible : true),
  };
}
export async function createCalendar(db, userId, body, request) {
  await calendarPreferences(db, userId);
  if (
    (
      await db
        .prepare("SELECT COUNT(*) AS n FROM calendars WHERE user_id=?")
        .get(userId)
    ).n >= 30
  )
    throw new CalendarError("Pro Benutzer sind höchstens 30 Kalender möglich.");
  const item = calendarInput({ readOnly: true, ...body });
  const result = await db
    .prepare(
      "INSERT INTO calendars(user_id,name,color,kind,config_enc,read_only,visible,timezone,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .run(
      userId,
      item.name,
      item.color,
      item.kind,
      item.kind === "local" ? null : encrypt(JSON.stringify(item.config)),
      Number(item.readOnly),
      Number(item.visible),
      item.timezone,
      Date.now(),
    );
  try {
    if (item.kind !== "local")
      await syncCalendar(db, userId, result.insertId, request);
  } catch (error) {
    await db
      .prepare("DELETE FROM calendars WHERE id=? AND user_id=?")
      .run(result.insertId, userId);
    throw error;
  }
  return publicCalendar(await calendarFor(db, userId, result.insertId));
}
async function upsertCached(db, calendarId, entry, source = "remote") {
  const existing = await db
    .prepare("SELECT * FROM calendar_items WHERE calendar_id=? AND uid_hash=?")
    .get(calendarId, uidHash(entry.uid));
  if (existing) {
    const changed = decrypt(existing.ical_enc) !== entry.ics;
    await db
      .prepare(
        "UPDATE calendar_items SET ical_enc=?,href=?,etag=?,version=version+?,updated_at=? WHERE id=? AND version=?",
      )
      .run(
        encrypt(entry.ics),
        entry.href || null,
        entry.etag || null,
        Number(changed),
        Date.now(),
        existing.id,
        existing.version,
      );
  } else
    await db
      .prepare(
        "INSERT INTO calendar_items(calendar_id,uid_hash,ical_enc,href,etag,source,updated_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        calendarId,
        uidHash(entry.uid),
        encrypt(entry.ics),
        entry.href || null,
        entry.etag || null,
        source,
        Date.now(),
      );
}
async function syncUnlocked(db, calendar, request) {
  if (calendar.kind === "local") return;
  try {
    const remote = await fetchRemoteCalendar(
      configOf(calendar),
      calendar.kind,
      request,
    );
    const entries = await runCalendar(
        "splitResources",
        remote.items,
        calendar.kind,
      ),
      seen = new Set();
    for (const entry of entries) {
      const hash = uidHash(entry.uid);
      if (seen.has(hash))
        throw new CalendarError(
          "Der Online-Kalender enthält doppelte Termin-UIDs.",
          502,
        );
      seen.add(hash);
    }
    if (entries.length > 5000)
      throw new CalendarError(
        "Der Online-Kalender enthält mehr als 5000 Einträge.",
      );
    await db.transaction(async () => {
      for (const entry of entries) await upsertCached(db, calendar.id, entry);
      for (const item of await db
        .prepare("SELECT id,uid_hash FROM calendar_items WHERE calendar_id=?")
        .all(calendar.id))
        if (!seen.has(item.uid_hash))
          await db
            .prepare("DELETE FROM calendar_items WHERE id=?")
            .run(item.id);
      await db
        .prepare(
          "UPDATE calendars SET last_sync=?,sync_error=NULL,remote_etag=? WHERE id=?",
        )
        .run(Date.now(), remote.etag, calendar.id);
    });
  } catch (error) {
    await db
      .prepare("UPDATE calendars SET sync_error=? WHERE id=?")
      .run(
        error instanceof CalendarError
          ? error.message
          : "Synchronisierung fehlgeschlagen. Die vorhandenen Termine bleiben erhalten.",
        calendar.id,
      );
    throw error;
  }
}
export async function syncCalendar(db, userId, id, request) {
  return exclusive(Number(id), async () => {
    const row = await calendarFor(db, userId, id);
    await syncUnlocked(db, row, request);
    return publicCalendar(await calendarFor(db, userId, id));
  });
}
export async function updateCalendar(db, userId, id, body, request) {
  return exclusive(Number(id), async () => {
    const old = await calendarFor(db, userId, id),
      item = calendarInput(body, old);
    const config =
      item.kind === "local" ? null : encrypt(JSON.stringify(item.config));
    // Connection edits are verified before replacing the existing connection.
    if (
      item.kind !== "local" &&
      (body.url !== undefined ||
        body.username !== undefined ||
        body.password ||
        body.clearPassword)
    )
      await fetchRemoteCalendar(item.config, item.kind, request);
    await db
      .prepare(
        "UPDATE calendars SET name=?,color=?,config_enc=?,read_only=?,visible=?,timezone=? WHERE id=? AND user_id=?",
      )
      .run(
        item.name,
        item.color,
        config,
        Number(item.readOnly),
        Number(item.visible),
        item.timezone,
        old.id,
        userId,
      );
    if (
      item.kind !== "local" &&
      JSON.stringify(configOf(old)) !== JSON.stringify(item.config)
    )
      await syncUnlocked(db, await calendarFor(db, userId, id), request);
    return publicCalendar(await calendarFor(db, userId, id));
  });
}
export async function deleteCalendar(db, userId, id) {
  return exclusive(Number(id), async () => {
    await calendarFor(db, userId, id);
    await db
      .prepare("DELETE FROM calendars WHERE id=? AND user_id=?")
      .run(Number(id), userId);
  });
}
export async function eventFor(db, userId, id) {
  const row = await db
    .prepare(
      "SELECT calendar_items.* FROM calendar_items JOIN calendars ON calendars.id=calendar_items.calendar_id WHERE calendar_items.id=? AND calendars.user_id=?",
    )
    .get(Number(id) || 0, userId);
  if (!row) throw new CalendarError("Termin nicht gefunden.", 404);
  return row;
}
export async function getCalendarEvent(db, userId, id) {
  const row = await eventFor(db, userId, id);
  return {
    ...(await runCalendar("itemDetails", decrypt(row.ical_enc))),
    id: row.id,
    calendarId: row.calendar_id,
    version: row.version,
    source: row.source,
  };
}
async function writeItem(db, calendar, raw, old, request) {
  if (calendar.read_only)
    throw new CalendarError("Dieser Kalender ist schreibgeschützt.", 403);
  const details = await runCalendar("itemDetails", raw);
  let remote = { href: old?.href, etag: old?.etag };
  if (calendar.kind === "caldav")
    remote = await putRemoteItem(
      configOf(calendar),
      {
        ics: await runCalendar("clientScheduling", raw),
        ...remote,
        uid: details.uid,
      },
      request,
    );
  if (calendar.kind === "ics") {
    if (!calendar.remote_etag)
      throw new CalendarError(
        "Dieser iCalendar-Server bietet keinen sicheren Schreibzugriff mit Versionskennung.",
        409,
      );
    const others = await db
      .prepare("SELECT id,ical_enc FROM calendar_items WHERE calendar_id=?")
      .all(calendar.id);
    const combined = await runCalendar("joinCalendar", [
      ...others
        .filter((item) => item.id !== old?.id)
        .map((item) => decrypt(item.ical_enc)),
      raw,
    ]);
    const response = await (request || remoteRequest)(
      configOf(calendar),
      "PUT",
      combined,
      { "If-Match": calendar.remote_etag },
    );
    await db
      .prepare("UPDATE calendars SET remote_etag=?,last_sync=? WHERE id=?")
      .run(response.headers.etag || null, Date.now(), calendar.id);
  }
  if (old) {
    const result = await db
      .prepare(
        "UPDATE calendar_items SET ical_enc=?,href=?,etag=?,version=version+1,updated_at=? WHERE id=? AND version=?",
      )
      .run(
        encrypt(raw),
        remote.href || null,
        remote.etag || null,
        Date.now(),
        old.id,
        old.version,
      );
    if (!result.changes)
      throw new CalendarError(
        "Der Termin wurde inzwischen geändert. Bitte erneut öffnen.",
        409,
      );
    return old.id;
  }
  const existing = await db
    .prepare("SELECT id FROM calendar_items WHERE calendar_id=? AND uid_hash=?")
    .get(calendar.id, uidHash(details.uid));
  if (existing)
    throw new CalendarError(
      "Dieser Termin ist bereits im Kalender vorhanden.",
      409,
    );
  return (
    await db
      .prepare(
        "INSERT INTO calendar_items(calendar_id,uid_hash,ical_enc,href,etag,source,updated_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        calendar.id,
        uidHash(details.uid),
        encrypt(raw),
        remote.href || null,
        remote.etag || null,
        "manual",
        Date.now(),
      )
  ).insertId;
}
export async function saveCalendarEvent(
  db,
  userId,
  calendarId,
  body,
  id = null,
  request,
) {
  return exclusive(Number(calendarId), async () => {
    const calendar = await calendarFor(db, userId, calendarId, true),
      old = id ? await eventFor(db, userId, id) : null;
    if (
      old &&
      (old.calendar_id !== calendar.id || body.version !== old.version)
    )
      throw new CalendarError(
        "Der Termin wurde inzwischen geändert. Bitte erneut öffnen.",
        409,
      );
    if (
      !old &&
      (
        await db
          .prepare(
            "SELECT COUNT(*) AS n FROM calendar_items WHERE calendar_id=?",
          )
          .get(calendar.id)
      ).n >= 5000
    )
      throw new CalendarError("Der Kalender enthält bereits 5000 Einträge.");
    const raw = await runCalendar(
      "editItem",
      old ? decrypt(old.ical_enc) : null,
      body,
      { uid: crypto.randomUUID(), kind: body.kind || "vevent" },
    );
    const eventId = await writeItem(db, calendar, raw, old, request);
    return getCalendarEvent(db, userId, eventId);
  });
}
export async function removeCalendarEvent(db, userId, id, body, request) {
  const item = await eventFor(db, userId, id);
  return exclusive(item.calendar_id, async () => {
    const old = await eventFor(db, userId, id),
      calendar = await calendarFor(db, userId, old.calendar_id, true);
    if (old.version !== body.version)
      throw new CalendarError(
        "Der Termin wurde inzwischen geändert. Bitte erneut öffnen.",
        409,
      );
    if (body.recurrenceId) {
      await writeItem(
        db,
        calendar,
        await runCalendar(
          "removeOccurrence",
          decrypt(old.ical_enc),
          body.recurrenceId,
        ),
        old,
        request,
      );
      return;
    }
    if (calendar.kind === "caldav")
      await deleteRemoteItem(configOf(calendar), old, request);
    if (calendar.kind === "ics") {
      if (!calendar.remote_etag)
        throw new CalendarError(
          "Die Versionskennung fehlt. Bitte zuerst synchronisieren.",
          409,
        );
      const rows = await db
        .prepare("SELECT id,ical_enc FROM calendar_items WHERE calendar_id=?")
        .all(calendar.id);
      const raw = await runCalendar(
        "joinCalendar",
        rows
          .filter((row) => row.id !== old.id)
          .map((row) => decrypt(row.ical_enc)),
      );
      const response = await (request || remoteRequest)(
        configOf(calendar),
        "PUT",
        raw,
        { "If-Match": calendar.remote_etag },
      );
      await db
        .prepare("UPDATE calendars SET remote_etag=? WHERE id=?")
        .run(response.headers.etag || null, calendar.id);
    }
    await db
      .prepare("DELETE FROM calendar_items WHERE id=? AND version=?")
      .run(old.id, old.version);
  });
}
export async function importCalendar(
  db,
  userId,
  calendarId,
  raw,
  { replace = false, request } = {},
) {
  const entries = await runCalendar("splitCalendar", raw);
  const calendar = await calendarFor(db, userId, calendarId, true);
  if (calendar.kind !== "local" && entries.length > 100)
    throw new CalendarError(
      "Bitte höchstens 100 Termine gleichzeitig in einen Online-Kalender importieren.",
    );
  return exclusive(calendar.id, async () => {
    let imported = 0,
      skipped = 0;
    for (const entry of entries) {
      const old = await db
        .prepare(
          "SELECT * FROM calendar_items WHERE calendar_id=? AND uid_hash=?",
        )
        .get(calendar.id, uidHash(entry.uid));
      if (old && !replace) {
        skipped++;
        continue;
      }
      await writeItem(
        db,
        await calendarFor(db, userId, calendar.id, true),
        entry.ics,
        old,
        request,
      );
      imported++;
    }
    return { imported, skipped };
  });
}
export async function calendarEvents(db, userId, from, to) {
  const rows = await db
    .prepare(
      "SELECT calendar_items.*,calendars.color,calendars.read_only,calendars.name AS calendar_name FROM calendar_items JOIN calendars ON calendars.id=calendar_items.calendar_id WHERE calendars.user_id=? AND calendars.visible=1",
    )
    .all(userId);
  return runCalendar(
    "expandItems",
    rows.map((row) => ({
      id: row.id,
      calendarId: row.calendar_id,
      version: row.version,
      color: row.color,
      readOnly: !!row.read_only,
      calendarName: row.calendar_name,
      source: row.source,
      ics: decrypt(row.ical_enc),
    })),
    from,
    to,
  );
}
export async function calendarTasks(db, userId) {
  const rows = await db
    .prepare(
      "SELECT calendar_items.*,calendars.color,calendars.read_only,calendars.name AS calendar_name FROM calendar_items JOIN calendars ON calendars.id=calendar_items.calendar_id WHERE calendars.user_id=? AND calendars.visible=1",
    )
    .all(userId);
  return runCalendar(
    "taskItems",
    rows.map((row) => ({
      id: row.id,
      calendarId: row.calendar_id,
      version: row.version,
      color: row.color,
      readOnly: !!row.read_only,
      calendarName: row.calendar_name,
      ics: decrypt(row.ical_enc),
    })),
  );
}
export async function exportCalendar(db, userId, id) {
  await calendarFor(db, userId, id);
  return runCalendar(
    "joinCalendar",
    (
      await db
        .prepare(
          "SELECT ical_enc FROM calendar_items WHERE calendar_id=? ORDER BY id",
        )
        .all(Number(id))
    ).map((row) => decrypt(row.ical_enc)),
  );
}
export async function setCalendarPreferences(db, userId, body) {
  await calendarPreferences(db, userId);
  if (typeof body.autoImport !== "boolean")
    throw new CalendarError(
      "Die automatische Übernahme muss ein- oder ausgeschaltet sein.",
    );
  const calendar = body.defaultCalendarId
    ? await calendarFor(db, userId, body.defaultCalendarId, true)
    : null;
  // Mail imports stay local until the user deliberately copies or responds.
  // A background poll must never trigger a remote server's scheduling agent.
  if (body.autoImport && calendar?.kind !== "local")
    throw new CalendarError(
      "Automatische Einladungen benötigen einen lokalen Zielkalender.",
    );
  await db
    .prepare(
      "UPDATE calendar_preferences SET default_calendar_id=?,auto_import=? WHERE user_id=?",
    )
    .run(calendar?.id || null, Number(body.autoImport), userId);
  return calendarPreferences(db, userId);
}
export async function importMailInvitations(
  db,
  account,
  attachments,
  from,
  manual = false,
) {
  const preferences = await calendarPreferences(db, account.user_id);
  if (!preferences.defaultCalendarId || (!preferences.autoImport && !manual))
    return [];
  const calendar = await calendarFor(
    db,
    account.user_id,
    preferences.defaultCalendarId,
    true,
  );
  const results = [];
  for (const attachment of attachments || []) {
    if (
      !/text\/calendar|application\/ics/i.test(attachment.contentType || "") &&
      !/\.ics$/i.test(attachment.filename || "")
    )
      continue;
    if (!attachment.content || attachment.content.length > 256 * 1024) continue;
    let entries;
    try {
      entries = await runCalendar(
        "splitCalendar",
        attachment.content.toString("utf8"),
      );
    } catch {
      continue;
    }
    for (const entry of entries.slice(0, 50)) {
      const details = await runCalendar("itemDetails", entry.ics);
      if (
        details.kind !== "vevent" ||
        !["REQUEST", "CANCEL", "REPLY"].includes(entry.method)
      )
        continue;
      const sender = (from || [])
        .map((p) => p.address?.toLowerCase())
        .filter(Boolean);
      if (
        entry.method !== "REPLY" &&
        (!sender.includes(details.organizer) ||
          !details.attendees.some(
            (p) => p.email === account.email.toLowerCase(),
          ))
      )
        continue;
      await exclusive(calendar.id, async () => {
        const old = await db
          .prepare(
            "SELECT * FROM calendar_items WHERE calendar_id=? AND uid_hash=?",
          )
          .get(calendar.id, uidHash(entry.uid));
        if (entry.method === "REPLY") {
          if (!old) return;
          const stored = await runCalendar(
            "itemDetails",
            decrypt(old.ical_enc),
          );
          const attendee = details.attendees.find((p) =>
            sender.includes(p.email),
          );
          if (
            !attendee ||
            stored.organizer !== account.email.toLowerCase() ||
            !stored.attendees.some((p) => p.email === attendee.email)
          )
            return;
          await writeItem(
            db,
            calendar,
            await runCalendar("applyReply", decrypt(old.ical_enc), {
              address: attendee.email,
              status: attendee.status,
            }),
            old,
          );
          return;
        }
        if (old) {
          const stored = await runCalendar(
            "itemDetails",
            decrypt(old.ical_enc),
          );
          if (
            old.source !== "invitation" ||
            stored.organizer !== details.organizer ||
            details.sequence < stored.sequence ||
            (details.sequence === stored.sequence &&
              details.stamp <= stored.stamp)
          ) {
            results.push({
              id: old.id,
              calendarId: calendar.id,
              title: stored.title,
              existing: true,
            });
            return;
          }
        } else if (entry.method === "CANCEL") return;
        let raw =
          entry.method === "CANCEL"
            ? entry.ics
            : await runCalendar("tentativeInvitation", entry.ics);
        if (old)
          raw = await runCalendar(
            "mergeInvitation",
            decrypt(old.ical_enc),
            raw,
          );
        const id = await writeItem(db, calendar, raw, old);
        await db
          .prepare("UPDATE calendar_items SET source='invitation' WHERE id=?")
          .run(id);
        results.push({
          id,
          calendarId: calendar.id,
          title: details.title,
          existing: !!old,
          cancelled: entry.method === "CANCEL",
        });
      });
    }
  }
  return results;
}
export async function calendarAlerts(db, userId, now = Date.now()) {
  const events = await calendarEvents(
    db,
    userId,
    new Date(now - 86400000).toISOString(),
    new Date(now + 3 * 86400000).toISOString(),
  );
  const saved = await db
    .prepare("SELECT * FROM calendar_alerts WHERE user_id=?")
    .all(userId);
  return events
    .filter((event) => event.status !== "COMPLETED")
    .flatMap((event) => {
      const key = `${event.recurrenceId || event.start}`;
      const hash = uidHash(key),
        state = saved.find(
          (s) => s.item_id === event.eventId && s.occurrence_hash === hash,
        );
      if (state?.dismissed || (state?.snooze_until && state.snooze_until > now))
        return [];
      const due =
        event.alarms.some((time) => time <= now && time >= now - 86400000) ||
        (state?.snooze_until && state.snooze_until <= now);
      return due
        ? [
            {
              itemId: event.eventId,
              occurrence: key,
              title: event.title,
              start: event.start,
              color: event.color,
            },
          ]
        : [];
    })
    .slice(0, 50);
}
export function registerCalendarRoutes(
  app,
  db,
  { accountFor, getInvitationParts, sendMessage },
) {
  const route = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (error) {
      error instanceof CalendarError
        ? res.status(error.status).json({ error: error.message })
        : next(error);
    }
  };
  app.get(
    "/api/calendar/calendars",
    route(async (req, res) => res.json(await listCalendars(db, req.user.id))),
  );
  app.post(
    "/api/calendar/calendars",
    route(async (req, res) =>
      res
        .status(201)
        .json(await createCalendar(db, req.user.id, req.body || {})),
    ),
  );
  app.patch(
    "/api/calendar/calendars/:calendarId",
    route(async (req, res) =>
      res.json(
        await updateCalendar(
          db,
          req.user.id,
          req.params.calendarId,
          req.body || {},
        ),
      ),
    ),
  );
  app.delete(
    "/api/calendar/calendars/:calendarId",
    route(async (req, res) => {
      await deleteCalendar(db, req.user.id, req.params.calendarId);
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/calendar/calendars/:calendarId/sync",
    route(async (req, res) =>
      res.json(await syncCalendar(db, req.user.id, req.params.calendarId)),
    ),
  );
  app.post(
    "/api/calendar/discover",
    route(async (req, res) => {
      const input = calendarInput({
        ...req.body,
        kind: "caldav",
        name: "Discovery",
      });
      res.json(await discoverCalendars(input.config));
    }),
  );
  app.patch(
    "/api/calendar/preferences",
    route(async (req, res) =>
      res.json(await setCalendarPreferences(db, req.user.id, req.body || {})),
    ),
  );
  app.get(
    "/api/calendar/events",
    route(async (req, res) =>
      res.json(
        await calendarEvents(
          db,
          req.user.id,
          String(req.query.start || ""),
          String(req.query.end || ""),
        ),
      ),
    ),
  );
  app.get(
    "/api/calendar/tasks",
    route(async (req, res) => res.json(await calendarTasks(db, req.user.id))),
  );
  app.get(
    "/api/calendar/events/:eventId",
    route(async (req, res) =>
      res.json(await getCalendarEvent(db, req.user.id, req.params.eventId)),
    ),
  );
  app.post(
    "/api/calendar/calendars/:calendarId/events",
    route(async (req, res) =>
      res
        .status(201)
        .json(
          await saveCalendarEvent(
            db,
            req.user.id,
            req.params.calendarId,
            req.body || {},
          ),
        ),
    ),
  );
  app.patch(
    "/api/calendar/events/:eventId",
    route(async (req, res) => {
      const old = await eventFor(db, req.user.id, req.params.eventId);
      res.json(
        await saveCalendarEvent(
          db,
          req.user.id,
          old.calendar_id,
          req.body || {},
          old.id,
        ),
      );
    }),
  );
  app.delete(
    "/api/calendar/events/:eventId",
    route(async (req, res) => {
      await removeCalendarEvent(
        db,
        req.user.id,
        req.params.eventId,
        req.body || {},
      );
      res.json({ ok: true });
    }),
  );
  app.get(
    "/api/calendar/calendars/:calendarId/export",
    route(async (req, res) => {
      const raw = await exportCalendar(db, req.user.id, req.params.calendarId);
      res
        .type("text/calendar; charset=utf-8")
        .attachment("calendar.ics")
        .send(raw);
    }),
  );
  app.post(
    "/api/calendar/calendars/:calendarId/import",
    route(async (req, res) =>
      res.json(
        await importCalendar(
          db,
          req.user.id,
          req.params.calendarId,
          req.body?.ics,
          { replace: req.body?.replace === true },
        ),
      ),
    ),
  );
  app.post(
    "/api/calendar/mail/:id/:uid",
    route(async (req, res) => {
      const account = await accountFor(req, res);
      if (!account) return;
      const parts = await getInvitationParts(
        account,
        String(req.query.folder || "INBOX"),
        Number(req.params.uid),
      );
      res.json(
        await importMailInvitations(
          db,
          account,
          parts.attachments,
          parts.from,
          true,
        ),
      );
    }),
  );
  app.get(
    "/api/calendar/alerts",
    route(async (req, res) => res.json(await calendarAlerts(db, req.user.id))),
  );
  app.post(
    "/api/calendar/alerts",
    route(async (req, res) => {
      const body = req.body || {},
        item = await eventFor(db, req.user.id, body.itemId);
      if (
        typeof body.occurrence !== "string" ||
        body.occurrence.length > 100 ||
        (!body.dismiss && ![5, 10, 15, 30, 60, 1440].includes(body.minutes))
      )
        throw new CalendarError("Ungültige Erinnerung.");
      await db
        .prepare(
          "INSERT INTO calendar_alerts(user_id,item_id,occurrence_hash,snooze_until,dismissed) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE snooze_until=VALUES(snooze_until),dismissed=VALUES(dismissed)",
        )
        .run(
          req.user.id,
          item.id,
          uidHash(body.occurrence),
          body.dismiss ? null : Date.now() + body.minutes * 60000,
          Number(!!body.dismiss),
        );
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/calendar/events/:eventId/respond",
    route(async (req, res) => {
      const old = await eventFor(db, req.user.id, req.params.eventId);
      await exclusive(old.calendar_id, async () => {
        const current = await eventFor(db, req.user.id, old.id),
          calendar = await calendarFor(db, req.user.id, old.calendar_id, true);
        if (current.version !== req.body?.version)
          throw new CalendarError(
            "Der Termin wurde inzwischen geändert. Bitte erneut öffnen.",
            409,
          );
        const account = await db
          .prepare("SELECT * FROM accounts WHERE id=? AND user_id=?")
          .get(Number(req.body?.accountId) || 0, req.user.id);
        if (!account)
          throw new CalendarError("Absenderpostfach nicht gefunden.", 404);
        const raw = decrypt(current.ical_enc),
          details = await runCalendar("itemDetails", raw);
        const method = req.body?.method || "REPLY";
        if (!validEmail(details.organizer))
          throw new CalendarError(
            "Die Einladung hat keine gültige Organisatoradresse.",
          );
        const recipients =
          method === "REPLY"
            ? [details.organizer]
            : details.attendees.map((p) => p.email).filter(validEmail);
        if (
          method !== "REPLY" &&
          (details.organizer !== account.email.toLowerCase() ||
            !["REQUEST", "CANCEL"].includes(method))
        )
          throw new CalendarError(
            "Nur das Organisatorpostfach kann Einladungen oder Absagen versenden.",
            403,
          );
        if (!recipients.length)
          throw new CalendarError("Die Teilnehmerliste ist leer.");
        const ics = await runCalendar("invitation", raw, {
          address: account.email,
          status: req.body?.status,
          method,
        });
        const result = await sendMessage(
          account,
          {
            to: recipients.join(", "),
            subject: `${method === "CANCEL" ? "Abgesagt: " : method === "REPLY" ? "Antwort: " : "Einladung: "}${details.title}`,
            text: `${details.title}\n${details.start}\n${details.location}\n\n${details.description}`,
          },
          { method, content: ics },
        );
        const updated =
          method === "REPLY"
            ? await runCalendar("applyReply", raw, {
                address: account.email,
                status: req.body.status,
              })
            : ics;
        let syncWarning = "";
        try {
          await writeItem(db, calendar, updated, current);
        } catch {
          syncWarning =
            "Die Antwort wurde versendet, aber der Kalender konnte nicht aktualisiert werden. Bitte synchronisieren; die Antwort nicht erneut senden.";
        }
        res.json({
          ...(await getCalendarEvent(db, req.user.id, old.id)),
          sent: true,
          sentCopy: result.sentCopy,
          syncWarning,
        });
      });
    }),
  );
}
export function startCalendarSync(db) {
  let running = false;
  const sync = async () => {
    if (running) return;
    running = true;
    try {
      const due = await db
        .prepare(
          "SELECT id,user_id FROM calendars WHERE kind<>'local' AND (last_sync IS NULL OR last_sync<?)",
        )
        .all(Date.now() - 300000);
      for (const calendar of due) {
        try {
          await syncCalendar(db, calendar.user_id, calendar.id);
        } catch {}
      }
    } finally {
      running = false;
    }
  };
  setTimeout(sync, 10000).unref();
  setInterval(sync, 60000).unref();
}
