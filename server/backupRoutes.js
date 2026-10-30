import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  BackupError,
  backupLimit,
  backupTemp,
  backupOperation,
  checkBackupPassword,
  exportDatabase,
  restoreDatabase,
} from "./backups.js";

const directory = () => path.resolve("data", "backups");
const safeName = (value) =>
  /^\d{13}-[a-f0-9]{24}\.minimail-backup\.pgp$/.test(value);
export function registerBackupRoutes(app, db, adminOnly, reauthenticate) {
  const tickets = new Map();
  const clear = setInterval(() => {
    for (const [id, ticket] of tickets)
      if (ticket.expires < Date.now()) tickets.delete(id);
  }, 10000);
  clear.unref();
  const route = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res)).catch((error) => {
      if (["ENOSPC", "EDQUOT", "ER_DISK_FULL"].includes(error.code))
        return res
          .status(503)
          .json({
            error:
              "Nicht genügend freier Speicherplatz für die Sicherung. Bitte Speicher freigeben und den Vorgang erneut starten.",
          });
      if (error instanceof BackupError)
        return res.status(400).json({ error: error.message });
      next(error);
    });
  app.get(
    "/api/admin/backups",
    adminOnly,
    route(async (req, res) => {
      await fsp.mkdir(directory(), { recursive: true, mode: 0o700 });
      const files = [];
      for (const name of await fsp.readdir(directory())) {
        if (!safeName(name)) continue;
        const stat = await fsp.lstat(path.join(directory(), name));
        if (stat.isFile())
          files.push({
            id: name,
            bytes: stat.size,
            createdAt: stat.mtime.toISOString(),
          });
      }
      res.json(files.sort((a, b) => b.id.localeCompare(a.id)));
    }),
  );
  app.get(
    "/api/admin/backups/:id",
    adminOnly,
    route(async (req, res) => {
      if (!safeName(req.params.id)) return res.sendStatus(404);
      const filename = path.join(directory(), req.params.id);
      const stat = await fsp.lstat(filename).catch(() => null);
      if (!stat?.isFile()) return res.sendStatus(404);
      res.download(filename, req.params.id);
    }),
  );
  app.post(
    "/api/admin/backups/export",
    adminOnly,
    route(async (req, res) => {
      checkBackupPassword(req.body?.backupPassword);
      if (!(await reauthenticate(req, res))) return;
      await backupOperation(async () => {
        const folder = await backupTemp();
        try {
          const filename = path.join(folder, "export.pgp");
          await exportDatabase(db, filename, req.body.backupPassword);
          console.log("Administrator created data backup", {
            userId: req.user.id,
          });
          await new Promise((resolve, reject) =>
            res.download(
              filename,
              `minimail-${new Date().toISOString().slice(0, 10)}.minimail-backup.pgp`,
              (error) => (error ? reject(error) : resolve()),
            ),
          );
        } finally {
          await fsp.rm(folder, { recursive: true, force: true });
        }
      });
    }),
  );
  app.post(
    "/api/admin/backups/authorize-import",
    adminOnly,
    route(async (req, res) => {
      checkBackupPassword(req.body?.backupPassword);
      if (req.body.confirmation !== "ALLE DATEN ERSETZEN")
        throw new BackupError(
          "Bitte die vollständige Wiederherstellung bestätigen.",
        );
      if (!(await reauthenticate(req, res))) return;
      if (tickets.size >= 8)
        throw new BackupError(
          "Zu viele vorbereitete Importe. Bitte kurz warten.",
        );
      const ticket = crypto.randomBytes(32).toString("hex");
      tickets.set(ticket, {
        userId: req.user.id,
        session: req.headers.cookie,
        password: req.body.backupPassword,
        expires: Date.now() + 120000,
      });
      res.json({ ticket });
    }),
  );
  // Authorization is checked before reading a potentially large binary body.
  app.post(
    "/api/admin/backups/import",
    adminOnly,
    route(async (req, res) => {
      const id = req.get("x-minimail-backup-ticket"),
        ticket = tickets.get(id);
      tickets.delete(id);
      if (
        !ticket ||
        ticket.expires < Date.now() ||
        ticket.userId !== req.user.id ||
        ticket.session !== req.headers.cookie
      )
        return res.status(403).json({
          error: "Importfreigabe abgelaufen. Bitte erneut bestätigen.",
        });
      if (
        req.get("content-type") !== "application/octet-stream" ||
        (req.get("content-encoding") &&
          req.get("content-encoding") !== "identity")
      )
        return res
          .status(415)
          .json({ error: "Bitte die unveränderte Sicherungsdatei auswählen." });
      await backupOperation(async () => {
        const folder = await backupTemp();
        try {
          const filename = path.join(folder, "upload.pgp");
          let bytes = 0;
          const bounded = new Transform({
            transform(chunk, encoding, callback) {
              bytes += chunk.length;
              callback(
                bytes > backupLimit
                  ? new BackupError(
                      "Die Sicherungsdatei ist zu groß (maximal 512 MiB).",
                    )
                  : null,
                chunk,
              );
            },
          });
          await pipeline(
            req,
            bounded,
            fs.createWriteStream(filename, { flags: "wx", mode: 0o600 }),
            { signal: AbortSignal.timeout(300000) },
          );
          const result = await restoreDatabase(
            db,
            filename,
            ticket.password,
            folder,
            async () => {
              const current = await db
                .prepare(
                  "SELECT users.* FROM users JOIN sessions ON sessions.user_id=users.id WHERE sessions.token_hash=? AND sessions.expires_at>?",
                )
                .get(req.sessionHash, Date.now());
              if (
                !current ||
                current.id !== req.user.id ||
                current.role !== "admin" ||
                current.password_hash !== req.user.password_hash ||
                current.totp_secret !== req.user.totp_secret
              )
                throw new BackupError(
                  "Die Importfreigabe ist nicht mehr gültig. Bitte erneut anmelden.",
                );
            },
          );
          tickets.clear();
          console.log("Administrator restored data backup", {
            userId: req.user.id,
            safetyId: result.safetyId,
          });
          res.json({ ok: true, ...result });
        } finally {
          ticket.password = "";
          await fsp.rm(folder, { recursive: true, force: true });
        }
      });
    }),
  );
}
