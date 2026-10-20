import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const dbModule = fileURLToPath(new URL("../server/db.js", import.meta.url));

test("bestehende Postfächer erhalten je Benutzer ein Primärpostfach", async () => {
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
      .prepare("SELECT id,user_id,is_primary FROM accounts ORDER BY id")
      .all()
      .map((row) => ({ ...row })),
    [
      { id: 10, user_id: 1, is_primary: 1 },
      { id: 11, user_id: 1, is_primary: 0 },
      { id: 20, user_id: 2, is_primary: 1 },
    ],
  );
  migrated.close();
});
