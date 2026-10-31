import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { encrypt } from "../server/security.js";
import { indexedThreadPage, updateIndexedFlags } from "../server/mailIndex.js";

test("large folders hydrate only visible conversation members after grouping", async (t) => {
  const rows = new Map();
  for (let uid = 1; uid <= 4000; uid++)
    rows.set(
      uid,
      encrypt(
        JSON.stringify({
          uid,
          subject: `Message ${uid}`,
          date: new Date(1700000000000 + uid * 60000).toISOString(),
          seen: (uid - 1) % 4 !== 0,
          flagged: false,
          messageId: `<${uid}@example.test>`,
          threadId: `thread-${Math.floor((uid - 1) / 5)}`,
        }),
      ),
    );
  let fullReads = 0;
  let hydrated = 0;
  const database = {
    prepare(sql) {
      if (
        sql.startsWith(
          "SELECT data_enc FROM mail_index_messages WHERE account_id=? AND folder=? AND uid=?",
        )
      )
        return {
          get: async (_account, _folder, uid) => ({ data_enc: rows.get(uid) }),
        };
      if (sql.startsWith("SELECT data_enc FROM mail_index_messages"))
        return {
          all: async () => {
            fullReads++;
            return [...rows.values()].map((data_enc) => ({ data_enc }));
          },
        };
      if (sql.startsWith("SELECT uid,data_enc FROM mail_index_messages"))
        return {
          all: async (_account, _folder, ...uids) => {
            hydrated += uids.length;
            return uids.map((uid) => ({ uid, data_enc: rows.get(uid) }));
          },
        };
      if (sql.startsWith("UPDATE mail_index_messages SET data_enc="))
        return {
          run: async (data_enc, _account, _folder, uid) =>
            rows.set(uid, data_enc),
        };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const started = performance.now();
  const first = await indexedThreadPage(database, 1, "INBOX", {
    page: 0,
    pageSize: 60,
  });
  const second = await indexedThreadPage(database, 1, "INBOX", {
    page: 1,
    pageSize: 60,
  });
  t.diagnostic(
    `4000 messages, two pages: ${Math.round(performance.now() - started)} ms`,
  );
  assert.equal(first.total, 800);
  assert.equal(first.messages.length, 60);
  assert.equal(first.messages[0].thread.length, 5);
  assert.equal(second.messages.length, 60);
  assert.equal(fullReads, 1);
  assert.equal(hydrated, 600);
  const searched = await indexedThreadPage(database, 1, "INBOX", {
    page: 0,
    pageSize: 60,
    matches: [1, 2, 4000],
  });
  assert.equal(searched.total, 2);
  const unread = await indexedThreadPage(database, 1, "INBOX", {
    page: 0,
    pageSize: 60,
    matches: [1, 4000],
    unreadOnly: true,
  });
  assert.equal(unread.total, 1);
  assert.deepEqual(
    unread.messages[0].thread.map((item) => item.uid),
    [1, 5],
  );
  await updateIndexedFlags(database, 1, "INBOX", 1, { seen: true });
  const refreshed = await indexedThreadPage(database, 1, "INBOX", {
    page: 0,
    pageSize: 60,
    unreadOnly: true,
  });
  assert.equal(refreshed.messageTotal, 999);
  assert.equal(fullReads, 2);
});
