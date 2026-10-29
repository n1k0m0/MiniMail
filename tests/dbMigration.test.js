import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { testDatabase } from "./mysqlTestHelper.js";
import { importSqlite } from "../server/sqliteImport.js";
import { encrypt, decrypt } from "../server/security.js";
import { aiSettings } from "../server/ai.js";

async function fixture(t, { legacy = false, unknownColumn = false } = {}) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "minimail-sqlite-import-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, "source.sqlite");
  const source = new DatabaseSync(filename);
  source.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL, password_hash TEXT NOT NULL, totp_secret TEXT, pending_totp_secret TEXT, created_at INTEGER NOT NULL ${legacy ? "" : ",role TEXT NOT NULL DEFAULT 'user',must_change_password INTEGER DEFAULT 0,collect_recipients INTEGER DEFAULT 1"});
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER, expires_at INTEGER);
    CREATE TABLE accounts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, imap_host TEXT NOT NULL, imap_port INTEGER, imap_secure INTEGER, smtp_host TEXT NOT NULL, smtp_port INTEGER, smtp_secure INTEGER, username TEXT NOT NULL, password_enc TEXT NOT NULL, created_at INTEGER NOT NULL ${legacy ? "" : ",is_primary INTEGER DEFAULT 0,vpn_profile TEXT DEFAULT '',sender_name TEXT DEFAULT '',signature TEXT DEFAULT '',pgp_private_enc TEXT,smime_key_enc TEXT"});
    CREATE TABLE contacts (id INTEGER PRIMARY KEY,user_id INTEGER,name TEXT,email TEXT,created_at INTEGER,updated_at INTEGER,pgp_public TEXT,smime_cert TEXT);
    CREATE TABLE discovered_keys (id INTEGER PRIMARY KEY,user_id INTEGER,email TEXT,kind TEXT,fingerprint TEXT,material TEXT,source TEXT,first_seen_at INTEGER,last_seen_at INTEGER,seen_count INTEGER);
    CREATE TABLE key_scan_folders (account_id INTEGER,folder TEXT,uid_validity TEXT,last_uid INTEGER,inline_uids TEXT,updated_at INTEGER,PRIMARY KEY(account_id,folder));
    CREATE TABLE ai_settings (id INTEGER PRIMARY KEY,api_key_enc TEXT,model TEXT ${legacy ? "" : ",base_url TEXT,rewrite_max_tokens INTEGER,summary_max_tokens INTEGER"});
    CREATE TABLE mail_index_folders (account_id INTEGER,folder TEXT,uid_validity TEXT,uid_next INTEGER,exists_count INTEGER,highest_modseq TEXT,reconciled_at INTEGER,PRIMARY KEY(account_id,folder));
    CREATE TABLE mail_index_messages (account_id INTEGER,folder TEXT,uid INTEGER,data_enc TEXT,PRIMARY KEY(account_id,folder,uid));
    CREATE TABLE drafts (user_id INTEGER,id TEXT,data_enc TEXT,updated_at INTEGER ${unknownColumn ? ",unexpected TEXT" : ""},PRIMARY KEY(user_id,id));
  `);
  source
    .prepare(
      "INSERT INTO users (id,username,password_hash,totp_secret,created_at) VALUES (7,'synthetic-owner','unchanged-hash',?,?)",
    )
    .run(encrypt("synthetic-totp"), 1790000000000);
  source
    .prepare("INSERT INTO sessions VALUES ('synthetic-token',7,?)")
    .run(1890000000000);
  const account = source.prepare(
    "INSERT INTO accounts (id,user_id,name,email,imap_host,imap_port,imap_secure,smtp_host,smtp_port,smtp_secure,username,password_enc,created_at) VALUES (?,7,?,'owner@example.test','imap.example.test',993,1,'smtp.example.test',587,0,'owner',?,1790000000000)",
  );
  for (const id of [10, 11])
    account.run(id, "Büro 😀", encrypt("synthetic-password"));
  if (!legacy)
    source.exec(
      "UPDATE accounts SET is_primary=1 WHERE id=10; UPDATE users SET role='admin'",
    );
  source
    .prepare(
      "INSERT INTO contacts VALUES (57,7,?,'friend@example.test',1,2,'public-key','certificate')",
    )
    .run("Änne");
  source.exec(
    "INSERT INTO discovered_keys VALUES (4,7,'friend@example.test','pgp','ABC123','public-key','autocrypt',1,2,3)",
  );
  source
    .prepare(
      "INSERT INTO key_scan_folders VALUES (10,?,'123',42,'[12,42]',1790000000000)",
    )
    .run("INBOX/Öffentlich");
  if (legacy)
    source
      .prepare("INSERT INTO ai_settings VALUES (1,?,'old-commercial-model')")
      .run(encrypt("discard-this-key"));
  else
    source
      .prepare(
        "INSERT INTO ai_settings VALUES (1,?,'local','https://ai.example.test/v1',NULL,4096)",
      )
      .run(encrypt("synthetic-ai-key"));
  source
    .prepare(
      "INSERT INTO mail_index_folders VALUES (10,?,'123',43,1,'18446744073709551615',1790000000000)",
    )
    .run("INBOX/Öffentlich");
  source
    .prepare("INSERT INTO mail_index_messages VALUES (10,?,42,?)")
    .run(
      "INBOX/Öffentlich",
      encrypt(JSON.stringify({ subject: "Privat 😀", uid: 42 })),
    );
  source
    .prepare(
      "INSERT INTO drafts (user_id,id,data_enc,updated_at) VALUES (7,'synthetic-draft',?,1790000000000)",
    )
    .run(
      encrypt(
        JSON.stringify({ subject: "Entwurf", text: "x".repeat(1024 * 1024) }),
      ),
    );
  // Real online backups retain WAL mode even without a surviving WAL file.
  source.exec("PRAGMA journal_mode=WAL");
  source.close();
  await fs.chmod(filename, 0o400);
  return filename;
}

test("SQLite import verifies all tables, ciphertext, Unicode, IDs and defaults in MySQL", async (t) => {
  const db = await testDatabase(t);
  const filename = await fixture(t);
  const report = await importSqlite(db, filename);
  assert.equal(report.length, 10);
  assert.ok(report.every((entry) => entry.verified && entry.rows > 0));
  assert.equal(
    decrypt(
      (await db.prepare("SELECT password_enc FROM accounts WHERE id=10").get())
        .password_enc,
    ),
    "synthetic-password",
  );
  assert.equal(
    (await db.prepare("SELECT name FROM accounts WHERE id=10").get()).name,
    "Büro 😀",
  );
  assert.equal(
    decrypt(
      (await db.prepare("SELECT api_key_enc FROM ai_settings WHERE id=1").get())
        .api_key_enc,
    ),
    "synthetic-ai-key",
  );
  assert.equal((await aiSettings(db)).rewriteMaxTokens, null);
  assert.equal(
    (await db.prepare("SELECT highest_modseq FROM mail_index_folders").get())
      .highest_modseq,
    "18446744073709551615",
  );
  assert.equal(
    (await db.prepare("SELECT metadata_enc FROM drafts").get()).metadata_enc,
    null,
  );
  assert.equal(
    (
      await db
        .prepare(
          "INSERT INTO contacts (user_id,name,email,created_at,updated_at) VALUES (7,'New','new@example.test',1,1)",
        )
        .run()
    ).insertId,
    58,
  );
  await db.prepare("DELETE FROM contacts WHERE id=58").run();
  await importSqlite(db, filename, { verifyOnly: true });
  await assert.rejects(importSqlite(db, filename), /must be empty/);
  await db.prepare("UPDATE contacts SET name='Changed' WHERE id=57").run();
  await assert.rejects(
    importSqlite(db, filename, { verifyOnly: true }),
    /Content verification failed/,
  );
});

test("older SQLite installations get primary mailboxes, admin role and safe AI defaults", async (t) => {
  const db = await testDatabase(t);
  await importSqlite(db, await fixture(t, { legacy: true }));
  assert.deepEqual(
    (
      await db.prepare("SELECT id,is_primary FROM accounts ORDER BY id").all()
    ).map((row) => ({ ...row })),
    [
      { id: 10, is_primary: 1 },
      { id: 11, is_primary: 0 },
    ],
  );
  assert.equal(
    (await db.prepare("SELECT role FROM users WHERE id=7").get()).role,
    "admin",
  );
  assert.deepEqual(await aiSettings(db), {
    configured: false,
    baseUrl: "",
    model: "",
    hasKey: false,
    rewriteMaxTokens: 8192,
    summaryMaxTokens: 4096,
  });
});

test("a late import error rolls back every table and preserves the source", async (t) => {
  const db = await testDatabase(t);
  const filename = await fixture(t, { unknownColumn: true });
  const before = await fs.readFile(filename);
  await assert.rejects(importSqlite(db, filename), /Unrecognized columns/);
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM users").get()).n,
    0,
  );
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM mail_index_messages").get()).n,
    0,
  );
  assert.deepEqual(await fs.readFile(filename), before);
});
