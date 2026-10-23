import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  aiSettings,
  initializeAiSettings,
  saveAiSettings,
  requestAi,
  AiInputError,
  AiServiceError,
} from "../server/ai.js";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE ai_settings (id INTEGER PRIMARY KEY, base_url TEXT NOT NULL DEFAULT '', api_key_enc TEXT, model TEXT NOT NULL DEFAULT '')",
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
  assert.equal(sent.store, undefined);
  assert.match(sent.messages[1].content, /Make it clearer/);
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
    AiServiceError,
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
