import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { tableNames } from "./schema.js";

const primaryKeys = {
  users: ["id"],
  sessions: ["token_hash"],
  accounts: ["id"],
  contacts: ["id"],
  discovered_keys: ["id"],
  key_scan_folders: ["account_id", "folder"],
  ai_settings: ["id"],
  mail_index_folders: ["account_id", "folder"],
  mail_index_messages: ["account_id", "folder", "uid"],
  drafts: ["user_id", "id"],
};
const quoted = (name) => `\`${name}\``;

function copySnapshot(filename, destination) {
  const files = [filename, `${filename}-wal`];
  const state = () =>
    files.map((file) => {
      try {
        const stat = fs.statSync(file, { bigint: true });
        return `${stat.ino}:${stat.size}:${stat.mtimeNs}`;
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    });
  const before = state();
  fs.copyFileSync(filename, destination);
  fs.chmodSync(destination, 0o600);
  if (before[1] !== null) {
    fs.copyFileSync(`${filename}-wal`, `${destination}-wal`);
    fs.chmodSync(`${destination}-wal`, 0o600);
  }
  if (JSON.stringify(state()) !== JSON.stringify(before))
    throw new Error(
      "SQLite changed while copying. Stop the old application before importing.",
    );
}

// This is the only SQLite dependency. The running application uses MySQL only.
// No plaintext credentials or message bodies are logged or decrypted here.
export async function importSqlite(
  database,
  filename,
  { verifyOnly = false } = {},
) {
  // A standalone WAL-mode backup may need temporary -shm/-wal files even for
  // read-only SQLite queries. Use a private copy so read-only Docker mounts work
  // and the original database and its journal are never modified.
  const temporaryRoot = path.resolve(
    process.env.SQLITE_MIGRATION_TMPDIR || "data",
  );
  fs.mkdirSync(temporaryRoot, { recursive: true });
  const temporary = fs.mkdtempSync(
    path.join(temporaryRoot, "minimail-import-"),
  );
  fs.chmodSync(temporary, 0o700);
  let source;
  try {
    const snapshot = path.join(temporary, "source.sqlite");
    copySnapshot(filename, snapshot);
    source = new DatabaseSync(snapshot, { readOnly: true });
    source.exec("BEGIN");
    if (source.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
      throw new Error("SQLite integrity check failed; import was not started.");
    const present = source
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
      .all()
      .map((row) => row.name);
    if (present.some((name) => !tableNames.includes(name)))
      throw new Error(
        "Unrecognized source tables; refusing to silently omit data.",
      );
    if (!present.includes("users"))
      throw new Error("Not a MiniMail SQLite database.");
    return await database.transaction(async () => {
      const lock = await database
        .prepare("SELECT GET_LOCK('minimail_sqlite_import',0) AS acquired")
        .get();
      if (lock.acquired !== 1)
        throw new Error("Another database import is running.");
      try {
        if (!verifyOnly) {
          for (const table of tableNames) {
            const row = await database
              .prepare(`SELECT COUNT(*) AS n FROM ${quoted(table)}`)
              .get();
            if (row.n !== 0)
              throw new Error(
                "MySQL must be empty. Existing data is never overwritten.",
              );
          }
        }
        const report = [];
        for (const table of tableNames) {
          const exists = present.includes(table);
          const columns = exists
            ? source
                .prepare(`PRAGMA table_info(${quoted(table)})`)
                .all()
                .map((row) => row.name)
            : [];
          const target = await database
            .prepare(`SHOW COLUMNS FROM ${quoted(table)}`)
            .all();
          const allowed = new Set(
            target
              .filter((row) => !/(?:STORED|VIRTUAL) GENERATED/.test(row.Extra))
              .map((row) => row.Field),
          );
          if (columns.some((name) => !allowed.has(name)))
            throw new Error(
              `Unrecognized columns in ${table}; no data was committed.`,
            );
          const copyColumns = [...columns];
          if (table === "accounts" && exists && !columns.includes("is_primary"))
            copyColumns.push("is_primary");
          if (table === "users" && exists && !columns.includes("role"))
            copyColumns.push("role");
          const oldAi =
            table === "ai_settings" && exists && !columns.includes("base_url");
          if (oldAi) copyColumns.push("base_url");
          const normalize = (row) => {
            const data = { ...row };
            if (table === "accounts" && !columns.includes("is_primary"))
              data.is_primary =
                source
                  .prepare("SELECT MIN(id) AS id FROM accounts WHERE user_id=?")
                  .get(data.user_id).id === data.id
                  ? 1
                  : 0;
            if (table === "users" && !columns.includes("role"))
              data.role =
                source.prepare("SELECT MIN(id) AS id FROM users").get().id ===
                data.id
                  ? "admin"
                  : "user";
            if (oldAi) {
              data.api_key_enc = null;
              data.model = "";
              data.base_url = "";
            }
            return copyColumns.map((name) => data[name]);
          };
          const expected = crypto.createHash("sha256");
          const actual = crypto.createHash("sha256");
          let count = 0;
          // SQLite BINARY and MySQL utf8mb4_0900_bin both order these keys by code point.
          const order = primaryKeys[table].map(quoted).join(",");
          if (exists) {
            const insert = database.prepare(
              `INSERT INTO ${quoted(table)} (${copyColumns.map(quoted).join(",")}) VALUES (${copyColumns.map(() => "?").join(",")})`,
            );
            for (const row of source
              .prepare(`SELECT * FROM ${quoted(table)} ORDER BY ${order}`)
              .iterate()) {
              const values = normalize(row);
              expected.update(JSON.stringify(values) + "\n");
              if (!verifyOnly) await insert.run(...values);
              count++;
            }
          }
          const targetCount = (
            await database
              .prepare(`SELECT COUNT(*) AS n FROM ${quoted(table)}`)
              .get()
          ).n;
          if (targetCount !== count)
            throw new Error(
              `Row count verification failed for ${table}; no data was committed.`,
            );
          if (count) {
            for (let offset = 0; offset < count; offset += 100) {
              const rows = await database
                .prepare(
                  `SELECT ${copyColumns.map(quoted).join(",")} FROM ${quoted(table)} ORDER BY ${order} LIMIT 100 OFFSET ${offset}`,
                )
                .all();
              for (const row of rows)
                actual.update(
                  JSON.stringify(copyColumns.map((name) => row[name])) + "\n",
                );
            }
          }
          if (expected.digest("hex") !== actual.digest("hex"))
            throw new Error(
              `Content verification failed for ${table}; no data was committed.`,
            );
          report.push({ table, rows: count, verified: true });
        }
        return report;
      } finally {
        await database
          .prepare("SELECT RELEASE_LOCK('minimail_sqlite_import')")
          .get();
      }
    });
  } finally {
    source?.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
