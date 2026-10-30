import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import filesystem from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { testDatabase, insertTestUser } from "./mysqlTestHelper.js";
import {
  backupCrypto,
  backupTemp,
  exportDatabase,
  prepareImport,
  replaceDatabase,
  restoreDatabase,
} from "../server/backups.js";
import { encrypt, decrypt, hashPassword } from "../server/security.js";
import { runMigrations } from "../server/migrations.js";

const password = "test-only-correct-horse-battery";
test("password backups authenticate contents, reject wrong passwords/truncation and never replace an existing file", async (t) => {
  const folder = await backupTemp();
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const input = path.join(folder, "plain"),
    encrypted = path.join(folder, "backup.pgp");
  await fs.writeFile(input, "private content\n");
  await backupCrypto("encrypt", input, encrypted, password);
  assert.ok(
    !(await fs.readFile(encrypted)).includes(Buffer.from("private content")),
  );
  const restored = path.join(folder, "restored");
  await backupCrypto("decrypt", encrypted, restored, password);
  assert.equal(await fs.readFile(restored, "utf8"), "private content\n");
  await assert.rejects(backupCrypto("encrypt", input, encrypted, password));
  await assert.rejects(
    backupCrypto(
      "decrypt",
      encrypted,
      path.join(folder, "wrong"),
      "incorrect-password-123",
    ),
  );
  const bytes = await fs.readFile(encrypted);
  for (const [name, data] of [
    ["truncated", bytes.subarray(0, -1)],
    ["tampered", Buffer.from(bytes)],
  ]) {
    if (name === "tampered") data[data.length - 20] ^= 1;
    const source = path.join(folder, name);
    await fs.writeFile(source, data);
    await assert.rejects(
      backupCrypto(
        "decrypt",
        source,
        path.join(folder, name + ".out"),
        password,
      ),
    );
  }
});

test("a complete database backup restores identities, encrypted data and calendar preferences; failed imports roll back", async (t) => {
  const db = await testDatabase(t);
  await runMigrations(db);
  const folder = await backupTemp();
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  await insertTestUser(db);
  const hash = await hashPassword("original-admin-password");
  await db
    .prepare(
      "UPDATE users SET role='admin',password_hash=?,totp_secret=? WHERE id=1",
    )
    .run(hash, encrypt("JBSWY3DPEHPK3PXP"));
  await db
    .prepare(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,1,?)",
    )
    .run("a".repeat(64), Date.now() + 60000);
  await db
    .prepare(
      "INSERT INTO accounts(id,user_id,name,email,imap_host,imap_port,imap_secure,smtp_host,smtp_port,smtp_secure,username,password_enc,created_at,sender_name,signature,is_primary) VALUES(1,1,'Mailbox','owner@example.test','imap.example.test',993,1,'smtp.example.test',465,1,'owner',?,1,'Änne Example','Private signature',1)",
    )
    .run(encrypt("private-mailbox-password"));
  await db
    .prepare(
      "UPDATE accounts SET smtp_password_enc=?,pgp_passphrase_enc=? WHERE id=1",
    )
    .run(encrypt(""), encrypt(""));
  await db
    .prepare(
      "INSERT INTO key_scan_folders(account_id,folder,uid_validity,inline_uids,updated_at) VALUES(1,'INBOX','42','[17,23]',1)",
    )
    .run();
  await db
    .prepare(
      "INSERT INTO calendars(id,user_id,name,kind,config_enc,created_at) VALUES (1,1,'Primary','local',?,?)",
    )
    .run(encrypt(JSON.stringify({ primaryForNewItems: true })), Date.now());
  await db
    .prepare(
      "INSERT INTO calendar_items(calendar_id,uid_hash,ical_enc,updated_at) VALUES(1,?,?,?)",
    )
    .run("b".repeat(64), encrypt("BEGIN:VCALENDAR\nEND:VCALENDAR"), Date.now());
  await db
    .prepare(
      "INSERT INTO drafts(user_id,id,data_enc,updated_at) VALUES(1,'draft',?,?)",
    )
    .run(
      encrypt(
        JSON.stringify({
          text: "private draft",
          attachments: [{ content: "YWJj" }],
        }),
      ),
      Date.now(),
    );
  const destination = path.join(folder, "database.pgp");
  const counts = await exportDatabase(db, destination, password);
  assert.equal(counts.users, 1);
  assert.equal(counts.calendar_items, 1);
  await assert.rejects(exportDatabase(db, destination, password));
  await db.prepare("UPDATE users SET username='changed' WHERE id=1").run();
  const imported = await prepareImport(db, destination, password, folder);
  await db.maintenance(() => replaceDatabase(db, imported.prepared));
  const user = await db.prepare("SELECT * FROM users WHERE id=1").get();
  assert.equal(user.username, "test-user-1");
  assert.equal(user.password_hash, hash);
  assert.equal(decrypt(user.totp_secret), "JBSWY3DPEHPK3PXP");
  const mailbox = await db.prepare("SELECT * FROM accounts WHERE id=1").get();
  assert.equal(mailbox.sender_name, "Änne Example");
  assert.equal(mailbox.signature, "Private signature");
  assert.equal(mailbox.primary_user_id, 1);
  assert.equal(decrypt(mailbox.password_enc), "private-mailbox-password");
  assert.equal(decrypt(mailbox.smtp_password_enc), "");
  assert.equal(decrypt(mailbox.pgp_passphrase_enc), "");
  assert.equal(
    (
      await db
        .prepare("SELECT inline_uids FROM key_scan_folders WHERE account_id=1")
        .get()
    ).inline_uids,
    "[17,23]",
  );
  assert.equal(
    (await db.prepare("SELECT COUNT(*) AS n FROM sessions").get()).n,
    0,
  );
  const target = await testDatabase(t);
  const targetFolder = await backupTemp();
  t.after(() => fs.rm(targetFolder, { recursive: true, force: true }));
  const backupModule = pathToFileURL(path.resolve("server/backups.js")).href;
  const databaseModule = pathToFileURL(path.resolve("server/database.js")).href;
  const securityModule = pathToFileURL(path.resolve("server/security.js")).href;
  const script = `import {createDatabase} from ${JSON.stringify(databaseModule)};import {prepareImport,replaceDatabase} from ${JSON.stringify(backupModule)};import {decrypt} from ${JSON.stringify(securityModule)};const db=createDatabase();try{const prepared=await prepareImport(db,process.argv[1],process.env.TEST_BACKUP_PASSWORD,process.argv[2]);await db.maintenance(()=>replaceDatabase(db,prepared.prepared));if(decrypt((await db.prepare('SELECT totp_secret FROM users WHERE id=1').get()).totp_secret)!=='JBSWY3DPEHPK3PXP')throw new Error('different-key restore failed');}finally{await db.close();}`;
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", script, destination, targetFolder],
      {
        env: {
          ...process.env,
          ...target.env,
          APP_ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex"),
          TEST_BACKUP_PASSWORD: password,
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let errors = "";
    child.stderr.on("data", (chunk) => {
      errors += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(errors)),
    );
  });
  const targetUser = await target
    .prepare("SELECT totp_secret FROM users WHERE id=1")
    .get();
  assert.throws(() => decrypt(targetUser.totp_secret));
  assert.equal(
    JSON.parse(
      decrypt(
        (await db.prepare("SELECT * FROM calendars WHERE id=1").get())
          .config_enc,
      ),
    ).primaryForNewItems,
    true,
  );
  assert.equal(
    JSON.parse(
      decrypt((await db.prepare("SELECT * FROM drafts").get()).data_enc),
    ).attachments[0].content,
    "YWJj",
  );
  // Failure after the DELETE statements must still restore the original DB.
  const invalid = path.join(folder, "invalid.jsonl");
  await fs.writeFile(invalid, '{"table":"users","row":{"id":"1"}}\n');
  await assert.rejects(db.maintenance(() => replaceDatabase(db, invalid)));
  assert.equal(
    (await db.prepare("SELECT * FROM users WHERE id=1").get()).username,
    user.username,
  );
  await t.test(
    "a failed durable safety copy prevents any replacement and releases maintenance",
    async (t) => {
      await db
        .prepare("UPDATE users SET username='keep-current' WHERE id=1")
        .run();
      const importFolder = await backupTemp();
      t.after(() => fs.rm(importFolder, { recursive: true, force: true }));
      const originalOpen = fs.open;
      t.mock.method(fs, "open", async (name, ...args) => {
        if (String(name).startsWith(path.resolve("data", "backups") + path.sep))
          throw Object.assign(new Error("synthetic full disk"), {
            code: "ENOSPC",
          });
        return originalOpen(name, ...args);
      });
      await assert.rejects(
        restoreDatabase(db, destination, password, importFolder),
        { code: "ENOSPC" },
      );
      assert.equal(
        (await db.prepare("SELECT username FROM users WHERE id=1").get())
          .username,
        "keep-current",
      );
      await db.activity(
        () => db.prepare("SELECT id FROM users LIMIT 1").get(),
        true,
      );
    },
  );
});

test(
  "a file error after the snapshot closes fails promptly instead of hanging the export",
  { timeout: 10000 },
  async (t) => {
    const db = await testDatabase(t);
    await runMigrations(db);
    const folder = await backupTemp();
    t.after(() => fs.rm(folder, { recursive: true, force: true }));
    const createStream = filesystem.createWriteStream;
    let output;
    t.mock.method(filesystem, "createWriteStream", (name, ...args) => {
      const stream = createStream(name, ...args);
      if (String(name).endsWith("database.jsonl")) output = stream;
      return stream;
    });
    const transaction = db.transaction;
    t.mock.method(db, "transaction", async (...args) => {
      const result = await transaction(...args);
      output.destroy(
        Object.assign(new Error("synthetic late ENOSPC"), { code: "ENOSPC" }),
      );
      await new Promise((resolve) => output.once("close", resolve));
      return result;
    });
    await assert.rejects(
      exportDatabase(db, path.join(folder, "failed.pgp"), password),
      { code: "ENOSPC" },
    );
    assert.equal(
      (await db.prepare("SELECT COUNT(*) AS n FROM users").get()).n,
      0,
    );
  },
);

test("restore fences late writes from an earlier request and rolls back its open transactions", async (t) => {
  const db = await testDatabase(t);
  await insertTestUser(db);
  let release, began;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    began = resolve;
  });
  const oldRequest = db.activity(async () => {
    const row = await db.prepare("SELECT * FROM users WHERE id=1").get();
    began();
    await wait;
    await assert.rejects(
      db.prepare("UPDATE users SET username=? WHERE id=1").run(row.username),
      /wiederhergestellt/,
    );
  });
  await started;
  await db.maintenance(() =>
    db.prepare("UPDATE users SET username='restored' WHERE id=1").run(),
  );
  release();
  await oldRequest;
  assert.equal(
    (await db.prepare("SELECT * FROM users WHERE id=1").get()).username,
    "restored",
  );
  await assert.rejects(
    db.transaction(async () => {
      await db
        .prepare("UPDATE users SET username='should-rollback' WHERE id=1")
        .run();
      for await (const row of db.iterate("SELECT * FROM users")) {
        assert.equal(row.id, 1);
        throw new Error("abort-stream");
      }
    }),
    /abort-stream/,
  );
  assert.equal(
    (await db.prepare("SELECT username FROM users WHERE id=1").get()).username,
    "restored",
  );
});
