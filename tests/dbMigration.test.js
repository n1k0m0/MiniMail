import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const dbModule = fileURLToPath(new URL("../server/db.js", import.meta.url));

test("existing mailboxes get one primary mailbox per user", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "minimail-migration-"));
  await fs.mkdir(path.join(cwd, "data"));
  const databasePath = path.join(cwd, "data", "minimail.sqlite");
  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL);
    CREATE TABLE accounts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL);
    INSERT INTO users (id,role) VALUES (1,'admin'),(2,'user');
    INSERT INTO accounts (id,user_id) VALUES (10,1),(11,1),(20,2);
  `);
  db.close();

  execFileSync(process.execPath, [dbModule], { cwd, stdio: "pipe" });

  const migrated = new DatabaseSync(databasePath);
  assert.deepEqual(
    migrated
      .prepare(
        "SELECT id,user_id,is_primary,vpn_profile,sender_name,signature FROM accounts ORDER BY id",
      )
      .all()
      .map((row) => ({ ...row })),
    [
      {
        id: 10,
        user_id: 1,
        is_primary: 1,
        vpn_profile: "",
        sender_name: "",
        signature: "",
      },
      {
        id: 11,
        user_id: 1,
        is_primary: 0,
        vpn_profile: "",
        sender_name: "",
        signature: "",
      },
      {
        id: 20,
        user_id: 2,
        is_primary: 1,
        vpn_profile: "",
        sender_name: "",
        signature: "",
      },
    ],
  );
  const accountColumns = new Set(
    migrated
      .prepare("PRAGMA table_info(accounts)")
      .all()
      .map((item) => item.name),
  );
  for (const column of [
    "pgp_private_enc",
    "pgp_passphrase_enc",
    "smime_cert",
    "smime_key_enc",
    "crypto_mode",
    "crypto_sign_default",
    "crypto_encrypt_default",
  ])
    assert.ok(accountColumns.has(column), column);
  assert.deepEqual(
    {
      ...migrated
        .prepare(
          "SELECT crypto_mode,crypto_sign_default,crypto_encrypt_default FROM accounts WHERE id=10",
        )
        .get(),
    },
    { crypto_mode: "none", crypto_sign_default: 0, crypto_encrypt_default: 0 },
  );
  const contactColumns = new Set(
    migrated
      .prepare("PRAGMA table_info(contacts)")
      .all()
      .map((item) => item.name),
  );
  assert.ok(contactColumns.has("pgp_public"));
  assert.ok(contactColumns.has("smime_cert"));
  for (const column of [
    "pgp_verified",
    "smime_verified",
    "pgp_source",
    "smime_source",
  ])
    assert.ok(contactColumns.has(column), column);
  assert.ok(
    migrated
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='discovered_keys'",
      )
      .get(),
  );
  assert.ok(
    migrated
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='key_scan_folders'",
      )
      .get(),
  );
  migrated.close();
});
