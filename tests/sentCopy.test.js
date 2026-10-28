import test from "node:test";
import assert from "node:assert/strict";
import { saveSentCopy } from "../server/sentCopy.js";

test("Sent copy succeeds only after IMAP confirms APPEND", async () => {
  let calls = 0;
  const raw = Buffer.from("Subject: test\r\n\r\nhello");
  const result = await saveSentCopy(
    async (callback) =>
      callback({
        list: async () => [{ path: "Gesendet", specialUse: "\\Sent" }],
        append: async (folder, message, flags) => {
          calls++;
          assert.equal(folder, "Gesendet");
          assert.equal(message, raw);
          assert.deepEqual(flags, ["\\Seen"]);
          return { uid: 42 };
        },
      }),
    async () => raw,
  );
  assert.equal(calls, 1);
  assert.deepEqual(result, { saved: true });
});

test("missing Sent folder and failed APPEND preserve SMTP success with copy status", async () => {
  for (const failure of [
    "missing",
    "rejected",
    "throws",
    "connection",
    "raw",
  ]) {
    let generated = false;
    const result = await saveSentCopy(
      async (callback) => {
        if (failure === "connection") throw new Error("IMAP unavailable");
        return callback({
          list: async () =>
            failure === "missing" ? [] : [{ name: "Sent", path: "Sent" }],
          append: async () => {
            if (failure === "throws") throw new Error("IMAP APPEND denied");
            return failure === "rejected" ? false : {};
          },
        });
      },
      async () => {
        generated = true;
        if (failure === "raw") throw new Error("MIME generation failed");
        return Buffer.from("mail");
      },
    );
    assert.deepEqual(result, {
      saved: false,
      reason: failure === "missing" ? "folder-missing" : "append-failed",
    });
    if (failure === "missing") assert.equal(generated, false);
  }
});
