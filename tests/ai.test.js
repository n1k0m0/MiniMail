import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase, insertTestUser } from "./mysqlTestHelper.js";
import {
  aiSettings,
  rewriteContext,
  saveAiSettings,
  requestAi,
  AiInputError,
  AiServiceError,
} from "../server/ai.js";
test("AI requests use only the configured self-hosted chat endpoint", async (t) => {
  const db = await testDatabase(t);
  await saveAiSettings(db, {
    baseUrl: "https://ai.example.test/v1",
    model: "local/model-1:latest",
    apiKey: "test-secret",
  });
  assert.equal((await aiSettings(db)).configured, true);
  assert.equal((await aiSettings(db)).hasKey, true);
  assert.equal((await aiSettings(db)).rewriteMaxTokens, 8192);
  assert.equal((await aiSettings(db)).summaryMaxTokens, 4096);
  assert.equal(
    JSON.stringify(await aiSettings(db)).includes("test-secret"),
    false,
  );
  assert.notEqual(
    (await db.prepare("SELECT api_key_enc FROM ai_settings WHERE id=1").get())
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
        sender: {
          email: "sender@example.test",
          name: "Sam",
        },
        recipients: [
          {
            role: "to",
            email: "alex@example.test",
            name: "Alex",
          },
        ],
        subject: "Meeting",
        signatureWillBeAppended: true,
      },
    },
    async (url, options) => {
      assert.equal(url, "https://ai.example.test/v1/chat/completions");
      assert.equal(options.headers.Authorization, "Bearer test-secret");
      assert.equal(options.redirect, "error");
      sent = JSON.parse(options.body);
      return Response.json({
        choices: [
          {
            message: {
              content: "Revised draft",
            },
            finish_reason: "stop",
          },
        ],
      });
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
  await db.close();
});
test("AI requests reject empty input and incomplete output", async (t) => {
  const db = await testDatabase(t);
  await saveAiSettings(db, {
    baseUrl: "http://host.docker.internal:11434/v1",
    model: "llama3",
  });
  await assert.rejects(
    requestAi(db, {
      kind: "summary",
      text: "",
    }),
    AiInputError,
  );
  await assert.rejects(
    requestAi(
      db,
      {
        kind: "rewrite",
        text: "draft",
      },
      async () =>
        Response.json({
          choices: [
            {
              message: {
                content: "partial",
              },
              finish_reason: "length",
            },
          ],
        }),
    ),
    {
      name: "Error",
      message:
        "KI-Ausgabelimit erreicht. Prüfe das Tokenlimit in den KI-Einstellungen oder auf deinem Server.",
    },
  );
  await requestAi(
    db,
    {
      kind: "summary",
      text: "Message",
    },
    async (_url, options) => {
      assert.equal(JSON.parse(options.body).max_tokens, 4096);
      return Response.json({
        choices: [
          {
            message: {
              content: "Summary",
            },
            finish_reason: "stop",
          },
        ],
      });
    },
  );
  await db.close();
});
test("changing the endpoint never reuses its previous key", async (t) => {
  const db = await testDatabase(t);
  await saveAiSettings(db, {
    baseUrl: "https://first.example.test/v1",
    model: "local",
    apiKey: "first-key",
  });
  await saveAiSettings(db, {
    baseUrl: "https://second.example.test/v1",
    model: "local",
  });
  assert.equal((await aiSettings(db)).hasKey, false);
  await requestAi(
    db,
    {
      kind: "summary",
      text: "Hello",
    },
    async (url, options) => {
      assert.equal(url, "https://second.example.test/v1/chat/completions");
      assert.equal(options.headers.Authorization, undefined);
      return Response.json({
        choices: [
          {
            message: {
              content: "Hi",
            },
            finish_reason: "stop",
          },
        ],
      });
    },
  );
  await db.close();
});
test("commercial and public HTTP endpoints are rejected", async (t) => {
  const db = await testDatabase(t);
  for (const baseUrl of [
    "https://api.openai.com/v1",
    "https://openrouter.ai/api/v1",
    "http://example.test/v1",
    "https://user:pass@ai.example.test/v1",
    "https://ai.example.test/v1?token=x",
  ]) {
    await assert.rejects(
      async () =>
        await saveAiSettings(db, {
          baseUrl,
          model: "local",
        }),
      AiInputError,
    );
  }
  assert.equal((await aiSettings(db)).configured, false);
  await db.close();
});
test("rewrite and summary token limits can be set separately or omitted", async (t) => {
  const db = await testDatabase(t);
  await saveAiSettings(db, {
    baseUrl: "https://ai.example.test/v1",
    model: "local",
    rewriteMaxTokens: 12000,
    summaryMaxTokens: 2000,
  });
  assert.equal((await aiSettings(db)).rewriteMaxTokens, 12000);
  assert.equal((await aiSettings(db)).summaryMaxTokens, 2000);
  const fetcher = async (_url, options) => {
    assert.equal(JSON.parse(options.body).max_tokens, 12000);
    return Response.json({
      choices: [
        {
          message: {
            content: "Draft",
          },
          finish_reason: "stop",
        },
      ],
    });
  };
  await requestAi(
    db,
    {
      kind: "rewrite",
      text: "Hello",
    },
    fetcher,
  );
  await saveAiSettings(db, {
    baseUrl: "https://ai.example.test/v1",
    model: "local",
    rewriteMaxTokens: null,
    summaryMaxTokens: null,
  });
  assert.equal((await aiSettings(db)).rewriteMaxTokens, null);
  assert.equal((await aiSettings(db)).summaryMaxTokens, null);
  await saveAiSettings(db, {
    baseUrl: "https://ai.example.test/v1",
    model: "local",
  });
  assert.equal((await aiSettings(db)).rewriteMaxTokens, null);
  assert.equal((await aiSettings(db)).summaryMaxTokens, null);
  await requestAi(
    db,
    {
      kind: "summary",
      text: "Hello",
    },
    async (_url, options) => {
      assert.equal(
        Object.hasOwn(JSON.parse(options.body), "max_tokens"),
        false,
      );
      return Response.json({
        choices: [
          {
            message: {
              content: "Summary",
            },
            finish_reason: "stop",
          },
        ],
      });
    },
  );
  for (const invalid of [0, -1, 1.5, "1000", Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      async () =>
        await saveAiSettings(db, {
          baseUrl: "https://ai.example.test/v1",
          model: "local",
          rewriteMaxTokens: invalid,
        }),
      AiInputError,
    );
  }
  await db.close();
});
test("rewrite context uses the selected sender, contact names and reply names without Bcc", async (t) => {
  const db = await testDatabase(t);
  await insertTestUser(db, 7);
  await db
    .prepare(
      "INSERT INTO accounts (id,user_id,email,name,sender_name,signature,imap_host,imap_port,imap_secure,smtp_host,smtp_port,smtp_secure,username,password_enc,created_at) VALUES (1,7,?,?,?,?, 'imap.example.test',993,1,'smtp.example.test',465,1,'test','encrypted',1)",
    )
    .run(
      "sam@example.test",
      "Work account",
      "Sam Sender",
      "Sam Sender\nCompany",
    );
  await db
    .prepare(
      "INSERT INTO contacts (user_id,email,name,created_at,updated_at) VALUES (7,?,?,1,1)",
    )
    .run("alice@example.test", "Alice Contact");
  const context = await rewriteContext(db, 7, {
    senderAccountId: 1,
    to: "alice@example.test, bob@example.test",
    cc: "Carol Typed <carol@example.test>",
    bcc: "secret@example.test",
    subject: "Project update",
    recipientNameHints: [
      {
        name: "Bob Reply",
        address: "bob@example.test",
      },
    ],
  });
  assert.deepEqual(context, {
    sender: {
      email: "sam@example.test",
      name: "Sam Sender",
    },
    recipients: [
      {
        role: "to",
        email: "alice@example.test",
        name: "Alice Contact",
      },
      {
        role: "to",
        email: "bob@example.test",
        name: "Bob Reply",
      },
      {
        role: "cc",
        email: "carol@example.test",
        name: "Carol Typed",
      },
    ],
    subject: "Project update",
    signatureWillBeAppended: true,
  });
  assert.equal(JSON.stringify(context).includes("secret@example.test"), false);
  await assert.rejects(
    async () =>
      await rewriteContext(db, 8, {
        senderAccountId: 1,
      }),
    AiInputError,
  );
  await db.close();
});
