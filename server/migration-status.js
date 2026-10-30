import fs from "node:fs";
import { createDatabase } from "./database.js";
import { migrationStatus } from "./migrations.js";
import { buildInfo } from "./buildInfo.js";
import { decrypt } from "./security.js";
const db = createDatabase();
try {
  const status = await migrationStatus(db);
  if (status.schema) {
    const row = await db
      .prepare("SELECT password_enc FROM accounts LIMIT 1")
      .get();
    if (row?.password_enc) decrypt(row.password_enc);
  }
  if (!status.schema && fs.existsSync("data/minimail.sqlite"))
    throw new Error("Explicit SQLite migration required.");
  console.log(JSON.stringify({ ...buildInfo, ...status, encryptionOK: true }));
} finally {
  await db.close();
}
