import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { checkBackupPassword, BackupError } from "./backups.js";

const errors = {
  busy: "Eine Serversicherung oder ein Update läuft bereits. Bitte später erneut versuchen.",
  capacity:
    "Es liegen bereits drei Serversicherungen vor. Nach 24 Stunden werden sie automatisch entfernt.",
  missing: "Die Serversicherung ist nicht verfügbar oder abgelaufen.",
  storage:
    "Die Serversicherung konnte nicht gespeichert werden. Bitte freien Speicherplatz auf dem Server prüfen.",
};
class HostBackupError extends Error {
  constructor(code, status = 503) {
    super(
      errors[code] ||
        "Der Serverbackup-Dienst ist nicht erreichbar. Bitte den Dienst auf dem Server prüfen.",
    );
    this.status = status;
  }
}

// This fixed Unix socket is the only host capability given to the web app.
// No browser-supplied destination, executable, host address or file path.
export function installationBackupClient(control = "/app/backup-control") {
  return async function request(method, route, owner, body, range) {
    let token;
    try {
      token = (await fs.readFile(path.join(control, "token"), "utf8")).trim();
    } catch (error) {
      if (error.code === "ENOENT" && method === "GET" && route === "/jobs")
        return { configured: false, jobs: [] };
      throw new HostBackupError("unavailable");
    }
    if (!/^[a-f0-9]{64}$/.test(token)) throw new HostBackupError("unavailable");
    const response = await new Promise((resolve, reject) => {
      const request = http.request(
        {
          socketPath: path.join(control, "service.sock"),
          path: route,
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            "X-MiniMail-Backup-Owner": owner,
            ...(body ? { "Content-Type": "application/json" } : {}),
            ...(range ? { Range: range } : {}),
          },
        },
        resolve,
      );
      request.on("error", () => reject(new HostBackupError("unavailable")));
      request.setTimeout(15000, () => request.destroy(new Error("timeout")));
      request.end(body ? JSON.stringify(body) : undefined);
    });
    // Downloads remain streams, including partial responses for resumed transfers.
    if (
      route.endsWith("/download") &&
      [200, 206].includes(response.statusCode)
    ) {
      response.setTimeout(120000, () => response.destroy());
      return response;
    }
    let raw = "";
    for await (const chunk of response) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 65536) {
        response.destroy();
        throw new HostBackupError("unavailable");
      }
    }
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new HostBackupError("unavailable");
    }
    if (response.statusCode >= 400)
      throw new HostBackupError(
        value.error,
        [400, 404, 409, 416].includes(response.statusCode)
          ? response.statusCode
          : 503,
      );
    return value;
  };
}

export function registerInstallationBackupRoutes(
  app,
  adminOnly,
  reauthenticate,
  request = installationBackupClient(),
) {
  const owner = (req) =>
    crypto
      .createHash("sha256")
      .update(
        `${req.user.id}:${req.sessionHash}:${req.user.password_hash}:${req.user.totp_secret}`,
      )
      .digest("hex");
  const route = (fn) => async (req, res, next) => {
    try {
      await fn(req, res);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      if (error instanceof HostBackupError || error instanceof BackupError)
        return res.status(error.status || 400).json({ error: error.message });
      next(error);
    }
  };
  app.get(
    "/api/admin/installation-backups",
    adminOnly,
    route(async (req, res) => {
      res.json(await request("GET", "/jobs", owner(req)));
    }),
  );
  app.post(
    "/api/admin/installation-backups",
    adminOnly,
    route(async (req, res) => {
      if (
        !/^[a-f0-9]{32}$/.test(req.body?.id) ||
        req.body?.confirmPause !== true
      )
        return res
          .status(400)
          .json({
            error:
              "Bitte die kurze Unterbrechung für das Serverbackup bestätigen.",
          });
      checkBackupPassword(req.body.backupPassword);
      if (Buffer.byteLength(req.body.backupPassword) > 1024)
        return res
          .status(400)
          .json({
            error:
              "Das Backup-Passwort darf höchstens 1024 UTF-8-Bytes lang sein.",
          });
      if (!(await reauthenticate(req, res))) return;
      const result = await request("POST", "/jobs", owner(req), {
        id: req.body.id,
        password: req.body.backupPassword,
      });
      res.status(202).json(result);
    }),
  );
  app.get(
    "/api/admin/installation-backups/:id/download",
    adminOnly,
    route(async (req, res) => {
      if (!/^[a-f0-9]{32}$/.test(req.params.id)) return res.status(404).end();
      const range = req.get("range");
      if (range && !/^bytes=\d*-\d*$/.test(range)) return res.status(416).end();
      const stream = await request(
        "GET",
        `/jobs/${req.params.id}/download`,
        owner(req),
        undefined,
        range,
      );
      res.status(stream.statusCode);
      for (const header of [
        "content-type",
        "content-disposition",
        "content-length",
        "accept-ranges",
        "content-range",
        "last-modified",
      ])
        if (stream.headers[header])
          res.setHeader(header, stream.headers[header]);
      const abort = () => stream.destroy();
      res.on("close", abort);
      try {
        await pipeline(stream, res);
      } finally {
        res.off("close", abort);
      }
    }),
  );
}
