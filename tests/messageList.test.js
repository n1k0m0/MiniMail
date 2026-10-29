import test from "node:test";
import assert from "node:assert/strict";
import { listMessagePage } from "../server/messageList.js";

const summarize = ({ uid, flags }) => ({ uid, seen: flags.has("\\Seen") });

test("unread filtering counts and paginates the complete folder before fetching messages", async () => {
  const messages = Array.from({ length: 130 }, (_, i) => ({
    uid: i + 1,
    flags: new Set(i % 2 ? [] : ["\\Seen"]),
  }));
  const client = {
    async search(criteria, options) {
      assert.equal(options.uid, true);
      return messages
        .filter((item) => criteria.seen !== false || !item.flags.has("\\Seen"))
        .map((item) => item.uid);
    },
    async fetchAll(uids) {
      return messages.filter((item) => uids.includes(item.uid));
    },
  };
  const all = await listMessagePage(client, summarize);
  assert.equal(all.total, 130);
  assert.ok(all.messages.some((item) => item.seen));
  const first = await listMessagePage(client, summarize, { unreadOnly: true });
  const second = await listMessagePage(client, summarize, {
    unreadOnly: true,
    page: 1,
  });
  assert.equal(first.total, 65);
  assert.equal(first.messages.length, 60);
  assert.ok(first.messages.every((item) => !item.seen));
  assert.deepEqual(
    second.messages.map((item) => item.uid),
    [10, 8, 6, 4, 2],
  );
});

test("unread search combines the text query with UNSEEN and skips empty fetches", async () => {
  const client = {
    async search(criteria) {
      assert.equal(criteria.seen, false);
      assert.deepEqual(criteria.or, [
        { subject: "meeting" },
        { from: "meeting" },
        { to: "meeting" },
        { body: "meeting" },
      ]);
      return false;
    },
    async fetchAll() {
      assert.fail("empty results must not fetch mail");
    },
  };
  assert.deepEqual(
    await listMessagePage(client, summarize, {
      query: "meeting",
      unreadOnly: true,
    }),
    { messages: [], total: 0, page: 0 },
  );
});
