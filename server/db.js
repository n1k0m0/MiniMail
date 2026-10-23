import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { initializeMailIndex } from "./mailIndex.js";
import { initializeAiSettings } from "./ai.js";

const dataDir = path.resolve("data");
fs.mkdirSync(dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(dataDir, "minimail.sqlite"));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 10000;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    totp_secret TEXT, pending_totp_secret TEXT, created_at INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'user', must_change_password INTEGER NOT NULL DEFAULT 0,
    collect_recipients INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
    imap_host TEXT NOT NULL, imap_port INTEGER NOT NULL, imap_secure INTEGER NOT NULL,
    smtp_host TEXT NOT NULL, smtp_port INTEGER NOT NULL, smtp_secure INTEGER NOT NULL,
    username TEXT NOT NULL, password_enc TEXT NOT NULL,
    smtp_username TEXT, smtp_password_enc TEXT, created_at INTEGER NOT NULL,
    check_interval_minutes INTEGER NOT NULL DEFAULT 5,
    last_checked_at INTEGER, inbox_unseen INTEGER, inbox_uid_next INTEGER,
    check_failed INTEGER NOT NULL DEFAULT 0,
    is_primary INTEGER NOT NULL DEFAULT 0,
    vpn_profile TEXT NOT NULL DEFAULT '',
    sender_name TEXT NOT NULL DEFAULT '',
    signature TEXT NOT NULL DEFAULT '',
    pgp_private_enc TEXT,
    pgp_passphrase_enc TEXT,
    smime_cert TEXT,
    smime_key_enc TEXT,
    crypto_mode TEXT NOT NULL DEFAULT 'none',
    crypto_sign_default INTEGER NOT NULL DEFAULT 0,
    crypto_encrypt_default INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL COLLATE NOCASE,
    source TEXT NOT NULL DEFAULT 'manual', created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    pgp_public TEXT, smime_cert TEXT,
    pgp_verified INTEGER NOT NULL DEFAULT 1,
    smime_verified INTEGER NOT NULL DEFAULT 1,
    pgp_source TEXT NOT NULL DEFAULT 'manual',
    smime_source TEXT NOT NULL DEFAULT 'manual',
    UNIQUE(user_id, email), FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE INDEX IF NOT EXISTS contacts_user_name ON contacts(user_id, name);
  CREATE TABLE IF NOT EXISTS discovered_keys (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE,
    kind TEXT NOT NULL CHECK(kind IN ('pgp','smime')),
    fingerprint TEXT NOT NULL,
    material TEXT NOT NULL,
    source TEXT NOT NULL,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    seen_count INTEGER NOT NULL DEFAULT 1,
    UNIQUE(user_id,email,kind,fingerprint)
  );
  CREATE INDEX IF NOT EXISTS discovered_keys_user_email ON discovered_keys(user_id,email);
  CREATE TABLE IF NOT EXISTS key_scan_folders (
    account_id INTEGER NOT NULL,
    folder TEXT NOT NULL,
    uid_validity TEXT NOT NULL,
    last_uid INTEGER NOT NULL DEFAULT 0,
    inline_uids TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(account_id,folder)
  );
  CREATE TABLE IF NOT EXISTS ai_settings (
    id INTEGER PRIMARY KEY CHECK(id=1),
    api_key_enc TEXT,
    model TEXT NOT NULL DEFAULT '',
    base_url TEXT NOT NULL DEFAULT '',
    rewrite_max_tokens INTEGER DEFAULT 8192,
    summary_max_tokens INTEGER DEFAULT 4096
  );
`);
initializeAiSettings(db);
initializeMailIndex(db);
const userColumns = new Set(
  db
    .prepare("PRAGMA table_info(users)")
    .all()
    .map((column) => column.name),
);
if (!userColumns.has("role"))
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
if (!userColumns.has("must_change_password"))
  db.exec(
    "ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0",
  );
if (!userColumns.has("collect_recipients"))
  db.exec(
    "ALTER TABLE users ADD COLUMN collect_recipients INTEGER NOT NULL DEFAULT 1",
  );
const accountColumns = new Set(
  db
    .prepare("PRAGMA table_info(accounts)")
    .all()
    .map((column) => column.name),
);
if (!accountColumns.has("smtp_username"))
  db.exec("ALTER TABLE accounts ADD COLUMN smtp_username TEXT");
if (!accountColumns.has("smtp_password_enc"))
  db.exec("ALTER TABLE accounts ADD COLUMN smtp_password_enc TEXT");
if (!accountColumns.has("check_interval_minutes"))
  db.exec(
    "ALTER TABLE accounts ADD COLUMN check_interval_minutes INTEGER NOT NULL DEFAULT 5",
  );
if (!accountColumns.has("last_checked_at"))
  db.exec("ALTER TABLE accounts ADD COLUMN last_checked_at INTEGER");
if (!accountColumns.has("inbox_unseen"))
  db.exec("ALTER TABLE accounts ADD COLUMN inbox_unseen INTEGER");
if (!accountColumns.has("inbox_uid_next"))
  db.exec("ALTER TABLE accounts ADD COLUMN inbox_uid_next INTEGER");
if (!accountColumns.has("check_failed"))
  db.exec(
    "ALTER TABLE accounts ADD COLUMN check_failed INTEGER NOT NULL DEFAULT 0",
  );
if (!accountColumns.has("is_primary")) {
  db.exec(
    "ALTER TABLE accounts ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0",
  );
  db.exec(`
    UPDATE accounts SET is_primary=1
    WHERE id IN (SELECT MIN(id) FROM accounts GROUP BY user_id)
  `);
}
if (!accountColumns.has("vpn_profile"))
  db.exec(
    "ALTER TABLE accounts ADD COLUMN vpn_profile TEXT NOT NULL DEFAULT ''",
  );
if (!accountColumns.has("sender_name"))
  db.exec(
    "ALTER TABLE accounts ADD COLUMN sender_name TEXT NOT NULL DEFAULT ''",
  );
if (!accountColumns.has("signature"))
  db.exec("ALTER TABLE accounts ADD COLUMN signature TEXT NOT NULL DEFAULT ''");
for (const [column, definition] of Object.entries({
  pgp_private_enc: "TEXT",
  pgp_passphrase_enc: "TEXT",
  smime_cert: "TEXT",
  smime_key_enc: "TEXT",
  crypto_mode: "TEXT NOT NULL DEFAULT 'none'",
  crypto_sign_default: "INTEGER NOT NULL DEFAULT 0",
  crypto_encrypt_default: "INTEGER NOT NULL DEFAULT 0",
})) {
  if (!accountColumns.has(column))
    db.exec(`ALTER TABLE accounts ADD COLUMN ${column} ${definition}`);
}
const contactColumns = new Set(
  db
    .prepare("PRAGMA table_info(contacts)")
    .all()
    .map((column) => column.name),
);
if (!contactColumns.has("pgp_public"))
  db.exec("ALTER TABLE contacts ADD COLUMN pgp_public TEXT");
if (!contactColumns.has("smime_cert"))
  db.exec("ALTER TABLE contacts ADD COLUMN smime_cert TEXT");
for (const [column, definition] of Object.entries({
  pgp_verified: "INTEGER NOT NULL DEFAULT 1",
  smime_verified: "INTEGER NOT NULL DEFAULT 1",
  pgp_source: "TEXT NOT NULL DEFAULT 'manual'",
  smime_source: "TEXT NOT NULL DEFAULT 'manual'",
})) {
  if (!contactColumns.has(column))
    db.exec(`ALTER TABLE contacts ADD COLUMN ${column} ${definition}`);
}
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS accounts_one_primary_per_user ON accounts(user_id) WHERE is_primary=1",
);
// Existing single-user installations keep their owner as administrator.
if (
  !db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get() &&
  db.prepare("SELECT id FROM users LIMIT 1").get()
) {
  const owner = db.prepare("SELECT id FROM users ORDER BY id LIMIT 1").get();
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(owner.id);
}
db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
