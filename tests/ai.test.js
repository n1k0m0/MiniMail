import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  aiSettings,
  saveAiSettings,
  requestAi,
  AiInputError,
  AiServiceError,
} from "../server/ai.js";

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE ai_settings (id INTEGER PRIMARY KEY, api_key_enc TEXT, model TEXT)",
  );
  return db;
}

test("AI settings encrypt the API key and responses are not stored by the provider", async () => {
  const db = database();
  saveAiSettings(db, { model: "gpt-4.1-mini", apiKey: "test-secret" });
  assert.equal(aiSettings(db).configured, true);
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
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(options.headers.Authorization, "Bearer test-secret");
      sent = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "Revised draft" }],
            },
          ],
        }),
      };
    },
  );
  assert.equal(output, "Revised draft");
  assert.equal(sent.store, false);
  assert.match(sent.input, /Make it clearer/);
  assert.ok(!JSON.stringify(sent).includes("test-secret"));
  db.close();
});

test("AI requests reject empty input and incomplete output", async () => {
  const db = database();
  saveAiSettings(db, { model: "gpt-4.1-mini", apiKey: "test-secret" });
  await assert.rejects(
    requestAi(db, { kind: "summary", text: "" }),
    AiInputError,
  );
  await assert.rejects(
    requestAi(db, { kind: "rewrite", text: "draft" }, async () => ({
      ok: true,
      json: async () => ({ status: "incomplete", output: [] }),
    })),
    AiServiceError,
  );
  db.close();
});
