import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { testDatabase, insertTestUser } from "./mysqlTestHelper.js";
import { runMigrations } from "../server/migrations.js";
import { encrypt, decrypt } from "../server/security.js";
import {
  changeMailRules,
  loadMailRules,
  mailboxOperation,
} from "../server/mailRuleStore.js";
import { validateMailRule } from "../server/mailFilterRules.js";
import {
  processMailFilters,
  startFilterJob,
  initializeFilterCursor,
} from "../server/mailFilterEngine.js";
import {
  createRemoteFolder,
  folderDeletePlan,
  folderTrashDestination,
  moveRemoteFolderToTrash,
  reconcileFolderDelete,
} from "../server/folderActions.js";
import { registerMailRuleRoutes } from "../server/mailRuleRoutes.js";

class ImapFixture {
  constructor() {
    this.namespace = { prefix: "", delimiter: "/" };
    this.capabilities = new Set(["MOVE"]);
    this.folders = new Map();
    this.searches = [];
    this.moves = [];
    this.renameMode = "success";
    for (const [path, specialUse] of [
      ["INBOX", ""],
      ["Trash", "\\Trash"],
      ["Invoices", ""],
      ["Invoices/Child", ""],
      ["Invoices-old", ""],
      ["Other", ""],
    ])
      this.addFolder(path, specialUse);
  }
  addFolder(path, specialUse = "") {
    this.folders.set(path, {
      path,
      name: path.split("/").at(-1),
      delimiter: "/",
      flags: new Set(),
      specialUse,
      validity: "42",
      next: 1,
      messages: [],
    });
  }
  add(path, subject = "Invoice", flags = [], body = "") {
    const folder = this.folders.get(path);
    const message = {
      uid: folder.next++,
      envelope: { subject, from: [{ address: "sender@example.test" }] },
      flags: new Set(flags),
      bodyStructure: {},
      body,
    };
    folder.messages.push(message);
    return message;
  }
  async list() {
    return [...this.folders.values()].map((folder) => ({
      ...folder,
      status: {
        messages: folder.messages.length,
        unseen: folder.messages.filter(
          (message) => !message.flags.has("\\Seen"),
        ).length,
        uidValidity: folder.validity,
      },
    }));
  }
  async status(path) {
    const f = this.folders.get(path);
    if (!f) throw new Error("missing folder");
    return {
      uidValidity: f.validity,
      uidNext: f.next,
      messages: f.messages.length,
    };
  }
  async getMailboxLock(path) {
    this.selected = path;
    const f = this.folders.get(path);
    if (!f) throw new Error("missing folder");
    this.mailbox = { uidValidity: f.validity, uidNext: f.next };
    return { release() {} };
  }
  async search(query) {
    this.searches.push(query);
    const members = query.uid.includes(":")
      ? null
      : new Set(query.uid.split(",").map(Number));
    const [min, max] = query.uid.split(":").map(Number);
    return this.folders
      .get(this.selected)
      .messages.filter(
        (message) =>
          (members
            ? members.has(message.uid)
            : message.uid >= min && message.uid <= max) &&
          (!query.body || message.body.includes(query.body)),
      )
      .map((message) => message.uid);
  }
  async fetchAll(uids) {
    return this.folders
      .get(this.selected)
      .messages.filter((message) => uids.includes(message.uid))
      .map((message) => ({ ...message, flags: new Set(message.flags) }));
  }
  async messageFlagsAdd(uid, flags) {
    const message = this.folders
      .get(this.selected)
      .messages.find((message) => message.uid === uid);
    for (const flag of flags) message.flags.add(flag);
    return true;
  }
  async messageFlagsRemove(uid, flags) {
    const message = this.folders
      .get(this.selected)
      .messages.find((message) => message.uid === uid);
    for (const flag of flags) message.flags.delete(flag);
    return true;
  }
  async messageMove(uid, target) {
    if (this.moveFailure) {
      this.moveFailure = false;
      throw new Error("synthetic move failure after flags");
    }
    const source = this.folders.get(this.selected),
      destination = this.folders.get(target),
      message = source.messages.find((message) => message.uid === uid);
    source.messages = source.messages.filter((message) => message.uid !== uid);
    destination.messages.push({ ...message, uid: destination.next++ });
    this.moves.push({ uid, target });
    if (this.lostMoveReply) {
      this.lostMoveReply = false;
      throw new Error("lost move reply");
    }
    return { uidMap: new Map([[uid, destination.next - 1]]) };
  }
  async mailboxCreate(path) {
    this.addFolder(path);
    return { path };
  }
  async mailboxSubscribe() {
    return true;
  }
  async mailboxRename(source, target) {
    if (this.renameMode === "reject") return false;
    for (const [path, folder] of [...this.folders])
      if (path === source || path.startsWith(source + "/")) {
        const destination = target + path.slice(source.length);
        this.folders.delete(path);
        this.folders.set(destination, { ...folder, path: destination });
      }
    if (this.renameMode === "lost-reply") throw new Error("lost reply");
    if (this.renameMode === "unavailable")
      this.list = async () => {
        throw new Error("disconnected");
      };
    return true;
  }
}
const rule = (patch = {}, id = "rule-a") =>
  validateMailRule(
    {
      name: "Invoices",
      enabled: true,
      match: "all",
      conditions: [
        { field: "subject", operator: "contains", value: "Invoice" },
      ],
      actions: { moveTo: "Invoices", seen: null, flagged: null },
      stop: true,
      ...patch,
    },
    { id },
  );
async function setup(t) {
  const db = await testDatabase(t);
  await runMigrations(db);
  await insertTestUser(db);
  await insertTestUser(db, 2);
  for (const id of [1, 2])
    await db
      .prepare(
        "INSERT INTO accounts(id,user_id,name,email,imap_host,imap_port,imap_secure,smtp_host,smtp_port,smtp_secure,username,password_enc,created_at) VALUES(?,?,?,'owner@example.test','imap.example.test',993,1,'smtp.example.test',465,1,'owner',?,1)",
      )
      .run(id, id, `Mailbox ${id}`, encrypt("synthetic-password"));
  const account = await db.prepare("SELECT * FROM accounts WHERE id=1").get();
  return { db, account, client: new ImapFixture() };
}
test("automatic filters skip existing mail, use bounded UIDs and durable plans across flag/move failures", async (t) => {
  const { db, account, client } = await setup(t);
  client.add("INBOX");
  await changeMailRules(db, 1, (config) => {
    config.rules = [
      rule({
        conditions: [{ field: "seen", operator: "is", value: "no" }],
        actions: { moveTo: "Invoices", seen: true, flagged: true },
      }),
    ];
    config.revision++;
  });
  assert.equal(
    (await processMailFilters(db, account, client)).initialized,
    true,
  );
  assert.equal(client.moves.length, 0);
  const message = client.add("INBOX");
  client.moveFailure = true;
  await assert.rejects(
    processMailFilters(db, account, client),
    /synthetic move failure/,
  );
  assert.ok(message.flags.has("\\Seen"));
  assert.ok((await loadMailRules(db, 1)).pendingMessage);
  const result = await processMailFilters(db, account, client);
  assert.equal(result.moved, 1);
  assert.equal(client.moves.length, 1);
  assert.equal(client.moves[0].uid, message.uid);
  assert.equal(client.folders.get("INBOX").messages.length, 1);
  assert.equal((await loadMailRules(db, 1)).pendingMessage, null);
  assert.ok(client.searches.every((query) => !query.uid.includes("*")));
  const stored = await db
    .prepare(
      "SELECT mail_rules_enc,mail_rule_state_enc FROM accounts WHERE id=1",
    )
    .get();
  assert.ok(!stored.mail_rules_enc.includes("Invoices"));
  assert.equal(JSON.parse(decrypt(stored.mail_rules_enc)).rules.length, 1);
  assert.equal((await loadMailRules(db, 2)).rules.length, 0);
});
test("unsupported MOVE and failed invitation preservation stop before changing mail", async (t) => {
  const { db, account, client } = await setup(t);
  client.add("INBOX");
  await changeMailRules(db, 1, (config) => {
    config.rules = [
      rule({ actions: { moveTo: "Invoices", seen: true, flagged: null } }),
    ];
    config.cursor = { validity: "42", lastUid: 0 };
  });
  client.capabilities.clear();
  await assert.rejects(processMailFilters(db, account, client), /IMAP MOVE/);
  assert.equal(client.folders.get("INBOX").messages[0].flags.size, 0);
  client.capabilities.add("MOVE");
  await assert.rejects(
    processMailFilters(db, account, client, {
      beforeMove: async () => {
        throw new Error("invitation import failed");
      },
    }),
    /invitation import failed/,
  );
  assert.equal(client.folders.get("INBOX").messages[0].flags.size, 0);
  let preserved = false;
  await processMailFilters(db, account, client, {
    beforeMove: async () => {
      preserved = true;
      assert.equal(client.moves.length, 0);
    },
  });
  assert.ok(preserved);
  assert.equal(client.moves.length, 1);
});
test("manual runs have a fixed snapshot, preserve priority and process at most 60 messages per batch", async (t) => {
  const { db, account, client } = await setup(t);
  for (let i = 0; i < 65; i++)
    client.add("INBOX", "Invoice", [], i % 2 ? "needle" : "other");
  await changeMailRules(db, 1, (config) => {
    config.rules = [
      rule({
        conditions: [{ field: "body", operator: "contains", value: "needle" }],
        actions: { moveTo: null, seen: null, flagged: true },
        stop: false,
      }),
      rule({}, "move"),
    ];
    config.revision++;
  });
  await startFilterJob(db, account, client, "INBOX");
  client.add("INBOX");
  assert.equal((await processMailFilters(db, account, client)).processed, 60);
  assert.equal((await loadMailRules(db, 1)).job.state, "running");
  await processMailFilters(db, account, client);
  const config = await loadMailRules(db, 1);
  assert.equal(config.job.state, "completed");
  assert.equal(config.job.processed, 65);
  assert.equal(config.job.moved, 65);
  assert.equal(client.folders.get("INBOX").messages.length, 1);
  assert.equal(
    client.folders
      .get("Invoices")
      .messages.filter((message) => message.flags.has("\\Flagged")).length,
    32,
  );
});
test("lost move replies do not duplicate mail; UID validity changes never act on reused UIDs", async (t) => {
  const { db, account, client } = await setup(t);
  await changeMailRules(db, 1, (config) => {
    config.rules = [rule()];
    config.cursor = { validity: "42", lastUid: 0 };
  });
  client.add("INBOX");
  client.lostMoveReply = true;
  await assert.rejects(
    processMailFilters(db, account, client),
    /lost move reply/,
  );
  await processMailFilters(db, account, client);
  assert.equal(client.moves.length, 1);
  client.folders.get("INBOX").validity = "43";
  client.add("INBOX");
  assert.equal(
    (await processMailFilters(db, account, client)).initialized,
    true,
  );
  assert.equal(client.moves.length, 1);
  await startFilterJob(db, account, client, "INBOX");
  client.folders.get("INBOX").validity = "44";
  await assert.rejects(
    processMailFilters(db, account, client),
    /Quellordner hat sich geändert/,
  );
  assert.equal((await loadMailRules(db, 1)).job.state, "failed");
  assert.equal(client.moves.length, 1);
});
test("folder trash moves retain the full hierarchy and remove only confirmed dependent filters", async (t) => {
  const { db, account, client } = await setup(t);
  client.add("Invoices/Child");
  await changeMailRules(db, 1, (config) => {
    config.rules = [
      rule(),
      rule(
        {
          enabled: false,
          actions: { moveTo: "Invoices/Child", seen: null, flagged: null },
        },
        "disabled-child",
      ),
      rule(
        { actions: { moveTo: "Invoices-old", seen: null, flagged: null } },
        "keep",
      ),
    ];
    config.revision++;
  });
  const plan = await folderDeletePlan(db, account, client, "Invoices");
  assert.equal(plan.subfolderCount, 1);
  assert.equal(plan.messageCount, 1);
  assert.equal(plan.filters.length, 2);
  client.renameMode = "reject";
  await assert.rejects(
    moveRemoteFolderToTrash(
      db,
      account,
      client,
      plan,
      folderTrashDestination(plan),
    ),
    /beibehalten/,
  );
  assert.equal((await loadMailRules(db, 1)).rules.length, 3);
  assert.ok(client.folders.has("Invoices/Child"));
  client.renameMode = "lost-reply";
  const destination = folderTrashDestination(plan),
    moved = await moveRemoteFolderToTrash(
      db,
      account,
      client,
      plan,
      destination,
    );
  assert.equal(moved.state, "moved");
  assert.equal(client.folders.get(destination + "/Child").messages.length, 1);
  assert.ok(!client.folders.has("Invoices"));
  assert.deepEqual(
    (await loadMailRules(db, 1)).rules.map((rule) => rule.id),
    ["keep"],
  );
  assert.equal(
    (await reconcileFolderDelete(db, account, client)).state,
    "none",
  );
  await assert.rejects(
    folderDeletePlan(db, account, client, destination),
    /bereits im Papierkorb/,
  );
});
test("unconfirmed folder operations survive reconnect and system folders cannot be deleted", async (t) => {
  const { db, account, client } = await setup(t);
  await changeMailRules(db, 1, (config) => {
    config.rules = [rule()];
  });
  const plan = await folderDeletePlan(db, account, client, "Invoices"),
    destination = folderTrashDestination(plan);
  client.renameMode = "unavailable";
  await assert.rejects(
    moveRemoteFolderToTrash(db, account, client, plan, destination),
    /Bestätigung/,
  );
  assert.equal((await loadMailRules(db, 1)).rules.length, 1);
  assert.ok((await loadMailRules(db, 1)).pendingFolder);
  delete client.list;
  assert.equal(
    (await reconcileFolderDelete(db, account, client)).state,
    "moved",
  );
  assert.equal((await loadMailRules(db, 1)).rules.length, 0);
  for (const path of ["INBOX", "Trash"])
    await assert.rejects(
      folderDeletePlan(db, account, client, path),
      /Systemordner/,
    );
  assert.deepEqual(await createRemoteFolder(db, client, "Other", "Änne"), {
    path: "Other/Änne",
  });
  await assert.rejects(createRemoteFolder(db, client, "", "../bad"));
  await assert.rejects(createRemoteFolder(db, client, "missing", "child"));
});
test("folder confirmations are single-use, session-bound and invalidated by changed filters; routes isolate owners", async (t) => {
  const { db, client } = await setup(t);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: Number(req.headers["x-user"] || 1) };
    req.sessionHash = req.headers["x-session"] || "session-a";
    next();
  });
  registerMailRuleRoutes(app, db, {
    accountFor: async (req, res) => {
      const account = await db
        .prepare("SELECT * FROM accounts WHERE id=? AND user_id=?")
        .get(req.params.id, req.user.id);
      if (!account) res.status(404).json({ error: "missing" });
      return account;
    },
    withImap: async (account, callback) => callback(client),
    kickFilters() {},
  });
  app.use((err, req, res, next) =>
    res.status(500).json({ error: err.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const request = async (path, method = "GET", body, headers = {}) => {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/accounts/1${path}`,
      {
        method,
        headers: { "Content-Type": "application/json", ...headers },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    return { status: response.status, data: await response.json() };
  };
  assert.equal(
    (await request("/filters", "GET", null, { "x-user": "2" })).status,
    404,
  );
  assert.equal(
    (await request("/folders", "POST", { name: "bad" }, { "x-user": "2" }))
      .status,
    404,
  );
  assert.equal(
    (await request("/folders/trash", "POST", { path: "Invoices" })).status,
    403,
  );
  let preview = (await request("/folders/delete-preview?path=Invoices")).data;
  assert.equal(
    (
      await request(
        "/folders/trash",
        "POST",
        { path: "Invoices", ticket: preview.ticket },
        { "x-session": "different" },
      )
    ).status,
    403,
  );
  assert.equal((await request("/filters", "POST", rule())).status, 201);
  preview = (await request("/folders/delete-preview?path=Invoices")).data;
  await changeMailRules(db, 1, (config) => {
    config.revision++;
  });
  assert.equal(
    (
      await request("/folders/trash", "POST", {
        path: "Invoices",
        ticket: preview.ticket,
      })
    ).status,
    409,
  );
  assert.ok(client.folders.has("Invoices"));
  preview = (await request("/folders/delete-preview?path=Invoices")).data;
  assert.equal(preview.filters.length, 1);
  assert.equal(
    (
      await request("/folders/trash", "POST", {
        path: "Invoices",
        ticket: preview.ticket,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/folders/trash", "POST", {
        path: "Invoices",
        ticket: preview.ticket,
      })
    ).status,
    403,
  );
  assert.equal((await request("/filters")).data.rules.length, 0);
  assert.equal(
    (await request("/filters/run", "POST", { folder: "INBOX" })).status,
    400,
  );
});
test("database restore waits for in-flight remote mutations and fences later filter writes", async (t) => {
  const { db, account, client } = await setup(t);
  client.add("INBOX");
  client.add("INBOX");
  await changeMailRules(db, 1, (config) => {
    config.rules = [rule()];
    config.cursor = { validity: "42", lastUid: 0 };
  });
  let began, release;
  const started = new Promise((resolve) => {
      began = resolve;
    }),
    paused = new Promise((resolve) => {
      release = resolve;
    });
  const move = client.messageMove.bind(client);
  client.messageMove = async (...args) => {
    began();
    await paused;
    return move(...args);
  };
  const worker = db
    .activity(() => processMailFilters(db, account, client))
    .then(
      () => null,
      (error) => error,
    );
  await started;
  let restored = false;
  const restore = db.maintenance(async () => {
    restored = true;
    await db.prepare("UPDATE users SET username='restored' WHERE id=1").run();
  });
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(restored, false);
  release();
  await restore;
  assert.match((await worker).message, /wiederhergestellt/);
  assert.equal(client.moves.length, 1);
  assert.equal(
    (await db.prepare("SELECT username FROM users WHERE id=1").get()).username,
    "restored",
  );
  assert.ok((await loadMailRules(db, 1)).pendingMessage);
  await db
    .prepare("UPDATE accounts SET imap_host='changed.example.test' WHERE id=1")
    .run();
  await assert.rejects(
    processMailFilters(db, account, client),
    /Postfachverbindung wurde geändert/,
  );
  assert.equal(client.moves.length, 1);
});
test("mailbox operation locks reject concurrent changes without queuing stale credentials", async () => {
  let release;
  const pending = mailboxOperation(
    999,
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await assert.rejects(
    mailboxOperation("999", () => {}),
    /Postfach verarbeitet/,
  );
  assert.equal(await mailboxOperation(999, () => {}, { skipBusy: true }), null);
  release();
  await pending;
  assert.equal(await mailboxOperation(999, () => 7), 7);
});
