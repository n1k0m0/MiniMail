import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve("data");
fs.mkdirSync(dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(dataDir, "minimail.sqlite"));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    totp_secret TEXT, pending_totp_secret TEXT, created_at INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'user', must_change_password INTEGER NOT NULL DEFAULT 0
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
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);
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
