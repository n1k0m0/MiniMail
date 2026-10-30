import test from "node:test";
import assert from "node:assert/strict";
import {
  mailArrivals,
  notificationPreferences,
  notificationKey,
  notifyOnce,
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
