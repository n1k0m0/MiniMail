import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  mailArrivals,
  notificationPreferences,
  notificationKey,
  notifyOnce,
  showNotification,
} from "../src/notifications.js";

test("mail arrivals ignore initial synchronization, read flags, errors and UID resets", () => {
  const account = (id, uid, extra = {}) => ({
    id,
    inbox_uid_next: uid,
    ...extra,
  });
  let baseline = mailArrivals(new Map(), [account(1, 500), account(2, null)]);
  assert.deepEqual(baseline.arrivals, []);
  baseline = mailArrivals(baseline.next, [
    account(1, 500, { inbox_unseen: 99 }),
    account(2, 30),
  ]);
  assert.deepEqual(baseline.arrivals, []);
  baseline = mailArrivals(baseline.next, [
    account(1, 502),
    account(2, 31, { check_failed: true }),
  ]);
  assert.deepEqual(
    baseline.arrivals.map((row) => row.id),
    [1],
  );
  baseline = mailArrivals(baseline.next, [account(1, 4), account(2, 31)]);
  assert.deepEqual(
    baseline.arrivals.map((row) => row.id),
    [2],
  );
  baseline = mailArrivals(baseline.next, [
    account(1, 5, { needsCredentials: true }),
  ]);
  assert.deepEqual(baseline.arrivals, []);
  assert.equal(baseline.next.has(2), false);
});

test("desktop notifications use distinct same-origin brand icons, preserve clicks and handle denied permission", () => {
  const originals = {
    window: globalThis.window,
    Notification: globalThis.Notification,
  };
  const created = [];
  let focused = 0,
    opened = 0;
  class NativeNotification {
    static permission = "granted";
    constructor(title, options) {
      this.title = title;
      this.options = options;
      created.push(this);
    }
    close() {
      this.closed = true;
    }
  }
  globalThis.window = {
    isSecureContext: true,
    Notification: NativeNotification,
    focus() {
      focused++;
    },
  };
  globalThis.Notification = NativeNotification;
  try {
    for (const kind of ["mail", "calendar", "brand", "toString"])
      assert.equal(
        showNotification(
          "MiniMail",
          { body: "Synthetic", tag: kind },
          () => {
            opened++;
          },
          kind,
        ),
        true,
      );
    assert.deepEqual(
      created.map((value) => value.options.icon),
      [
        "/notifications/mail.png",
        "/notifications/calendar.png",
        "/notifications/brand.png",
        "/notifications/brand.png",
      ],
    );
    created[0].onclick();
    assert.equal(focused, 1);
    assert.equal(opened, 1);
    assert.equal(created[0].closed, true);
    assert.equal(created[0].options.body, "Synthetic");
    assert.equal(created[0].options.tag, "mail");
    NativeNotification.permission = "denied";
    assert.equal(showNotification("MiniMail", {}, undefined, "mail"), false);
    assert.equal(created.length, 4);
    for (const kind of ["brand", "mail", "calendar"]) {
      const png = fs.readFileSync(
        new URL(`../public/notifications/${kind}.png`, import.meta.url),
      );
      assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      assert.equal(png.readUInt32BE(16), 256);
      assert.equal(png.readUInt32BE(20), 256);
      assert.ok(png.length < 50000);
    }
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

test("notification preferences default off, isolate users and reject malformed values", () => {
  const values = new Map([
    [notificationKey("one"), '{"mail":true,"calendar":"yes"}'],
  ]);
  const storage = { getItem: (key) => values.get(key) };
  assert.deepEqual(notificationPreferences("one", storage), {
    mail: true,
    calendar: false,
  });
  assert.deepEqual(notificationPreferences("two", storage), {
    mail: false,
    calendar: false,
  });
  assert.deepEqual(
    notificationPreferences("one", {
      getItem() {
        throw Error("blocked");
      },
    }),
    { mail: false, calendar: false },
  );
});

test("notification claims suppress repeats across tabs while snoozed occurrences and users stay independent", async () => {
  const values = new Map();
  const old = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  };
  let shown = 0;
  const notify = () => {
    shown++;
    return true;
  };
  try {
    await notifyOnce("one", "calendar", "event:0", notify);
    await notifyOnce("one", "calendar", "event:0", notify);
    await notifyOnce("one", "calendar", "event:10", notify);
    await notifyOnce("two", "calendar", "event:0", notify);
    assert.equal(shown, 3);
    await notifyOnce("one", "mail", "retry", () => false);
    await notifyOnce("one", "mail", "retry", notify);
    assert.equal(shown, 4);
  } finally {
    if (old === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = old;
  }
});
