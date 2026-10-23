import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  aiSettings,
  initializeAiSettings,
  rewriteContext,
  saveAiSettings,
  requestAi,
  AiInputError,
  AiServiceError,
} from "../server/ai.js";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE ai_settings (id INTEGER PRIMARY KEY, base_url TEXT NOT NULL DEFAULT '', api_key_enc TEXT, model TEXT NOT NULL DEFAULT '', rewrite_max_tokens INTEGER DEFAULT 8192, summary_max_tokens INTEGER DEFAULT 4096)",
  );
  return db;
}

test("AI requests use only the configured self-hosted chat endpoint", async () => {
  const db = database();
  saveAiSettings(db, {
    baseUrl: "https://ai.example.test/v1",
    model: "local/model-1:latest",
    apiKey: "test-secret",
  });
  assert.equal(aiSettings(db).configured, true);
  assert.equal(aiSettings(db).hasKey, true);
  assert.equal(aiSettings(db).rewriteMaxTokens, 8192);
  assert.equal(aiSettings(db).summaryMaxTokens, 4096);
  assert.equal(JSON.stringify(aiSettings(db)).includes("test-secret"), false);
  assert.notEqual(
    db.prepare("SELECT api_key_enc FROM ai_settings WHERE id=1").get()
      .api_key_enc,
    "test-secret",
  );
  let sent;
  const output = await requestAi(
    db,
    {
      kind: "rewrite",
      text: "Original draft",
      instructions: "Make it clearer",
      language: "en",
      context: {
        sender: { email: "sender@example.test", name: "Sam" },
        recipients: [{ role: "to", email: "alex@example.test", name: "Alex" }],
        subject: "Meeting",
        signatureWillBeAppended: true,
      },
    },
    async (url, options) => {
      assert.equal(url, "https://ai.example.test/v1/chat/completions");
      assert.equal(options.headers.Authorization, "Bearer test-secret");
      assert.equal(options.redirect, "error");
      sent = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          choices: [
            { message: { content: "Revised draft" }, finish_reason: "stop" },
          ],
        }),
      };
    },
  );
  assert.equal(output, "Revised draft");
  assert.equal(sent.model, "local/model-1:latest");
  assert.equal(sent.max_tokens, 8192);
  assert.equal(sent.store, undefined);
  assert.match(sent.messages[1].content, /Make it clearer/);
  assert.match(sent.messages[0].content, /salutation and closing phrase/);
  assert.match(sent.messages[0].content, /logical paragraphs/);
  assert.match(sent.messages[0].content, /do not repeat the sender's name/);
  assert.match(sent.messages[1].content, /sender@example\.test/);
  assert.match(sent.messages[1].content, /alex@example\.test/);
  assert.match(sent.messages[1].content, /"name":"Alex"/);
  assert.ok(!JSON.stringify(sent).includes("test-secret"));
  db.close();
});

test("AI requests reject empty input and incomplete output", async () => {
  const db = database();
  saveAiSettings(db, {
    baseUrl: "http://host.docker.internal:11434/v1",
    model: "llama3",
  });
  await assert.rejects(
    requestAi(db, { kind: "summary", text: "" }),
    AiInputError,
  );
  await assert.rejects(
    requestAi(db, { kind: "rewrite", text: "draft" }, async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "partial" }, finish_reason: "length" }],
      }),
    })),
    {
      name: "Error",
      message:
        "KI-Ausgabelimit erreicht. Prüfe das Tokenlimit in den KI-Einstellungen oder auf deinem Server.",
    },
  );
  await requestAi(
    db,
    { kind: "summary", text: "Message" },
    async (_url, options) => {
      assert.equal(JSON.parse(options.body).max_tokens, 4096);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Summary" }, finish_reason: "stop" }],
        }),
      };
    },
  );
  db.close();
});

test("legacy commercial key is cleared on migration", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE ai_settings (id INTEGER PRIMARY KEY, api_key_enc TEXT, model TEXT)",
  );
  db.prepare("INSERT INTO ai_settings VALUES (1,?,?)").run(
    "old-key",
    "gpt-4.1-mini",
  );
  initializeAiSettings(db);
  assert.deepEqual(aiSettings(db), {
    configured: false,
    baseUrl: "",
    model: "",
    hasKey: false,
    rewriteMaxTokens: 8192,
    summaryMaxTokens: 4096,
  });
  db.close();
});

test("changing the endpoint never reuses its previous key", async () => {
  const db = database();
  saveAiSettings(db, {
    baseUrl: "https://first.example.test/v1",
    model: "local",
    apiKey: "first-key",
  });
  saveAiSettings(db, {
    baseUrl: "https://second.example.test/v1",
    model: "local",
  });
  assert.equal(aiSettings(db).hasKey, false);
  await requestAi(
    db,
    { kind: "summary", text: "Hello" },
    async (url, options) => {
      assert.equal(url, "https://second.example.test/v1/chat/completions");
      assert.equal(options.headers.Authorization, undefined);
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Hi" }, finish_reason: "stop" }],
        }),
      };
    },
  );
  db.close();
});

test("commercial and public HTTP endpoints are rejected", () => {
  const db = database();
  for (const baseUrl of [
    "https://api.openai.com/v1",
    "https://openrouter.ai/api/v1",
    "http://example.test/v1",
    "https://user:pass@ai.example.test/v1",
    "https://ai.example.test/v1?token=x",
  ]) {
    assert.throws(
      () => saveAiSettings(db, { baseUrl, model: "local" }),
      AiInputError,
    );
  }
  assert.equal(aiSettings(db).configured, false);
  db.close();
});

test("rewrite and summary token limits can be set separately or omitted", async () => {
  const db = database();
  saveAiSettings(db, {
    baseUrl: "https://ai.example.test/v1",
    model: "local",
    rewriteMaxTokens: 12000,
    summaryMaxTokens: 2000,
  });
  assert.equal(aiSettings(db).rewriteMaxTokens, 12000);
  assert.equal(aiSettings(db).summaryMaxTokens, 2000);
  const fetcher = async (_url, options) => {
    assert.equal(JSON.parse(options.body).max_tokens, 12000);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "Draft" }, finish_reason: "stop" }],
      }),
    };
  };
  await requestAi(db, { kind: "rewrite", text: "Hello" }, fetcher);
  saveAiSettings(db, {
    baseUrl: "https://ai.example.test/v1",
    model: "local",
    rewriteMaxTokens: null,
    summaryMaxTokens: null,
  });
  assert.equal(aiSettings(db).rewriteMaxTokens, null);
  assert.equal(aiSettings(db).summaryMaxTokens, null);
  saveAiSettings(db, { baseUrl: "https://ai.example.test/v1", model: "local" });
  assert.equal(aiSettings(db).rewriteMaxTokens, null);
  assert.equal(aiSettings(db).summaryMaxTokens, null);
  await requestAi(
    db,
    { kind: "summary", text: "Hello" },
    async (_url, options) => {
      assert.equal(
        Object.hasOwn(JSON.parse(options.body), "max_tokens"),
        false,
      );
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "Summary" }, finish_reason: "stop" }],
        }),
      };
    },
  );
  for (const invalid of [0, -1, 1.5, "1000", Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () =>
        saveAiSettings(db, {
          baseUrl: "https://ai.example.test/v1",
          model: "local",
          rewriteMaxTokens: invalid,
        }),
      AiInputError,
    );
  }
  db.close();
});

test("existing self-hosted AI settings receive token defaults without losing their key", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE ai_settings (id INTEGER PRIMARY KEY, base_url TEXT NOT NULL, api_key_enc TEXT, model TEXT NOT NULL)",
  );
  db.prepare("INSERT INTO ai_settings VALUES (1,?,?,?)").run(
    "https://ai.example.test/v1",
    "encrypted-key",
    "local",
  );
  initializeAiSettings(db);
  assert.deepEqual(aiSettings(db), {
    configured: true,
    baseUrl: "https://ai.example.test/v1",
    model: "local",
    hasKey: true,
    rewriteMaxTokens: 8192,
    summaryMaxTokens: 4096,
  });
  db.close();
});

test("rewrite context uses the selected sender, contact names and reply names without Bcc", () => {
  const db = database();
  db.exec(
    "CREATE TABLE accounts (id INTEGER PRIMARY KEY, user_id INTEGER, email TEXT, name TEXT, sender_name TEXT, signature TEXT)",
  );
  db.exec(
    "CREATE TABLE contacts (user_id INTEGER, email TEXT COLLATE NOCASE, name TEXT)",
  );
  db.prepare("INSERT INTO accounts VALUES (1, 7, ?, ?, ?, ?)").run(
    "sam@example.test",
    "Work account",
    "Sam Sender",
    "Sam Sender\nCompany",
  );
  db.prepare("INSERT INTO contacts VALUES (7, ?, ?)").run(
    "alice@example.test",
    "Alice Contact",
  );
  const context = rewriteContext(db, 7, {
    senderAccountId: 1,
    to: "alice@example.test, bob@example.test",
    cc: "Carol Typed <carol@example.test>",
    bcc: "secret@example.test",
    subject: "Project update",
    recipientNameHints: [{ name: "Bob Reply", address: "bob@example.test" }],
  });
  assert.deepEqual(context, {
    sender: { email: "sam@example.test", name: "Sam Sender" },
    recipients: [
      { role: "to", email: "alice@example.test", name: "Alice Contact" },
      { role: "to", email: "bob@example.test", name: "Bob Reply" },
      { role: "cc", email: "carol@example.test", name: "Carol Typed" },
    ],
    subject: "Project update",
    signatureWillBeAppended: true,
  });
  assert.equal(JSON.stringify(context).includes("secret@example.test"), false);
  assert.throws(
    () => rewriteContext(db, 8, { senderAccountId: 1 }),
    AiInputError,
  );
  db.close();
});
