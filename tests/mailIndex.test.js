import assert from "node:assert/strict";
import { testDatabase } from "./mysqlTestHelper.js";
import test from "node:test";
import {
  indexedMessages,
  syncThreadIndex,
  updateIndexedFlags,
} from "../server/mailIndex.js";
function fakeClient(messages) {
  const client = {
    messages,
    calls: [],
    enabled: new Set(["CONDSTORE"]),
    mailbox: {
      uidValidity: 1n,
      uidNext: 3,
      exists: messages.length,
      highestModseq: 2n,
    },
    async search() {
      this.calls.push("search");
      return this.messages.map((item) => item.uid);
    },
    async *fetch(range, query, options) {
      this.calls.push({
        range,
        query,
        options,
      });
      const selected = Array.isArray(range)
        ? this.messages.filter((item) => range.includes(item.uid))
        : this.messages;
      for (const item of selected) {
        if (options.changedSince && item.modseq <= options.changedSince)
          continue;
        yield {
          uid: item.uid,
          envelope: {
            messageId: `<${item.uid}@example.test>`,
          },
          flags: new Set(item.seen ? ["\\Seen"] : []),
          internalDate: new Date("2026-10-21T12:00:00Z"),
          headers: Buffer.from("References: <root@example.test>\r\n"),
          modseq: item.modseq,
        };
      }
    },
  };
  return client;
}
const summarize = (item) => ({
  uid: item.uid,
  subject: `Message ${item.uid}`,
  date: item.internalDate,
  seen: item.flags.has("\\Seen"),
  flagged: false,
});
test("thread index fetches headers once, then only new mail and changed flags", async (t) => {
  const database = await testDatabase(t);
  const client = fakeClient([
    {
      uid: 1,
      seen: false,
      modseq: 1n,
    },
    {
      uid: 2,
      seen: true,
      modseq: 2n,
    },
  ]);
  await syncThreadIndex(database, 1, "INBOX", client, summarize);
  assert.equal(
    client.calls.filter((call) => typeof call === "object").length,
    1,
  );
  assert.deepEqual(
    (await indexedMessages(database, 1, "INBOX")).map((item) => item.uid),
    [1, 2],
  );
  assert.doesNotMatch(
    (
      await database
        .prepare("SELECT data_enc FROM mail_index_messages LIMIT 1")
        .get()
    ).data_enc,
    /Message 1/,
  );
  client.calls = [];
  await syncThreadIndex(database, 1, "INBOX", client, summarize);
  assert.deepEqual(client.calls, []);
  client.messages[0].seen = true;
  client.messages[0].modseq = 3n;
  client.mailbox.highestModseq = 3n;
  client.calls = [];
  await syncThreadIndex(database, 1, "INBOX", client, summarize);
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].options.changedSince, 2n);
  assert.equal((await indexedMessages(database, 1, "INBOX"))[0].seen, true);
  client.messages.push({
    uid: 3,
    seen: false,
    modseq: 4n,
  });
  client.mailbox.uidNext = 4;
  client.mailbox.exists = 3;
  client.mailbox.highestModseq = 4n;
  client.calls = [];
  await syncThreadIndex(database, 1, "INBOX", client, summarize);
  assert.equal(client.calls[0], "search");
  assert.ok(client.calls.some((call) => Array.isArray(call.range)));
  assert.equal((await indexedMessages(database, 1, "INBOX")).length, 3);
  await updateIndexedFlags(database, 1, "INBOX", 3, {
    seen: true,
  });
  assert.equal((await indexedMessages(database, 1, "INBOX"))[2].seen, true);
  await database.close();
});
test("servers without CONDSTORE refresh external flags during reconciliation", async (t) => {
  const database = await testDatabase(t);
  const client = fakeClient([
    {
      uid: 1,
      seen: false,
      modseq: 1n,
    },
  ]);
  client.enabled.clear();
  client.mailbox.uidNext = 2;
  client.mailbox.highestModseq = undefined;
  await syncThreadIndex(database, 3, "INBOX", client, summarize);
  client.messages[0].seen = true;
  await database
    .prepare(
      "UPDATE mail_index_folders SET reconciled_at=0 WHERE account_id=? AND folder=?",
    )
    .run(3, "INBOX");
  client.calls = [];
  await syncThreadIndex(database, 3, "INBOX", client, summarize);
  assert.ok(client.calls.some((call) => call.query?.flags));
  assert.equal((await indexedMessages(database, 3, "INBOX"))[0].seen, true);
  await database.close();
});
test("thread index drops expunged messages and resets on UID validity change", async (t) => {
  const database = await testDatabase(t);
  const client = fakeClient([
    {
      uid: 1,
      seen: false,
      modseq: 1n,
    },
    {
      uid: 2,
      seen: false,
      modseq: 2n,
    },
  ]);
  await syncThreadIndex(database, 2, "INBOX", client, summarize);
  client.messages.shift();
  client.mailbox.exists = 1;
  await syncThreadIndex(database, 2, "INBOX", client, summarize);
  assert.deepEqual(
    (await indexedMessages(database, 2, "INBOX")).map((item) => item.uid),
    [2],
  );
  client.messages = [
    {
      uid: 1,
      seen: true,
      modseq: 1n,
    },
  ];
  client.mailbox.uidValidity = 2n;
  client.mailbox.uidNext = 2;
  client.mailbox.highestModseq = 1n;
  await syncThreadIndex(database, 2, "INBOX", client, summarize);
  assert.deepEqual(
    (await indexedMessages(database, 2, "INBOX")).map((item) => [
      item.uid,
      item.seen,
    ]),
    [[1, true]],
  );
  await database.close();
});
