import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { testDatabase } from "./mysqlTestHelper.js";
import { hashPassword, tokenHash } from "../server/security.js";

function code(secret, offset) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
    bytes = [];
  let bits = 0,
    value = 0;
  for (const character of secret) {
    value = (value << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) bytes.push((value >>> (bits -= 8)) & 255);
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
  const digest = crypto
    .createHmac("sha1", Buffer.from(bytes))
    .update(counter)
    .digest();
  return String(
    (digest.readUInt32BE(digest.at(-1) & 15) & 0x7fffffff) % 1000000,
  ).padStart(6, "0");
}

test("admin backup API requires password/2FA, rejects unauthorized uploads and restores with a safety backup and expired sessions", async (t) => {
  const db = await testDatabase(t);
  const folder = await fs.mkdtemp(
    path.join(os.tmpdir(), "minimail-backup-api-"),
  );
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const key = crypto.randomBytes(32),
    secret = "JBSWY3DPEHPK3PXP";
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const encryptedSecret = Buffer.concat([
    iv,
    cipher.getAuthTag(),
    data,
  ]).toString("base64");
  const adminPassword = "synthetic-administrator-password",
    backupPassword = "synthetic-backup-password";
  await db
    .prepare(
      "INSERT INTO users(id,username,password_hash,created_at,role,totp_secret) VALUES(1,'owner',?,1,'admin',?)",
    )
    .run(await hashPassword(adminPassword), encryptedSecret);
  await db
    .prepare(
      "INSERT INTO users(id,username,password_hash,created_at,role,totp_secret) VALUES(2,'member',?,1,'user',?)",
    )
    .run(await hashPassword("synthetic-member-password"), encryptedSecret);
  const tokens = [
    crypto.randomBytes(32).toString("hex"),
    crypto.randomBytes(32).toString("hex"),
  ];
  for (let i = 0; i < tokens.length; i++)
    await db
      .prepare(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
      )
      .run(tokenHash(tokens[i]), i + 1, Date.now() + 600000);
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../server/index.js", import.meta.url))],
    {
      cwd: folder,
      env: {
        ...process.env,
        ...db.env,
        APP_ENCRYPTION_KEY: key.toString("hex"),
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: String(port),
        DISABLE_MAIL_CHECKS: "1",
      },
      stdio: "ignore",
    },
  );
  t.after(async () => {
    child.kill();
    await fs.rm(folder, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  });
  const request = (
    route,
    {
      member = false,
      anonymous = false,
      method = "GET",
      body,
      raw,
      ticket,
    } = {},
  ) =>
    fetch(`http://127.0.0.1:${port}/api/admin/backups${route}`, {
      method,
      headers: {
        "X-MiniMail-Request": "1",
        "Content-Type": raw ? "application/octet-stream" : "application/json",
        ...(!anonymous
          ? { Cookie: `__Host-minimail_session=${tokens[member ? 1 : 0]}` }
          : {}),
        ...(ticket ? { "X-MiniMail-Backup-Ticket": ticket } : {}),
      },
      body: raw || (body ? JSON.stringify(body) : undefined),
    });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await request("")).status === 200) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, "backup API started");
  assert.equal((await request("", { anonymous: true })).status, 401);
  assert.equal((await request("", { member: true })).status, 403);
  assert.equal(
    (
      await request("/import", {
        member: true,
        method: "POST",
        raw: Buffer.alloc(256 * 1024),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/import", {
        method: "POST",
        raw: Buffer.from("not authorized"),
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("/export", { method: "POST", body: { backupPassword } }))
      .status,
    401,
  );
  const exported = await request("/export", {
    method: "POST",
    body: { adminPassword, backupPassword, code: code(secret, -1) },
  });
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get("content-disposition"), /\.pgp/);
  const backup = Buffer.from(await exported.arrayBuffer());
  await db.prepare("UPDATE users SET username='changed' WHERE id=1").run();
  async function authorize(offset) {
    const response = await request("/authorize-import", {
      method: "POST",
      body: {
        adminPassword,
        backupPassword,
        code: code(secret, offset),
        confirmation: "ALLE DATEN ERSETZEN",
      },
    });
    assert.equal(response.status, 200);
    return (await response.json()).ticket;
  }
  const invalidTicket = await authorize(0);
  const invalid = await request("/import", {
    method: "POST",
    ticket: invalidTicket,
    raw: backup.subarray(0, -1),
  });
  assert.equal(invalid.status, 400);
  assert.equal(
    (await db.prepare("SELECT username FROM users WHERE id=1").get()).username,
    "changed",
  );
  const ticket = await authorize(1);
  const restored = await request("/import", {
    method: "POST",
    ticket,
    raw: backup,
  });
  assert.equal(
    restored.status,
    200,
    JSON.stringify(await restored.clone().json()),
  );
  const result = await restored.json();
  assert.equal(result.ok, true);
  assert.match(result.safetyId, /\.pgp$/);
  assert.equal(
    (await db.prepare("SELECT username FROM users WHERE id=1").get()).username,
    "owner",
  );
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM sessions").get()).n,
    0,
  );
  assert.ok(
    (
      await db
        .prepare("SELECT last_counter FROM auth_totp_state WHERE user_id=1")
        .get()
    ).last_counter >= Math.floor(Date.now() / 30000),
  );
  assert.equal((await request("")).status, 401);
  assert.ok(
    (await fs.stat(path.join(folder, "data", "backups", result.safetyId)))
      .size > 0,
  );
});
