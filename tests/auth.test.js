import { gzipSync } from "node:zlib";
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { testDatabase } from "./mysqlTestHelper.js";
import { fileURLToPath } from "node:url";
import * as openpgp from "openpgp";
const serverPath = fileURLToPath(
  new URL("../server/index.js", import.meta.url),
);
function totp(secret, offset = 0) {
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
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offset));
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
test("only admins create users; password changes, 2FA, and mailboxes stay separate", async (t) => {
  const database = await testDatabase(t);
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "minimail-test-"));
  const port = await freePort();
  const encryptionKey = crypto.randomBytes(32).toString("hex");
  const child = spawn(process.execPath, [serverPath], {
    cwd,
    env: {
      ...process.env,
      ...database.env,
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(port),
      APP_ENCRYPTION_KEY: encryptionKey,
      DISABLE_MAIL_CHECKS: "1",
      MAIL_VPN_PROFILE_ID: "private",
      MAIL_VPN_PROFILE_LABEL: "Private mail VPN",
      MAIL_VPN_PROXY_URL: "http://vpn-gateway:3128",
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
          "X-MiniMail-Request": "1",
          ...(cookie
            ? {
                Cookie: cookie,
              }
            : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      return {
        status: response.status,
        setCookie,
        data: await response.json(),
      };
    };
  }
  const admin = client(),
    adminOther = client(),
    member = client(),
    memberOther = client();
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
    const uncached = await fetch(base + "/auth/me");
    assert.equal(uncached.headers.get("cache-control"), "no-store");
    const forged = await fetch(base + "/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: "owner",
        password: "wrong",
      }),
    });
    assert.equal(forged.status, 403);
    const crossSite = await fetch(base + "/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-MiniMail-Request": "1",
        "Sec-Fetch-Site": "cross-site",
      },
      body: JSON.stringify({
        username: "owner",
        password: "wrong",
      }),
    });
    assert.equal(crossSite.status, 403);
    const unparsedPrivate = await fetch(base + "/accounts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-MiniMail-Request": "1",
      },
      body: "x".repeat(70000),
    });
    assert.equal(unparsedPrivate.status, 401);
    const compressed = await fetch(base + "/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-MiniMail-Request": "1",
        "Content-Encoding": "gzip",
      },
      body: Buffer.concat([
        gzipSync(
          JSON.stringify({
            username: "synthetic",
            password: "wrong",
          }),
        ),
        Buffer.from("trailing bytes"),
      ]),
    });
    assert.equal(compressed.status, 415);
    assert.equal((await admin("/auth/me")).status, 200);
    const wrongOrigin = await fetch(base + "/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-MiniMail-Request": "1",
        Origin: "https://other.example.test",
      },
      body: JSON.stringify({
        username: "owner",
        password: "wrong",
      }),
    });
    assert.equal(wrongOrigin.status, 403);
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
    const db = database;
    await db
      .prepare(
        "INSERT INTO users (username,password_hash,created_at,role,must_change_password) VALUES (?,?,?,'admin',0)",
      )
      .run("owner", storedPassword("long-admin-password"), Date.now());
    const openTab = await fetch(base + "/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: `https://127.0.0.1:${port}`,
        "Sec-Fetch-Site": "same-origin",
      },
      body: JSON.stringify({
        username: "owner",
        password: "wrong",
      }),
    });
    assert.equal(openTab.status, 401);
    const adminLogin = await admin("/auth/login", "POST", {
      username: "owner",
      password: "long-admin-password",
    });
    assert.equal(adminLogin.status, 200);
    assert.match(
      adminLogin.setCookie,
      /^__Host-minimail_session=.*; HttpOnly; SameSite=Strict; Path=\/;.*; Secure$/,
    );
    assert.equal(
      (
        await adminOther("/auth/login", "POST", {
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
    assert.equal((await adminOther("/accounts")).status, 401);
    assert.equal((await admin("/accounts")).status, 200);
    const freshCode = totp(admin2fa.data.secret, 1);
    const concurrentLogins = await Promise.all(
      [client(), client()].map((request) =>
        request("/auth/login", "POST", {
          username: "owner",
          password: "long-admin-password",
          code: freshCode,
        }),
      ),
    );
    assert.deepEqual(
      concurrentLogins.map((result) => result.status).sort(),
      [200, 401],
      "only one concurrent request can consume a 2FA code",
    );
    assert.equal(
      (
        await client()("/auth/login", "POST", {
          username: "owner",
          password: "long-admin-password",
          code: freshCode,
        })
      ).status,
      401,
      "accepted codes cannot be replayed",
    );
    assert.equal((await admin("/auth/me")).data.user.role, "admin");
    assert.equal((await admin("/auth/me")).data.user.collectRecipients, true);
    assert.equal((await admin("/settings/ai")).status, 200);
    const system = await admin("/admin/system");
    assert.equal(system.status, 200);
    assert.equal(system.data.license, "Apache-2.0");
    assert.equal(
      (
        await admin("/settings/ai", "PUT", {
          baseUrl: "https://ai.example.test/v1",
          model: "local-model",
          apiKey: "test-ai-key",
          rewriteMaxTokens: 12000,
          summaryMaxTokens: null,
        })
      ).status,
      200,
    );
    const aiSettings = await admin("/settings/ai");
    assert.equal(aiSettings.data.configured, true);
    assert.equal(aiSettings.data.baseUrl, "https://ai.example.test/v1");
    assert.equal(aiSettings.data.model, "local-model");
    assert.equal(aiSettings.data.rewriteMaxTokens, 12000);
    assert.equal(aiSettings.data.summaryMaxTokens, null);
    assert.equal(
      JSON.stringify(aiSettings.data).includes("test-ai-key"),
      false,
    );
    assert.equal(
      (
        await admin("/ai/rewrite", "POST", {
          text: "",
        })
      ).status,
      400,
    );
    assert.deepEqual((await admin("/contacts")).data, []);
    assert.equal(
      (
        await admin("/contacts", "POST", {
          name: "Bad",
          email: "bad\r\n@example.test",
        })
      ).status,
      400,
    );
    const contact = await admin("/contacts", "POST", {
      name: "Alice",
      email: "Alice@example.test",
    });
    assert.equal(contact.status, 201);
    assert.equal(
      (
        await admin("/contacts", "POST", {
          name: "Duplicate",
          email: "alice@example.test",
        })
      ).status,
      409,
    );
    assert.equal((await admin("/contacts?q=alice")).data.length, 1);
    assert.equal(
      (
        await admin(`/contacts/${contact.data.id}`, "PUT", {
          name: "Alice B",
          email: "alice@example.test",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await admin("/settings/contacts", "PATCH", {
          collectRecipients: false,
        })
      ).status,
      200,
    );
    assert.equal((await admin("/auth/me")).data.user.collectRecipients, false);
    assert.equal(
      (
        await admin("/settings/contacts", "PATCH", {
          collectRecipients: "yes",
        })
      ).status,
      400,
    );
    assert.deepEqual((await admin("/vpn-profiles")).data, [
      {
        id: "private",
        label: "Private mail VPN",
      },
    ]);
    const created = await admin("/admin/users", "POST", {
      username: "member",
    });
    assert.equal(created.status, 201);
    assert.match(created.data.temporaryPassword, /^[A-Za-z0-9_-]{40,}$/);
    assert.equal(created.data.user.role, "user");
    const ownerAccount = await admin("/accounts", "POST", {
      ...account("owner"),
      smtp_username: "owner-smtp",
      smtp_password: "separate-smtp-password",
      sender_name: "Owner Name",
      signature: "Owner signature",
    });
    assert.equal(ownerAccount.status, 200);
    assert.equal(ownerAccount.data.smtp_username, "owner-smtp");
    assert.equal(ownerAccount.data.sender_name, "Owner Name");
    assert.equal(ownerAccount.data.signature, "Owner signature");
    assert.equal(ownerAccount.data.smtp_password_enc, undefined);
    assert.equal(ownerAccount.data.pgp_private_enc, undefined);
    assert.equal(ownerAccount.data.smime_key_enc, undefined);
    assert.equal(ownerAccount.data.needsCredentials, false);
    assert.equal(
      (await admin(`/accounts/${ownerAccount.data.id}/crypto`)).data.mode,
      "none",
    );
    assert.equal(
      (
        await admin(`/accounts/${ownerAccount.data.id}/crypto`, "PATCH", {
          mode: "pgp",
          sign: false,
          encrypt: true,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await admin(`/accounts/${ownerAccount.data.id}/send`, "POST", {
          to: "receiver@example.test",
          text: "hello",
          crypto: {
            mode: "pgp",
            sign: false,
            encrypt: true,
          },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await admin(`/accounts/${ownerAccount.data.id}/send`, "POST", {
          to: "receiver@example.test",
          text: "hello",
          crypto: {
            mode: "pgp",
            sign: false,
            encrypt: false,
          },
        })
      ).status,
      400,
    );
    const ownKey = await openpgp.generateKey({
      type: "ecc",
      curve: "curve25519",
      userIDs: [
        {
          email: ownerAccount.data.email,
        },
      ],
      passphrase: "key-passphrase",
    });
    assert.equal(
      (
        await admin(`/accounts/${ownerAccount.data.id}/crypto/pgp`, "PUT", {
          privateKey: ownKey.privateKey,
          passphrase: "key-passphrase",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await admin(`/accounts/${ownerAccount.data.id}/crypto`, "PATCH", {
          mode: "pgp",
          sign: true,
          encrypt: false,
        })
      ).status,
      200,
    );
    const afterKeyImport = (await admin("/accounts")).data.find(
      (item) => item.id === ownerAccount.data.id,
    );
    assert.equal(afterKeyImport.hasPgpKey, true);
    assert.equal(afterKeyImport.pgp_private_enc, undefined);
    assert.equal(afterKeyImport.pgp_passphrase_enc, undefined);
    assert.equal(
      (
        await admin(`/accounts/${ownerAccount.data.id}/crypto`, "PATCH", {
          mode: "none",
          sign: false,
          encrypt: false,
        })
      ).status,
      200,
    );
    const contactKey = await openpgp.generateKey({
      type: "ecc",
      curve: "curve25519",
      userIDs: [
        {
          email: "alice@example.test",
        },
      ],
    });
    assert.equal(
      (
        await admin(`/contacts/${contact.data.id}/crypto/pgp`, "PUT", {
          publicKey: contactKey.publicKey,
        })
      ).status,
      200,
    );
    const afterContactKey = (await admin("/contacts")).data[0];
    assert.equal(afterContactKey.hasPgpKey, true);
    assert.equal(afterContactKey.pgp_public, undefined);
    assert.equal(ownerAccount.data.is_primary, true);
    assert.equal(ownerAccount.data.check_interval_minutes, 5);
    assert.equal(ownerAccount.data.vpn_profile, "");
    assert.equal(ownerAccount.data.last_checked_at, null);
    assert.equal(
      (
        await admin(
          `/accounts/${ownerAccount.data.id}/folders/mark-read`,
          "PATCH",
          {},
        )
      ).status,
      400,
    );
    assert.equal(
      (await admin(`/accounts/${ownerAccount.data.id}/trash/empty`, "POST", {}))
        .status,
      400,
    );
    assert.equal(
      (
        await admin(`/accounts/${ownerAccount.data.id}/send`, "POST", {
          to: "receiver@example.test",
          text: "hello",
          attachments: {
            name: "not-an-array",
          },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await admin(`/accounts/${ownerAccount.data.id}/send`, "POST", {
          to: "receiver@example.test\r\nBcc: other@example.test",
          text: "hello",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await admin(`/accounts/${ownerAccount.data.id}/send`, "POST", {
          to: "",
          bcc: "hidden@example.test\r\nTo: other@example.test",
          text: "hello",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await admin(`/accounts/${ownerAccount.data.id}/send`, "POST", {
          to: "receiver@example.test",
          text: "hello",
          attachments: [
            {
              name: "large.bin",
              data: Buffer.alloc(8 * 1024 * 1024 + 1).toString("base64"),
            },
          ],
        })
      ).status,
      400,
    );
    const accountsDb = database;
    const storedAccount = await accountsDb
      .prepare(
        "SELECT smtp_username,smtp_password_enc FROM accounts WHERE id=?",
      )
      .get(ownerAccount.data.id);
    assert.equal(storedAccount.smtp_username, "owner-smtp");
    assert.ok(storedAccount.smtp_password_enc);
    assert.ok(
      !storedAccount.smtp_password_enc.includes("separate-smtp-password"),
    );
    assert.equal(
      (
        await admin(`/accounts/${ownerAccount.data.id}`, "PUT", {
          ...account("owner"),
          smtp_username: "owner-smtp",
          smtp_password: "separate-smtp-password",
          check_interval_minutes: 0,
        })
      ).data.check_interval_minutes,
      0,
    );
    assert.equal(
      (
        await admin(`/accounts/${ownerAccount.data.id}`, "PUT", {
          ...account("owner"),
          smtp_username: "owner-smtp",
          smtp_password: "separate-smtp-password",
          signature: "Updated signature",
        })
      ).data.signature,
      "Updated signature",
    );
    assert.equal(
      (
        await admin(`/accounts/${ownerAccount.data.id}`, "PUT", {
          ...account("owner"),
          smtp_username: "owner-smtp",
          smtp_password: "separate-smtp-password",
          sender_name: "Invalid\nName",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await admin(`/accounts/${ownerAccount.data.id}`, "PUT", {
          ...account("owner"),
          smtp_username: "owner-smtp",
          smtp_password: "separate-smtp-password",
          check_interval_minutes: 2.5,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await admin(`/accounts/${ownerAccount.data.id}`, "PUT", {
          ...account("owner"),
          smtp_username: "owner-smtp",
          smtp_password: "separate-smtp-password",
          vpn_profile: "private",
        })
      ).data.vpn_profile,
      "private",
    );
    assert.equal(
      (
        await admin(`/accounts/${ownerAccount.data.id}`, "PUT", {
          ...account("owner"),
          smtp_username: "owner-smtp",
          smtp_password: "separate-smtp-password",
          vpn_profile: "unknown",
        })
      ).status,
      400,
    );
    for (let i = 0; i < 8; i++)
      assert.equal(
        (
          await admin("/auth/login", "POST", {
            username: "unknown-user",
            password: "wrong",
          })
        ).status,
        401,
      );
    assert.equal(
      (
        await admin("/auth/login", "POST", {
          username: "unknown-user",
          password: "wrong",
        })
      ).status,
      429,
    );
    assert.equal(
      (
        await member("/auth/login", "POST", {
          username: "member",
          password: created.data.temporaryPassword,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await memberOther("/auth/login", "POST", {
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
    assert.equal((await memberOther("/auth/me")).data.user, null);
    const member2fa = await member("/auth/2fa/start", "POST");
    assert.equal(member2fa.status, 200);
    assert.equal(
      (
        await member("/auth/2fa/verify", "POST", {
          code: totp(member2fa.data.secret, -1),
        })
      ).status,
      200,
    );
    assert.equal((await admin("/admin/backups")).status, 200);
    assert.equal(
      (
        await admin("/admin/backups/export", "POST", {
          backupPassword: "long-enough-backup-password",
        })
      ).status,
      401,
    );
    for (const route of [
      "/admin/backups",
      "/admin/backups/authorize-import",
      "/admin/backups/export",
      "/admin/backups/import",
    ]) {
      assert.equal(
        (
          await member(
            route,
            route === "/admin/backups" ? "GET" : "POST",
            route === "/admin/backups"
              ? undefined
              : { ignored: "x".repeat(4096) },
          )
        ).status,
        403,
      );
    }
    // Incomplete messages, reply metadata, and binary attachments survive saving.
    const savedDraft = {
      accountId: ownerAccount.data.id,
      type: "reply-all",
      to: "",
      cc: "",
      bcc: "",
      subject: "Private unfinished message",
      text: "Draft body – not yet sent",
      inReplyTo: "<original@example.test>",
      references: ["<original@example.test>"],
      crypto: {
        mode: "pgp",
        sign: false,
        encrypt: "auto",
      },
      attachments: [
        {
          name: "binary.bin",
          data: "AAH/",
        },
      ],
    };
    assert.equal(
      (await admin("/drafts/review-draft", "PUT", savedDraft)).status,
      200,
    );
    const restoredDraft = await admin("/drafts/review-draft");
    assert.equal(restoredDraft.status, 200);
    assert.deepEqual(restoredDraft.data, {
      ...savedDraft,
      id: "review-draft",
    });
    assert.equal((await admin("/drafts")).data.length, 1);
    // Another signed-in user cannot list, read, modify, or delete this draft.
    assert.deepEqual((await member("/drafts")).data, []);
    assert.equal((await member("/drafts/review-draft")).status, 404);
    assert.equal(
      (await member("/drafts/review-draft", "PUT", savedDraft)).status,
      400,
    );
    assert.equal((await member("/drafts/review-draft", "DELETE")).status, 200);
    assert.equal((await admin("/drafts/review-draft")).status, 200);
    const inspectionDb = database;
    const encryptedDraft = (
      await inspectionDb
        .prepare("SELECT data_enc FROM drafts WHERE id=?")
        .get("review-draft")
    ).data_enc;
    assert.ok(!encryptedDraft.includes(savedDraft.text));
    assert.ok(!encryptedDraft.includes(savedDraft.subject));
    for (const malformed of [
      {
        ...savedDraft,
        attachments: [
          {
            name: "bad.bin",
            data: "???=",
          },
        ],
      },
      {
        ...savedDraft,
        attachments: Array(9).fill({
          name: "empty.txt",
          data: "",
        }),
      },
      {
        ...savedDraft,
        references: ["invalid header"],
      },
      {
        ...savedDraft,
        accountId: -1,
      },
      {
        ...savedDraft,
        text: "x".repeat(500001),
      },
      {
        ...savedDraft,
        type: "invalid",
      },
    ])
      assert.equal(
        (await admin("/drafts/review-draft", "PUT", malformed)).status,
        400,
      );
    assert.equal(
      (await admin("/drafts/review-draft")).data.text,
      savedDraft.text,
    );
    assert.equal(
      (
        await admin("/drafts/review-draft", "PUT", {
          ...savedDraft,
          text: "Updated draft",
        })
      ).status,
      200,
    );
    assert.equal(
      (await admin("/drafts/review-draft")).data.text,
      "Updated draft",
    );
    assert.equal((await admin("/drafts/review-draft", "DELETE")).status, 200);
    assert.equal((await admin("/drafts/review-draft")).status, 404);
    const quotaDb = database;
    const encryptDraft = (value) => {
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv(
        "aes-256-gcm",
        Buffer.from(encryptionKey, "hex"),
        nonce,
      );
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(value)),
        cipher.final(),
      ]);
      return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString(
        "base64",
      );
    };
    for (let i = 0; i < 50; i++)
      await quotaDb
        .prepare(
          "INSERT INTO drafts (user_id,id,data_enc,updated_at) VALUES (1,?,?,?)",
        )
        .run(`quota-${i}`, encryptDraft(savedDraft), Date.now());
    assert.equal(
      (await admin("/drafts/quota-extra", "PUT", savedDraft)).status,
      413,
    );
    assert.equal(
      (await admin("/drafts/quota-0", "PUT", savedDraft)).status,
      200,
    );
    assert.equal((await admin("/drafts")).data.length, 50);
    assert.equal(
      (
        await quotaDb
          .prepare(
            "SELECT count(*) AS n FROM drafts WHERE metadata_enc IS NOT NULL",
          )
          .get()
      ).n,
      50,
    );
    await quotaDb.prepare("DELETE FROM drafts WHERE id LIKE 'quota-%'").run();
    // An existing large draft also enforces the encrypted-byte budget.
    await quotaDb
      .prepare(
        "INSERT INTO drafts (user_id,id,data_enc,updated_at) VALUES (1,'quota-large',?,?)",
      )
      .run("x".repeat(64 * 1024 * 1024), Date.now());
    assert.equal(
      (await admin("/drafts/quota-extra", "PUT", savedDraft)).status,
      413,
    );
    await quotaDb.prepare("DELETE FROM drafts WHERE id='quota-large'").run();
    assert.equal((await member("/admin/users")).status, 403);
    const memberAi = await member("/settings/ai");
    assert.equal(memberAi.status, 200);
    assert.deepEqual(memberAi.data, { configured: true });
    const ownerCalendars = await admin("/calendar/calendars");
    const memberCalendars = await member("/calendar/calendars");
    assert.equal(ownerCalendars.status, 200);
    assert.equal(memberCalendars.status, 200);
    const ownerCalendarId = ownerCalendars.data.calendars[0].id;
    assert.ok(
      !memberCalendars.data.calendars.some((c) => c.id === ownerCalendarId),
    );
    const calendarEvent = await admin(
      `/calendar/calendars/${ownerCalendarId}/events`,
      "POST",
      {
        title: "Private appointment",
        start: "2026-11-01T10:00",
        end: "2026-11-01T11:00",
        timezone: "UTC",
      },
    );
    assert.equal(calendarEvent.status, 201);
    assert.equal(
      (await member(`/calendar/events/${calendarEvent.data.id}`)).status,
      404,
    );
    assert.equal(
      (
        await member(`/calendar/events/${calendarEvent.data.id}`, "DELETE", {
          version: calendarEvent.data.version,
        })
      ).status,
      404,
    );
    assert.equal(
      (await member(`/calendar/calendars/${ownerCalendarId}/export`)).status,
      404,
    );
    assert.equal(
      (
        await member(`/calendar/calendars/${ownerCalendarId}/events`, "POST", {
          title: "forged",
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await admin(`/calendar/events/${calendarEvent.data.id}`, "PATCH", {
          title: "stale",
          version: 0,
        })
      ).status,
      409,
    );
    assert.equal((await fetch(base + "/calendar/calendars")).status, 401);
    assert.equal(
      (
        await member("/settings/ai", "PUT", {
          model: "gpt-4.1-mini",
        })
      ).status,
      403,
    );
    assert.deepEqual((await member("/contacts")).data, []);
    assert.equal(
      (
        await member(`/contacts/${contact.data.id}`, "PUT", {
          name: "Stolen",
          email: "stolen@example.test",
        })
      ).status,
      404,
    );
    assert.equal(
      (await member(`/contacts/${contact.data.id}`, "DELETE")).status,
      404,
    );
    assert.equal(
      (
        await member(`/contacts/${contact.data.id}/crypto/pgp`, "PUT", {
          publicKey: "invalid",
        })
      ).status,
      404,
    );
    assert.equal(
      (await member(`/accounts/${ownerAccount.data.id}/crypto`)).status,
      404,
    );
    assert.equal((await admin("/contacts")).data[0].name, "Alice B");
    assert.deepEqual((await member("/vpn-profiles")).data, []);
    assert.equal((await member("/admin/system")).status, 403);
    assert.equal(
      (await member("/admin/system/check-updates", "POST", {})).status,
      403,
    );
    assert.equal(
      (
        await member("/admin/users", "POST", {
          username: "another",
        })
      ).status,
      403,
    );
    assert.deepEqual((await member("/accounts")).data, []);
    assert.equal(
      (await member("/accounts", "POST", account("member"))).status,
      200,
    );
    assert.equal((await member("/accounts")).data.length, 1);
    assert.equal((await member("/accounts")).data[0].is_primary, true);
    assert.equal((await admin("/accounts")).data.length, 1);
    assert.equal((await admin("/accounts")).data[0].name, "owner");
    assert.equal(
      (await member(`/accounts/${ownerAccount.data.id}/primary`, "PATCH"))
        .status,
      404,
    );
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
    const emptyPassword = Buffer.concat([iv, cipher.getAuthTag()]).toString(
      "base64",
    );
    const draftDb = database;
    await draftDb
      .prepare(
        "INSERT INTO accounts (user_id,name,email,imap_host,imap_port,imap_secure,smtp_host,smtp_port,smtp_secure,username,password_enc,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        1,
        "Draft",
        "draft@example.test",
        "imap.example.test",
        993,
        1,
        "smtp.example.test",
        465,
        1,
        "draft@example.test",
        emptyPassword,
        Date.now(),
      );
    const drafts = (await admin("/accounts")).data;
    const draft = drafts.find((item) => item.email === "draft@example.test");
    assert.equal(draft.needsCredentials, true);
    assert.equal(draft.is_primary, false);
    assert.equal(
      (await admin(`/accounts/${draft.id}/primary`, "PATCH")).status,
      200,
    );
    const selectedPrimary = (await admin("/accounts")).data;
    assert.equal(
      selectedPrimary.find((item) => item.id === draft.id).is_primary,
      true,
    );
    assert.equal(
      selectedPrimary.find((item) => item.id === ownerAccount.data.id)
        .is_primary,
      false,
    );
    assert.equal(draft.check_interval_minutes, 5);
    assert.equal(draft.smtp_username, "");
    const configured = await admin(`/accounts/${draft.id}`, "PUT", {
      ...draft,
      smtp_username: null,
      password: "draft-mail-password",
      check_interval_minutes: 10,
    });
    assert.equal(configured.status, 200);
    assert.equal(configured.data.needsCredentials, false);
    assert.equal(configured.data.check_interval_minutes, 10);
    assert.equal(configured.data.is_primary, true);
    assert.equal((await admin(`/accounts/${draft.id}`, "DELETE")).status, 200);
    assert.equal((await admin("/accounts")).data[0].is_primary, true);
    const enrollmentUser = await admin("/admin/users", "POST", {
      username: "enrollment",
    });
    const enrollment = client();
    assert.equal(
      (
        await enrollment("/auth/login", "POST", {
          username: "enrollment",
          password: enrollmentUser.data.temporaryPassword,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await enrollment("/auth/change-password", "POST", {
          currentPassword: enrollmentUser.data.temporaryPassword,
          newPassword: "synthetic-enrollment-password",
        })
      ).status,
      200,
    );
    assert.equal((await enrollment("/auth/2fa/start", "POST")).status, 200);
    for (let i = 0; i < 8; i++)
      assert.equal(
        (
          await enrollment("/auth/2fa/verify", "POST", {
            code: "invalid",
          })
        ).status,
        400,
      );
    assert.equal(
      (
        await enrollment("/auth/2fa/verify", "POST", {
          code: "invalid",
        })
      ).status,
      429,
    );
  } finally {
    child.kill();
    if (child.exitCode === null)
      await new Promise((resolve) => child.once("exit", resolve));
    await fs.rm(cwd, {
      recursive: true,
      force: true,
    });
  }
});
