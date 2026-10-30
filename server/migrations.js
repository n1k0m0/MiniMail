import crypto from "node:crypto";
import fs from "node:fs";
import { initializeSchema, schemaStatements, allTableNames } from "./schema.js";
import { schemaSupport } from "./buildInfo.js";

const baselineChecksum = crypto
  .createHash("sha256")
  .update(schemaStatements.join("\0"))
  .digest("hex");
const migrations = [
  {
    version: 1,
    checksum: baselineChecksum,
    idempotent: true,
    up: initializeSchema,
  },
];

export async function migrationStatus(db) {
  const tables = (
    await db
      .prepare(
        "SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema=DATABASE()",
      )
      .all()
  ).map((row) => row.name);
  if (!tables.includes("schema_migrations")) {
    const existing = allTableNames.filter((name) => tables.includes(name));
    if (existing.length && existing.length !== allTableNames.length)
      throw new Error(
        "Incomplete legacy schema; run an explicit migration before updating.",
      );
    return {
      schema: existing.length ? 1 : 0,
      dirty: false,
      legacy: !!existing.length,
    };
  }
  const rows = await db
    .prepare("SELECT * FROM schema_migrations ORDER BY version")
    .all();
  for (const row of rows) {
    const known = migrations.find(
      (migration) => migration.version === row.version,
    );
    if (known && known.checksum !== row.checksum)
      throw new Error(
        "Applied database migration checksum differs from this release.",
      );
    if (!["applying", "applied"].includes(row.status))
      throw new Error("Unknown database migration state.");
  }
  const highest = rows.at(-1)?.version || 0;
  if (highest > schemaSupport.readSchemaMax)
    throw new Error("Database is newer than this application can read.");
  return {
    schema: rows.length
      ? highest
      : allTableNames.every((name) => tables.includes(name))
        ? 1
        : 0,
    dirty: rows.some((row) => row.status !== "applied"),
    resumable: rows
      .filter((row) => row.status !== "applied")
      .every((row) =>
        migrations.some(
          (migration) =>
            migration.version === row.version &&
            migration.idempotent &&
            migration.checksum === row.checksum,
        ),
      ),
    legacy: false,
  };
}

export async function runMigrations(db) {
  return db.withConnection(async () => {
    const name = (await db.prepare("SELECT DATABASE() AS name").get()).name;
    const lock =
      "minimail-schema-" +
      crypto.createHash("sha256").update(name).digest("hex").slice(0, 32);
    const acquired = await db
      .prepare("SELECT GET_LOCK(?,30) AS acquired")
      .get(lock);
    if (acquired.acquired !== 1)
      throw new Error("Another schema migration is running.");
    try {
      const status = await migrationStatus(db);
      if (fs.existsSync("data/minimail.sqlite")) {
        const table = await db
          .prepare(
            "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='users'",
          )
          .get();
        if (
          !table.n ||
          !(await db.prepare("SELECT id FROM users LIMIT 1").get())
        )
          throw new Error(
            "Existing SQLite data requires the explicit SQLite importer; no automatic conversion is performed.",
          );
      }
      await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version INT NOT NULL PRIMARY KEY, checksum VARCHAR(64) NOT NULL,
        status VARCHAR(12) NOT NULL, started_at BIGINT NOT NULL, completed_at BIGINT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin`);
      for (const migration of migrations) {
        const row = await db
          .prepare("SELECT * FROM schema_migrations WHERE version=?")
          .get(migration.version);
        if (row?.checksum && row.checksum !== migration.checksum)
          throw new Error("Migration checksum changed; refused to continue.");
        if (row?.status === "applied") continue;
        if (row && !migration.idempotent)
          throw new Error("Interrupted migration needs manual recovery.");
        // MySQL DDL is not transactional. Keep an explicit durable journal and
        // resume only migrations whose operations are independently idempotent.
        await db
          .prepare(
            "INSERT INTO schema_migrations(version,checksum,status,started_at) VALUES (?,?,'applying',?) ON DUPLICATE KEY UPDATE status='applying'",
          )
          .run(migration.version, migration.checksum, Date.now());
        await migration.up(db);
        await db
          .prepare(
            "UPDATE schema_migrations SET status='applied',completed_at=? WHERE version=? AND checksum=?",
          )
          .run(Date.now(), migration.version, migration.checksum);
      }
      const final = await migrationStatus(db);
      if (final.dirty || final.schema < schemaSupport.readSchemaMin)
        throw new Error("Schema migration did not complete.");
      return { ...final, previous: status.schema };
    } finally {
      await db.prepare("SELECT RELEASE_LOCK(?)").get(lock);
    }
  });
}
