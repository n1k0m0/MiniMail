import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase, insertTestUser } from "./mysqlTestHelper.js";
import { runMigrations, migrationStatus } from "../server/migrations.js";
import { encrypt, decrypt } from "../server/security.js";

test("versioned migrations adopt the existing schema without rewriting encrypted data or configuration", async (t) => {
  const db = await testDatabase(t);
  await insertTestUser(db);
  const value = encrypt(
    JSON.stringify({
      text: "Private draft Ä",
      attachments: [{ name: "binary.bin", data: "AP8=" }],
    }),
  );
  await db
    .prepare(
      "INSERT INTO drafts(user_id,id,data_enc,updated_at) VALUES (1,'existing',?,1)",
    )
    .run(value);
  assert.deepEqual(await migrationStatus(db), {
    schema: 1,
    dirty: false,
    legacy: true,
  });
  await Promise.all([runMigrations(db), runMigrations(db)]);
  const record = await db
    .prepare("SELECT * FROM schema_migrations WHERE version=1")
    .get();
  assert.equal(record.status, "applied");
  await runMigrations(db);
  assert.deepEqual(
    await db.prepare("SELECT * FROM schema_migrations WHERE version=1").get(),
    record,
  );
  const stored = await db
    .prepare("SELECT data_enc FROM drafts WHERE id='existing'")
    .get();
  assert.equal(stored.data_enc, value);
  assert.equal(
    JSON.parse(decrypt(stored.data_enc)).attachments[0].data,
    "AP8=",
  );
});
test("interrupted idempotent migrations resume and changed/unknown migration history fails closed", async (t) => {
  const db = await testDatabase(t);
  await insertTestUser(db);
  let calls = 0;
  const broken = {
    ...db,
    exec: async (sql) => {
      if (sql.includes("CREATE TABLE IF NOT EXISTS accounts") && ++calls === 1)
        throw new Error("Synthetic process failure");
      return db.exec(sql);
    },
  };
  await assert.rejects(runMigrations(broken), /Synthetic process failure/);
  assert.equal((await migrationStatus(db)).dirty, true);
  await runMigrations(db);
  assert.equal((await migrationStatus(db)).dirty, false);
  const baseline = await db
    .prepare("SELECT checksum FROM schema_migrations WHERE version=1")
    .get();
  await db
    .prepare("UPDATE schema_migrations SET checksum=? WHERE version=1")
    .run("0".repeat(64));
  await assert.rejects(runMigrations(db), /checksum/);
  await db
    .prepare("UPDATE schema_migrations SET checksum=? WHERE version=1")
    .run(baseline.checksum);
  await db
    .prepare("INSERT INTO schema_migrations VALUES (3,?,'applied',1,1)")
    .run("a".repeat(64));
  await assert.rejects(runMigrations(db), /newer/);
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM users").get()).n,
    1,
  );
});

test("the compatibility reader preserves an additive future schema without rewriting its data", async (t) => {
  const db = await testDatabase(t);
  await insertTestUser(db);
  await runMigrations(db);
  await db.exec(
    "ALTER TABLE accounts ADD COLUMN mail_rules_enc MEDIUMTEXT NULL",
  );
  await db
    .prepare("INSERT INTO schema_migrations VALUES(2,?,'applied',1,1)")
    .run("b".repeat(64));
  await runMigrations(db);
  assert.equal((await migrationStatus(db)).schema, 2);
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM users").get()).n,
    1,
  );
});
