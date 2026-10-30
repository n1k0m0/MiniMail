import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { allTableNames } from "./schema.js";
import { schemaSupport, buildInfo } from "./buildInfo.js";
import { migrationStatus } from "./migrations.js";
import { encrypt, decrypt, tokenHash } from "./security.js";

export const backupLimit = 512 * 1024 * 1024;
// Interrupted operations can leave private plaintext staging files. No workers
// from a previous application process survive a container restart.
const workDirectory = path.resolve("data", "backup-work");
export function cleanupBackupWork() {
  if (fs.existsSync(workDirectory)) {
    for (const name of fs.readdirSync(workDirectory))
      if (/^operation-[A-Za-z0-9]+$/.test(name))
        fs.rmSync(path.join(workDirectory, name), {
          recursive: true,
          force: true,
        });
  }
}
export class BackupError extends Error {}
const encrypted = {
  users: ["totp_secret", "pending_totp_secret"],
  accounts: [
    "password_enc",
    "smtp_password_enc",
    "pgp_private_enc",
    "pgp_passphrase_enc",
    "smime_key_enc",
    "mail_rules_enc",
    "mail_rule_state_enc",
  ],
  ai_settings: ["api_key_enc"],
  mail_index_messages: ["data_enc"],
  drafts: ["data_enc", "metadata_enc"],
  calendars: ["config_enc"],
  calendar_items: ["ical_enc"],
};
const worker = fileURLToPath(
  new URL("./backupCryptoWorker.js", import.meta.url),
);
let busy = false;
export async function backupOperation(callback) {
  if (busy)
    throw new BackupError(
      "Eine Sicherung oder Wiederherstellung läuft bereits.",
    );
  busy = true;
  try {
    return await callback();
  } finally {
    busy = false;
  }
}
export function checkBackupPassword(password) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 1024
  )
    throw new BackupError(
      "Das Backup-Passwort muss 12 bis 1024 Zeichen lang sein.",
    );
}
export async function backupCrypto(action, source, destination, password) {
  checkBackupPassword(password);
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--max-old-space-size=256", worker, action, source, destination],
      { stdio: ["pipe", "ignore", "ignore"], windowsHide: true },
    );
    const timer = setTimeout(() => child.kill(), 120000);
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ password }));
    child.on("error", () => {
      clearTimeout(timer);
      reject(new BackupError("Backup-Verarbeitung fehlgeschlagen."));
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(
          new BackupError(
            "Backup konnte nicht verarbeitet werden. Passwort, Dateiformat und Vollständigkeit prüfen.",
          ),
        );
    });
  });
}
export async function backupTemp() {
  const parent = path.resolve("data", "backup-work");
  await fsp.mkdir(parent, { recursive: true, mode: 0o700 });
  const folder = await fsp.mkdtemp(path.join(parent, "operation-"));
  await fsp.chmod(folder, 0o700);
  return folder;
}
const identifier = (name) => `\`${name}\``;
async function columnsFor(db) {
  const result = {};
  const rows = await db
    .prepare(
      "SELECT TABLE_NAME AS name FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'",
    )
    .all();
  if (
    rows.some(
      (row) => ![...allTableNames, "schema_migrations"].includes(row.name),
    )
  )
    throw new BackupError(
      "Die Datenbank enthält unbekannte Tabellen. Bitte die passende MiniMail-Version verwenden.",
    );
  for (const table of allTableNames) {
    const columns = await db
      .prepare(`SHOW COLUMNS FROM ${identifier(table)}`)
      .all();
    result[table] = columns
      .filter(
        (column) => !/\b(?:VIRTUAL|STORED) GENERATED\b/.test(column.Extra),
      )
      .map((column) => column.Field);
  }
  return result;
}
async function writeRecord(stream, value, state) {
  if (stream.errored || stream.destroyed)
    throw (
      stream.errored ||
      new BackupError("Die Sicherungsdatei konnte nicht geschrieben werden.")
    );
  const line = JSON.stringify(value) + "\n";
  state.bytes += Buffer.byteLength(line);
  if (state.bytes > backupLimit)
    throw new BackupError("Das Backup überschreitet das Limit von 512 MiB.");
  if (!stream.write(line)) await once(stream, "drain");
}
export async function exportDatabase(db, destination, password) {
  checkBackupPassword(password);
  const temp = await backupTemp();
  const plaintext = path.join(temp, "database.jsonl");
  try {
    const columns = await columnsFor(db);
    const status = await migrationStatus(db);
    if (status.dirty || status.schema !== schemaSupport.schema)
      throw new BackupError(
        "Die Datenbank ist nicht bereit für eine Sicherung.",
      );
    const stream = fs.createWriteStream(plaintext, {
      flags: "wx",
      mode: 0o600,
    });
    // Keep the stream's error handled even while the next SQL page is read.
    let writeError;
    stream.on("error", (error) => {
      writeError = error;
    });
    const state = { bytes: 0 },
      counts = {};
    try {
      await db.transaction(
        async () => {
          await writeRecord(
            stream,
            {
              format: "minimail-data",
              version: 1,
              schema: status.schema,
              createdAt: new Date().toISOString(),
              appVersion: buildInfo.version,
              columns,
            },
            state,
          );
          for (const table of allTableNames) {
            counts[table] = 0;
            // CAST prevents loss of precision in BIGINT identifiers and timestamps.
            const fields = columns[table]
              .map(
                (name) =>
                  `CAST(${identifier(name)} AS CHAR) AS ${identifier(name)}`,
              )
              .join(",");
            for await (const row of db.iterate(
              `SELECT ${fields} FROM ${identifier(table)}`,
            )) {
              const sealed = [];
              for (const name of encrypted[table] || [])
                if (row[name]) {
                  row[name] = decrypt(row[name]);
                  sealed.push(name);
                }
              await writeRecord(stream, { table, row, sealed }, state);
              if (writeError) throw writeError;
              counts[table]++;
            }
          }
          await writeRecord(stream, { end: true, counts }, state);
        },
        { snapshot: true },
      );
      stream.end();
      await finished(stream, { cleanup: true });
      if (writeError) throw writeError;
    } finally {
      stream.destroy();
    }
    const ciphertext = path.join(temp, "encrypted.pgp");
    await backupCrypto("encrypt", plaintext, ciphertext, password);
    // Publish with exclusive creation and make the safety copy durable before
    // any restore transaction may replace the current database. Existing
    // archives are never replaced, including after a failed write.
    const temporary = path.join(
      path.dirname(destination),
      `.minimail-backup-write-${crypto.randomBytes(16).toString("hex")}`,
    );
    const output = await fsp.open(temporary, "wx", 0o600);
    let published = false;
    try {
      let position = 0;
      for await (const chunk of fs.createReadStream(ciphertext)) {
        let offset = 0;
        while (offset < chunk.length) {
          const { bytesWritten } = await output.write(
            chunk,
            offset,
            chunk.length - offset,
            position,
          );
          if (!bytesWritten)
            throw new BackupError(
              "Die Sicherungsdatei konnte nicht vollständig geschrieben werden.",
            );
          offset += bytesWritten;
          position += bytesWritten;
        }
      }
      await output.sync();
      await output.close();
      await fsp.link(temporary, destination);
      published = true;
      if (process.platform !== "win32") {
        for (const directory of new Set([
          path.dirname(destination),
          path.dirname(path.dirname(destination)),
        ])) {
          const handle = await fsp.open(directory, "r");
          try {
            await handle.sync();
          } finally {
            await handle.close();
          }
        }
      }
    } catch (error) {
      if (published) await fsp.rm(destination, { force: true });
      throw error;
    } finally {
      await output.close();
      await fsp.rm(temporary, { force: true });
    }
    return counts;
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
}
async function* records(filename) {
  if ((await fsp.stat(filename)).size > backupLimit)
    throw new BackupError("Die Sicherungsdatei ist zu groß.");
  let parts = [],
    length = 0;
  for await (const chunk of fs.createReadStream(filename)) {
    let start = 0;
    while (start < chunk.length) {
      const end = chunk.indexOf(10, start);
      const part = chunk.subarray(start, end < 0 ? chunk.length : end);
      parts.push(part);
      length += part.length;
      if (length > 32 * 1024 * 1024)
        throw new BackupError("Ungültiger Backup-Datensatz.");
      if (end < 0) break;
      try {
        const record = JSON.parse(
          Buffer.concat(parts, length).toString("utf8"),
        );
        if (!record || typeof record !== "object" || Array.isArray(record))
          throw new Error();
        yield record;
      } catch {
        throw new BackupError("Ungültiger Backup-Datensatz.");
      }
      parts = [];
      length = 0;
      start = end + 1;
    }
  }
  if (length) throw new BackupError("Die Sicherungsdatei ist unvollständig.");
}
export async function prepareImport(db, source, password, folder) {
  const decrypted = path.join(folder, "decrypted.jsonl"),
    prepared = path.join(folder, "prepared.jsonl");
  await backupCrypto("decrypt", source, decrypted, password);
  const columns = await columnsFor(db),
    counts = Object.fromEntries(allTableNames.map((table) => [table, 0]));
  const output = fs.createWriteStream(prepared, { flags: "wx", mode: 0o600 });
  let failure;
  output.on("error", (error) => {
    failure = error;
  });
  let header,
    sourceColumns,
    ended = false,
    usableAdmins = 0,
    previousTable = -1;
  const state = { bytes: 0 };
  try {
    for await (const record of records(decrypted)) {
      if (!header) {
        const supportedOld = record.schema === 1 && schemaSupport.schema === 2;
        const expectedColumns = supportedOld
          ? {
              ...columns,
              accounts: columns.accounts.filter(
                (name) =>
                  !["mail_rules_enc", "mail_rule_state_enc"].includes(name),
              ),
            }
          : columns;
        if (
          record.format !== "minimail-data" ||
          record.version !== 1 ||
          (record.schema !== schemaSupport.schema && !supportedOld) ||
          JSON.stringify(record.columns) !== JSON.stringify(expectedColumns)
        )
          throw new BackupError(
            "Dieses Backup passt nicht zum Datenbankschema dieser MiniMail-Version.",
          );
        header = record;
        sourceColumns = expectedColumns;
      } else if (ended)
        throw new BackupError("Unerwartete Daten nach Backup-Ende.");
      else if (record.end === true) {
        if (JSON.stringify(record.counts) !== JSON.stringify(counts))
          throw new BackupError(
            "Die Anzahl der Backup-Datensätze stimmt nicht.",
          );
        ended = true;
      } else {
        const { table, row, sealed } = record;
        const index = allTableNames.indexOf(table);
        if (
          index < previousTable ||
          index < 0 ||
          !row ||
          Array.isArray(row) ||
          JSON.stringify(Object.keys(row)) !==
            JSON.stringify(sourceColumns[table]) ||
          Object.values(row).some(
            (value) => value !== null && typeof value !== "string",
          )
        )
          throw new BackupError(
            "Ungültige Tabelle oder Spalten in der Sicherung.",
          );
        previousTable = index;
        if (
          table === "accounts" &&
          header.schema === 1 &&
          schemaSupport.schema === 2
        ) {
          row.mail_rules_enc = null;
          row.mail_rule_state_enc = null;
        }
        const secretColumns = encrypted[table] || [];
        if (
          !Array.isArray(sealed) ||
          JSON.stringify(sealed) !==
            JSON.stringify(
              secretColumns.filter((name) => sealed.includes(name)),
            ) ||
          secretColumns.some(
            (name) =>
              !sealed.includes(name) && row[name] !== null && row[name] !== "",
          )
        )
          throw new BackupError(
            "Ungültige Verschlüsselungsmetadaten in der Sicherung.",
          );
        if (
          table === "users" &&
          (!["admin", "user"].includes(row.role) ||
            !/^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(row.password_hash) ||
            [row.totp_secret, row.pending_totp_secret].some(
              (secret) => secret && !/^[A-Z2-7]{16,128}$/.test(secret),
            ))
        )
          throw new BackupError(
            "Ungültige Benutzer- oder 2FA-Daten in der Sicherung.",
          );
        if (
          table === "users" &&
          row.role === "admin" &&
          row.totp_secret &&
          row.must_change_password === "0" &&
          /^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(row.password_hash)
        )
          usableAdmins++;
        for (const name of sealed) row[name] = encrypt(row[name]);
        // Sessions are deliberately not restored: all browsers must log in again.
        if (table !== "sessions")
          await writeRecord(output, { table, row }, state);
        counts[table]++;
      }
      if (failure) throw failure;
    }
    if (!header || !ended || !usableAdmins)
      throw new BackupError(
        "Unvollständiges Backup oder kein eingerichtetes Administratorkonto enthalten.",
      );
    output.end();
    await finished(output, { cleanup: true });
    if (failure) throw failure;
    return { prepared, counts, createdAt: header.createdAt };
  } finally {
    output.destroy();
    await fsp.rm(decrypted, { force: true });
  }
}
export async function replaceDatabase(db, prepared) {
  const columns = await columnsFor(db);
  await db.transaction(async () => {
    const previous = await db.prepare("SELECT * FROM auth_totp_state").all();
    const counters = new Map(
      previous.map((row) => [row.secret_hash, Number(row.last_counter)]),
    );
    for (const table of [...allTableNames].reverse())
      await db.exec(`DELETE FROM ${identifier(table)}`);
    for await (const { table, row } of records(prepared)) {
      // prepareImport is internal; still never trust identifiers from a file.
      if (
        !Object.hasOwn(columns, table) ||
        JSON.stringify(Object.keys(row)) !== JSON.stringify(columns[table])
      )
        throw new BackupError("Ungültige Importdaten.");
      await db
        .prepare(
          `INSERT INTO ${identifier(table)} (${columns[table].map(identifier).join(",")}) VALUES (${columns[table].map(() => "?").join(",")})`,
        )
        .run(...columns[table].map((name) => row[name]));
    }
    // Restoring an older backup must not make recently consumed 2FA codes valid
    // again. Keep the highest known counter for each secret and retire the
    // current time step. Users can sign in with their next fresh code.
    for (const user of await db
      .prepare("SELECT id,totp_secret FROM users WHERE totp_secret IS NOT NULL")
      .all()) {
      if (!user.totp_secret) continue;
      const fingerprint = tokenHash(decrypt(user.totp_secret));
      const saved = await db
        .prepare("SELECT * FROM auth_totp_state WHERE user_id=?")
        .get(user.id);
      const counter = Math.max(
        Math.floor(Date.now() / 30000),
        counters.get(fingerprint) || 0,
        saved?.secret_hash === fingerprint ? Number(saved.last_counter) : 0,
      );
      await db
        .prepare(
          "INSERT INTO auth_totp_state(user_id,secret_hash,last_counter) VALUES(?,?,?) ON DUPLICATE KEY UPDATE secret_hash=VALUES(secret_hash),last_counter=VALUES(last_counter)",
        )
        .run(user.id, fingerprint, counter);
    }
  });
}
export async function restoreDatabase(
  db,
  source,
  password,
  folder,
  authorize = async () => {},
) {
  const imported = await prepareImport(db, source, password, folder);
  return db.maintenance(async () => {
    await authorize();
    const directory = path.resolve("data", "backups");
    await fsp.mkdir(directory, { recursive: true, mode: 0o700 });
    const safetyId = `${Date.now()}-${crypto.randomBytes(12).toString("hex")}.minimail-backup.pgp`;
    await exportDatabase(db, path.join(directory, safetyId), password);
    await replaceDatabase(db, imported.prepared);
    return { counts: imported.counts, safetyId };
  });
}
