import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(
  new URL("../server/index.js", import.meta.url),
);
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0,
    value = 0;
  const bytes = [];
  for (const char of secret) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) bytes.push((value >>> (bits -= 8)) & 255);
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = crypto
    .createHmac("sha1", Buffer.from(bytes))
    .update(counter)
    .digest();
  return String(
    (digest.readUInt32BE(digest.at(-1) & 15) & 0x7fffffff) % 1000000,
  ).padStart(6, "0");
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
function storedPassword(password) {
  const salt = crypto.randomBytes(16);
  return `${salt.toString("hex")}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}
const account = (name) => ({
  name,
  email: `${name}@example.test`,
  imap_host: "imap.example.test",
  imap_port: 993,
  imap_secure: true,
  smtp_host: "smtp.example.test",
  smtp_port: 465,
  smtp_secure: true,
  username: `${name}@example.test`,
  password: "example-app-password",
});

test("nur Admins legen Benutzer an; Passwortwechsel, 2FA und Postfächer sind getrennt", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "minimail-test-"));
  const port = await freePort();
  const encryptionKey = crypto.randomBytes(32).toString("hex");
  const child = spawn(process.execPath, [serverPath], {
    cwd,
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(port),
      APP_ENCRYPTION_KEY: encryptionKey,
    },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}/api`;
  function client() {
    let cookie = "";
    return async (route, method = "GET", body) => {
      const response = await fetch(base + route, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      return { status: response.status, data: await response.json() };
    };
  }
  const admin = client(),
    member = client();
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        if ((await admin("/auth/me")).status === 200) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, "server started");
    assert.equal((await admin("/auth/me")).data.adminSetupRequired, true);
    assert.notEqual(
      (
        await admin("/auth/setup", "POST", {
          username: "intruder",
          password: "long-test-password",
        })
      ).status,
      200,
    );

    // Same database insertion that the interactive admin bootstrap script performs.
    const db = new DatabaseSync(path.join(cwd, "data", "minimail.sqlite"));
    db.prepare(
      "INSERT INTO users (username,password_hash,created_at,role,must_change_password) VALUES (?,?,?,'admin',0)",
    ).run("owner", storedPassword("long-admin-password"), Date.now());
    db.close();

    assert.equal(
      (
        await admin("/auth/login", "POST", {
          username: "owner",
          password: "long-admin-password",
        })
      ).status,
      200,
    );
    assert.equal((await admin("/accounts")).status, 403);
    const admin2fa = await admin("/auth/2fa/start", "POST");
    assert.equal(admin2fa.status, 200);
    assert.equal(
      (
        await admin("/auth/2fa/verify", "POST", {
          code: totp(admin2fa.data.secret),
        })
      ).status,
      200,
    );
    assert.equal((await admin("/auth/me")).data.user.role, "admin");

    const created = await admin("/admin/users", "POST", { username: "member" });
    assert.equal(created.status, 201);
    assert.match(created.data.temporaryPassword, /^[A-Za-z0-9_-]{40,}$/);
    assert.equal(created.data.user.role, "user");
    const ownerAccount = await admin("/accounts", "POST", {
      ...account("owner"),
      smtp_username: "owner-smtp",
      smtp_password: "separate-smtp-password",
    });
    assert.equal(ownerAccount.status, 200);
    assert.equal(ownerAccount.data.smtp_username, "owner-smtp");
    assert.equal(ownerAccount.data.smtp_password_enc, undefined);
    assert.equal(ownerAccount.data.needsCredentials, false);
    const accountsDb = new DatabaseSync(path.join(cwd, "data", "minimail.sqlite"));
    const storedAccount = accountsDb
      .prepare("SELECT smtp_username,smtp_password_enc FROM accounts WHERE id=?")
      .get(ownerAccount.data.id);
    accountsDb.close();
    assert.equal(storedAccount.smtp_username, "owner-smtp");
    assert.ok(storedAccount.smtp_password_enc);
    assert.ok(!storedAccount.smtp_password_enc.includes("separate-smtp-password"));

    assert.equal(
      (
        await member("/auth/login", "POST", {
          username: "member",
          password: created.data.temporaryPassword,
        })
      ).status,
      200,
    );
    assert.equal((await member("/accounts")).status, 403);
    assert.equal((await member("/auth/2fa/start", "POST")).status, 403);
    assert.equal(
      (
        await member("/auth/change-password", "POST", {
          currentPassword: created.data.temporaryPassword,
          newPassword: "new-member-password",
        })
      ).status,
      200,
    );
    const member2fa = await member("/auth/2fa/start", "POST");
    assert.equal(member2fa.status, 200);
    assert.equal(
      (
        await member("/auth/2fa/verify", "POST", {
          code: totp(member2fa.data.secret),
        })
      ).status,
      200,
    );
    assert.equal((await member("/admin/users")).status, 403);
    assert.equal(
      (await member("/admin/users", "POST", { username: "another" })).status,
      403,
    );
    assert.deepEqual((await member("/accounts")).data, []);
    assert.equal(
      (await member("/accounts", "POST", account("member"))).status,
      200,
    );
    assert.equal((await member("/accounts")).data.length, 1);
    assert.equal((await admin("/accounts")).data.length, 1);
    assert.equal((await admin("/accounts")).data[0].name, "owner");

    const reset = await admin(
      `/admin/users/${created.data.user.id}/reset-password`,
      "POST",
    );
    assert.equal(reset.status, 200);
    assert.equal((await member("/accounts")).status, 401);
    assert.equal(
      (
        await member("/auth/login", "POST", {
          username: "member",
          password: reset.data.temporaryPassword,
          code: totp(member2fa.data.secret),
        })
      ).status,
      200,
    );
    assert.equal((await member("/auth/me")).data.user.mustChangePassword, true);

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
      "aes-256-gcm",
      Buffer.from(encryptionKey, "hex"),
      iv,
    );
    cipher.final();
    const emptyPassword = Buffer.concat([iv, cipher.getAuthTag()]).toString("base64");
    const draftDb = new DatabaseSync(path.join(cwd, "data", "minimail.sqlite"));
    draftDb.prepare(
      "INSERT INTO accounts (user_id,name,email,imap_host,imap_port,imap_secure,smtp_host,smtp_port,smtp_secure,username,password_enc,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(1, "Draft", "draft@example.test", "imap.example.test", 993, 1,
      "smtp.example.test", 465, 1, "draft@example.test", emptyPassword, Date.now());
    draftDb.close();
    const drafts = (await admin("/accounts")).data;
    assert.equal(drafts.find((item) => item.email === "draft@example.test").needsCredentials, true);
  } finally {
    child.kill();
    if (child.exitCode === null)
      await new Promise((resolve) => child.once("exit", resolve));
    await fs.rm(cwd, { recursive: true, force: true });
  }
});
