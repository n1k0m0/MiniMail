import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase, insertTestUser } from "./mysqlTestHelper.js";
import { databaseOptions } from "../server/database.js";

test("MySQL configuration rejects missing passwords and invalid identifiers", () => {
  assert.throws(() => databaseOptions({}), /MYSQL_PASSWORD/);
  assert.throws(
    () =>
      databaseOptions({ MYSQL_PASSWORD: "test", MYSQL_DATABASE: "name;DROP" }),
    /MYSQL_DATABASE/,
  );
  assert.throws(
    () => databaseOptions({ MYSQL_PASSWORD: "test", MYSQL_PORT: "NaN" }),
    /MYSQL_PORT/,
  );
});

test("MySQL transaction rollback and concurrent requests use separate connections", async (t) => {
  const db = await testDatabase(t);
  await insertTestUser(db);
  let started;
  const pending = new Promise((resolve) => {
    started = resolve;
  });
  const rollback = db.transaction(async () => {
    await db
      .prepare("UPDATE users SET username='uncommitted' WHERE id=1")
      .run();
    started();
    await new Promise((resolve) => setTimeout(resolve, 100));
    throw new Error("synthetic rollback");
  });
  const rejection = assert.rejects(rollback, /synthetic rollback/);
  await pending;
  assert.equal(
    (await db.prepare("SELECT username FROM users WHERE id=1").get()).username,
    "test-user-1",
  );
  await insertTestUser(db, 2);
  await rejection;
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM users").get()).n,
    2,
  );
  assert.equal(
    (await db.prepare("SELECT username FROM users WHERE id=1").get()).username,
    "test-user-1",
  );
  await db.transaction(async () => {
    await db.transaction(async () =>
      db.prepare("UPDATE users SET collect_recipients=0 WHERE id=1").run(),
    );
  });
  assert.equal(
    (await db.prepare("SELECT collect_recipients FROM users WHERE id=1").get())
      .collect_recipients,
    0,
  );
});

test("MySQL preserves case-sensitive folders and enforces case-insensitive contact uniqueness", async (t) => {
  const db = await testDatabase(t);
  await insertTestUser(db);
  const add = db.prepare(
    "INSERT INTO contacts (user_id,email,created_at,updated_at) VALUES (1,?,1,1)",
  );
  await add.run("Alice@example.test");
  await assert.rejects(add.run("alice@example.test"), { code: "ER_DUP_ENTRY" });
  await add.run("álice@example.test");
  const folder = db.prepare(
    "INSERT INTO mail_index_messages (account_id,folder,uid,data_enc) VALUES (1,?,1,'test')",
  );
  await folder.run("Inbox");
  await folder.run("inbox");
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM mail_index_messages").get()).n,
    2,
  );
  const injection = "value'); DROP TABLE users; --";
  await db.prepare("UPDATE contacts SET name=? WHERE id=1").run(injection);
  assert.equal(
    (await db.prepare("SELECT name FROM contacts WHERE id=1").get()).name,
    injection,
  );
});
