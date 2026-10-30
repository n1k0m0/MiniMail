import fs from "node:fs";
import { createDatabase } from "./database.js";
import { migrationStatus } from "./migrations.js";
import { buildInfo } from "./buildInfo.js";
import { decrypt } from "./security.js";
const db = createDatabase();
try {
  const status = await migrationStatus(db);
  if (status.schema) {
    const rows = await db.prepare("SELECT * FROM accounts").all();
    for (const row of rows)
      for (const name of [
        "password_enc",
        "mail_rules_enc",
        "mail_rule_state_enc",
      ])
        if (row[name]) decrypt(row[name]);
  }
  if (!status.schema && fs.existsSync("data/minimail.sqlite"))
    throw new Error("Explicit SQLite migration required.");
  console.log(JSON.stringify({ ...buildInfo, ...status, encryptionOK: true }));
} finally {
  await db.close();
}
