import fs from "node:fs";
import { createDatabase } from "./database.js";
import { runMigrations } from "./migrations.js";

export const db = createDatabase();
try {
  await runMigrations(db);
  if (
    fs.existsSync("data/minimail.sqlite") &&
    !(await db.prepare("SELECT id FROM users LIMIT 1").get())
  )
    throw new Error(
      "Existing SQLite data found. Stop MiniMail and run npm run db:migrate before starting MySQL.",
    );
  await db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
} catch (error) {
  await db.close();
  throw error;
}
