import path from "node:path";
import { createDatabase } from "./database.js";
import { initializeSchema } from "./schema.js";
import { importSqlite } from "./sqliteImport.js";

const args = process.argv.slice(2);
const verifyOnly = args.includes("--verify-only");
const filename =
  args.find((arg) => !arg.startsWith("--")) || "data/minimail.sqlite";
const database = createDatabase();
try {
  await initializeSchema(database);
  const report = await importSqlite(database, path.resolve(filename), {
    verifyOnly,
  });
  console.log(
    JSON.stringify({ verified: true, verifyOnly, tables: report }, null, 2),
  );
} catch (error) {
  // MySQL errors may include values. Print only our own diagnostic messages.
  console.error(
    error.code
      ? `Database migration failed (${error.code}); no data was committed.`
      : error.message,
  );
  process.exitCode = 1;
} finally {
  await database.close();
}
