import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { groupMessages, messageReferences } from "../server/threading.js";

const message = (uid, fields = {}) => ({
  uid,
  subject: "Project update",
  date: new Date(`2026-01-${String(uid).padStart(2, "0")}T12:00:00Z`),
  seen: true,
  from: [{ address: "sender@example.test" }],
  ...fields,
});

test("long reply chains cannot overflow the stack", (t) => {
  const items = Array.from({ length: 30000 }, (_, i) => ({
    uid: i + 1,
    messageId: `<${i + 1}@example.test>`,
    inReplyTo: i ? `<${i}@example.test>` : "",
    date: "2026-01-01",
    seen: i !== 0,
  }));
  const start = performance.now();
  const groups = groupMessages(items);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].thread.length, items.length);
  assert.equal(groups[0].uid, 30000);
  assert.equal(groups[0].threadUnread, true);
  assert.equal(groupMessages(items, { unreadOnly: true })[0].thread.length, 1);
  t.diagnostic(
    `Grouped 30000 linked messages in ${Math.round(performance.now() - start)} ms`,
  );
});

test("groups replies across a whole folder and displays the newest message first", () => {
  const groups = groupMessages([
    message(1, { messageId: "<root@example.test>" }),
    message(2, {
      messageId: "<reply@example.test>",
      inReplyTo: "<root@example.test>",
      seen: false,
    }),
    message(3, { messageId: "<other@example.test>" }),
    message(4, { references: ["root@example.test", "reply@example.test"] }),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].uid, 4);
  assert.deepEqual(
    groups[0].thread.map((item) => item.uid),
    [1, 2, 4],
  );
  assert.equal(groups[0].threadUnread, true);
  assert.equal(groups[1].uid, 3);
});

test("subject matches alone do not merge unrelated mail", () => {
  const groups = groupMessages([
    message(1, { messageId: "<one@example.test>" }),
    message(2, {
      messageId: "<two@example.test>",
      subject: "Re: Project update",
    }),
  ]);
  assert.equal(groups.length, 2);
});

test("unread conversations retain read bridges but display only unread members in date order", () => {
  const groups = groupMessages(
    [
      message(1, { messageId: "<root@example.test>", seen: false }),
      message(2, {
        messageId: "<bridge@example.test>",
        inReplyTo: "<root@example.test>",
      }),
      message(3, {
        messageId: "<reply@example.test>",
        inReplyTo: "<bridge@example.test>",
        seen: false,
      }),
      message(4, { messageId: "<unrelated@example.test>", seen: false }),
      message(5, { inReplyTo: "<reply@example.test>" }),
      message(6, { messageId: "<all-read@example.test>" }),
    ],
    { unreadOnly: true },
  );
  assert.deepEqual(
    groups.map((group) => group.uid),
    [4, 3],
  );
  assert.deepEqual(
    groups[1].thread.map((item) => item.uid),
    [1, 3],
  );
  assert.ok(
    groups.every(
      (group) => group.threadUnread && group.thread.every((item) => !item.seen),
    ),
  );
});

test("uses provider thread IDs and parses folded References headers", () => {
  assert.deepEqual(
    messageReferences(
      Buffer.from(
        "References: <first@example.test>\r\n <second@example.test>\r\nSubject: Example\r\n",
      ),
    ),
    ["first@example.test", "second@example.test"],
  );
  const groups = groupMessages([
    message(1, { threadId: "provider-1" }),
    message(2, { threadId: "provider-1" }),
    message(3, { threadId: "provider-2" }),
  ]);
  assert.deepEqual(
    groups.map((item) => item.thread.length),
    [1, 2],
  );
});
