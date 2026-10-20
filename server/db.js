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
  db.prepare("PRAGMA table_info(accounts)").all().map((column) => column.name),
);
if (!accountColumns.has("smtp_username"))
  db.exec("ALTER TABLE accounts ADD COLUMN smtp_username TEXT");
if (!accountColumns.has("smtp_password_enc"))
  db.exec("ALTER TABLE accounts ADD COLUMN smtp_password_enc TEXT");
// Existing single-user installations keep their owner as administrator.
if (
  !db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get() &&
  db.prepare("SELECT id FROM users LIMIT 1").get()
) {
  const owner = db.prepare("SELECT id FROM users ORDER BY id LIMIT 1").get();
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(owner.id);
}
db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
