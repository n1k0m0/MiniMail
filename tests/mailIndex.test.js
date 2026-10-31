import assert from "node:assert/strict";
import { testDatabase } from "./mysqlTestHelper.js";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { encrypt } from "../server/security.js";
import {
  indexedMessages,
  indexedThreadPage,
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

test("large thread pages reuse grouping and decrypt only visible members", async (t) => {
  const database = await testDatabase(t);
  const count = 4000;
  for (let start = 0; start < count; start += 200) {
    const rows = Array.from({ length: 200 }, (_, offset) => {
      const uid = start + offset + 1;
      return [
        1,
        "LARGE",
        uid,
        encrypt(
          JSON.stringify({
            uid,
            subject: `Message ${uid}`,
            date: new Date(1700000000000 + uid * 60000).toISOString(),
            seen: (uid - 1) % 4 !== 0,
            flagged: false,
            messageId: `<${uid}@example.test>`,
            inReplyTo: "",
            references: [],
            threadId: `thread-${Math.floor((uid - 1) / 5)}`,
          }),
        ),
      ];
    });
    await database
      .prepare(
        `INSERT INTO mail_index_messages (account_id,folder,uid,data_enc) VALUES ${rows.map(() => "(?,?,?,?)").join(",")}`,
      )
      .run(...rows.flat());
  }
  let fullReads = 0;
  let pageReads = 0;
  const counted = {
    ...database,
    prepare(sql) {
      if (
        sql ===
        "SELECT data_enc FROM mail_index_messages WHERE account_id=? AND folder=?"
      )
        fullReads++;
      if (sql.startsWith("SELECT uid,data_enc FROM mail_index_messages"))
        pageReads++;
      return database.prepare(sql);
    },
  };
  const start = performance.now();
  const first = await indexedThreadPage(counted, 1, "LARGE", {
    page: 0,
    pageSize: 60,
  });
  const second = await indexedThreadPage(counted, 1, "LARGE", {
    page: 1,
    pageSize: 60,
  });
  t.diagnostic(
    `Two pages from ${count} indexed messages: ${Math.round(performance.now() - start)} ms`,
  );
  assert.equal(first.total, 800);
  assert.equal(first.messageTotal, count);
  assert.equal(first.messages.length, 60);
  assert.equal(first.messages[0].thread.length, 5);
  assert.equal(second.messages.length, 60);
  assert.equal(fullReads, 1);
  assert.equal(pageReads, 4);
  const searched = await indexedThreadPage(counted, 1, "LARGE", {
    page: 0,
    pageSize: 60,
    matches: [1, 2, 4000],
  });
  assert.equal(searched.total, 2);
  assert.equal(searched.messageTotal, 3);
  const unreadSearch = await indexedThreadPage(counted, 1, "LARGE", {
    page: 0,
    pageSize: 60,
    matches: [1, 4000],
    unreadOnly: true,
  });
  assert.equal(unreadSearch.total, 1);
  assert.deepEqual(
    unreadSearch.messages[0].thread.map((item) => item.uid),
    [1, 5],
  );
  await updateIndexedFlags(counted, 1, "LARGE", 1, { seen: true });
  const refreshed = await indexedThreadPage(counted, 1, "LARGE", {
    page: 0,
    pageSize: 60,
    unreadOnly: true,
  });
  assert.equal(refreshed.messageTotal, 999);
  assert.equal(fullReads, 2);
  await database.close();
});

test("initial index streams bounded batches and retries an interrupted reset", async (t) => {
  const database = await testDatabase(t);
  const client = fakeClient(
    Array.from({ length: 450 }, (_, index) => ({
      uid: index + 1,
      seen: false,
      modseq: 1n,
    })),
  );
  client.mailbox.uidNext = 451;
  let inserts = 0;
  const interrupted = {
    ...database,
    prepare(sql) {
      const prepared = database.prepare(sql);
      if (!sql.startsWith("INSERT INTO mail_index_messages")) return prepared;
      return {
        ...prepared,
        async run(...values) {
          if (++inserts === 2) throw new Error("Synthetic fetch interruption");
          return prepared.run(...values);
        },
      };
    },
  };
  await assert.rejects(
    syncThreadIndex(interrupted, 8, "INBOX", client, summarize),
    /Synthetic fetch interruption/,
  );
  assert.equal((await indexedMessages(database, 8, "INBOX")).length, 200);
  assert.equal(
    await database
      .prepare(
        "SELECT * FROM mail_index_folders WHERE account_id=? AND folder=?",
      )
      .get(8, "INBOX"),
    undefined,
  );
  await syncThreadIndex(database, 8, "INBOX", client, summarize);
  assert.equal((await indexedMessages(database, 8, "INBOX")).length, 450);
  await database.close();
});
