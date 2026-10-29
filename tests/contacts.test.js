import test from "node:test";
import assert from "node:assert/strict";
import { testDatabase, insertTestUser } from "./mysqlTestHelper.js";
import { collectSentRecipients, parseRecipients } from "../server/contacts.js";
import { replyRecipients } from "../src/replyRecipients.js";
test("reply all respects Reply-To, omits own identities, and deduplicates", () => {
  const message = {
    from: [
      {
        address: "sender@example.test",
      },
    ],
    replyTo: [
      {
        address: "reply@example.test",
      },
    ],
    to: [
      {
        address: "me@example.test",
      },
      {
        address: "friend@example.test",
      },
    ],
    cc: [
      {
        address: "alias@example.test",
      },
      {
        address: "friend@example.test",
      },
    ],
  };
  assert.deepEqual(
    replyRecipients(message, ["me@example.test", "alias@example.test"], true),
    {
      to: "reply@example.test",
      cc: "friend@example.test",
    },
  );
  assert.deepEqual(replyRecipients(message, ["me@example.test"], false), {
    to: "reply@example.test",
    cc: "",
  });
});
test("sent recipient collection includes To, Cc, Bcc once and skips own identities", async (t) => {
  const db = await testDatabase(t);
  await insertTestUser(db);
  const mail = {
    to: "Alice <alice@example.test>, me@example.test",
    cc: "alice@example.test, Bob <bob@example.test>",
    bcc: "Hidden <hidden@example.test>",
  };
  assert.equal(parseRecipients([mail.to, mail.cc, mail.bcc]).length, 5);
  await collectSentRecipients(db, 1, mail, ["me@example.test"]);
  await collectSentRecipients(db, 1, mail, ["me@example.test"]);
  const contacts = (
    await db
      .prepare("SELECT name,email FROM contacts WHERE user_id=1 ORDER BY email")
      .all()
  ).map((item) => ({
    ...item,
  }));
  assert.deepEqual(contacts, [
    {
      name: "Alice",
      email: "alice@example.test",
    },
    {
      name: "Bob",
      email: "bob@example.test",
    },
    {
      name: "Hidden",
      email: "hidden@example.test",
    },
  ]);
  await db.close();
});
