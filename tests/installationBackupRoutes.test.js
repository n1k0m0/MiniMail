import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { Readable } from "node:stream";
import {
  registerInstallationBackupRoutes,
  installationBackupClient,
} from "../server/installationBackupRoutes.js";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";

test("server backup API checks administrator, pause consent and reauthentication; binds streamed downloads to the session", async (t) => {
  const app = express();
  app.use(express.json());
  let calls = [],
    reauth = 0;
  app.use((req, res, next) => {
    const role = req.get("x-test-role");
    if (!role) return res.sendStatus(401);
    req.user = { id: 1, role, password_hash: "hash", totp_secret: "secret" };
    req.sessionHash = req.get("x-test-session") || "one";
    next();
  });
  registerInstallationBackupRoutes(
    app,
    (req, res, next) =>
      req.user.role === "admin" ? next() : res.sendStatus(403),
    async (req, res) => {
      reauth++;
      if (
        req.body.adminPassword !== "synthetic-admin" ||
        req.body.code !== "123456"
      ) {
        res.sendStatus(401);
        return false;
      }
      return true;
    },
    async (method, route, owner, body, range) => {
      calls.push({ method, route, owner, body, range });
      if (!route.endsWith("/download")) return { configured: true, jobs: [] };
      const stream = Readable.from([Buffer.from("encrypted archive")]);
      stream.statusCode = range ? 206 : 200;
      stream.headers = {
        "content-type": "application/octet-stream",
        "content-disposition": 'attachment; filename="backup.age"',
      };
      return stream;
    },
  );
  const listener = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => listener.once("listening", resolve));
  t.after(() => listener.close());
  const url = `http://127.0.0.1:${listener.address().port}/api/admin/installation-backups`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal(
    (await fetch(url, { headers: { "x-test-role": "user" } })).status,
    403,
  );
  assert.equal(calls.length, 0);
  const headers = {
    "x-test-role": "admin",
    "Content-Type": "application/json",
  };
  const body = {
    id: "a".repeat(32),
    adminPassword: "synthetic-admin",
    code: "123456",
    backupPassword: "synthetic-backup-password",
    confirmPause: true,
  };
  const post = (value) =>
    fetch(url, { method: "POST", headers, body: JSON.stringify(value) });
  assert.equal((await post({ ...body, confirmPause: false })).status, 400);
  assert.equal((await post({ ...body, id: "../bad" })).status, 400);
  assert.equal(reauth, 0);
  assert.equal((await post({ ...body, code: "wrong" })).status, 401);
  assert.equal(calls.length, 0);
  assert.equal((await post(body)).status, 202);
  assert.deepEqual(calls[0].body, {
    id: body.id,
    password: body.backupPassword,
  });
  const first = calls[0].owner;
  const download = await fetch(`${url}/${body.id}/download`, {
    headers: { ...headers, Range: "bytes=0-7" },
  });
  assert.equal(download.status, 206);
  assert.equal(await download.text(), "encrypted archive");
  assert.equal(calls.at(-1).owner, first);
  assert.equal(calls.at(-1).range, "bytes=0-7");
  await fetch(url, { headers: { ...headers, "x-test-session": "two" } });
  assert.notEqual(calls.at(-1).owner, first);
  const count = calls.length;
  assert.equal(
    (
      await fetch(`${url}/${body.id}/download`, {
        headers: { ...headers, Range: "bytes=0-1,3-4" },
      })
    ).status,
    416,
  );
  assert.equal(calls.length, count);
});

test("host bridge reports missing setup without host access and authenticates socket requests", async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "mm-b-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const client = installationBackupClient(folder),
    owner = "b".repeat(64),
    token = "a".repeat(64);
  assert.deepEqual(await client("GET", "/jobs", owner), {
    configured: false,
    jobs: [],
  });
  if (process.platform === "win32") return;
  await fs.writeFile(path.join(folder, "token"), token);
  const server = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    assert.equal(req.headers["x-minimail-backup-owner"], owner);
    res.setHeader("Content-Type", "application/json");
    res.end('{"configured":true,"jobs":[]}');
  });
  await new Promise((resolve) =>
    server.listen(path.join(folder, "service.sock"), resolve),
  );
  t.after(() => server.close());
  assert.deepEqual(await client("GET", "/jobs", owner), {
    configured: true,
    jobs: [],
  });
});
