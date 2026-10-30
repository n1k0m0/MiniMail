import { createDatabase } from "./database.js";
import { runMigrations } from "./migrations.js";
const db = createDatabase();
try {
  console.log(JSON.stringify(await runMigrations(db)));
} finally {
  await db.close();
}
