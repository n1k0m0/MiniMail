import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeReferences,
  outgoingMailError,
  validOutgoingMail,
} from "../server/mailInput.js";

const mail = (extra = {}) => ({
  to: "receiver@example.test",
  text: "A synthetic reply",
  ...extra,
});

test("reply-all accepts comma-joined reference IDs without losing the thread", () => {
  const reply = mail({
    inReplyTo: "<parent@example.test>",
    references: [
      "<root@example.test>",
      "<one@example.test>,<two@example.test>",
      "<parent@example.test>",
    ],
  });
  assert.equal(validOutgoingMail(reply), true);
  assert.deepEqual(reply.references, [
    "<root@example.test>",
    "<one@example.test>",
    "<two@example.test>",
    "<parent@example.test>",
  ]);
});

test("reference normalization does not admit header injection or arbitrary header text", () => {
  for (const value of [
    "<id@example.test>\r\nBcc: hidden@example.test",
    "<id@example.test>bad",
    "invalid header",
    "<bad\u0000id>",
  ]) {
    const error = outgoingMailError(mail({ references: [value] }));
    assert.match(error, /Referenzkennungen/);
  }
  assert.deepEqual(
    normalizeReferences([
      "<one@example.test> <two@example.test>",
      "<one@example.test>",
    ]),
    ["<one@example.test>", "<two@example.test>"],
  );
});

test("validation identifies the failing field and supports unfinished drafts", () => {
  assert.match(outgoingMailError(mail({ cc: "not an address" })), /Cc/);
  assert.match(
    outgoingMailError(mail({ to: "receiver@example.test, broken" })),
    /An/,
  );
  assert.match(
    outgoingMailError(mail({ subject: "bad\r\nSubject: injection" })),
    /Betreff/,
  );
  assert.match(outgoingMailError(mail({ text: "x".repeat(500001) })), /500000/);
  assert.equal(
    validOutgoingMail(mail({ to: '"Last, First" <receiver@example.test>' })),
    true,
  );
  assert.equal(
    validOutgoingMail(mail({ to: "", cc: "receiver@example.test" })),
    true,
  );
  assert.equal(
    validOutgoingMail(mail({ to: "unfinished", text: "" }), { draft: true }),
    true,
  );
  assert.match(
    outgoingMailError(mail({ attachments: [{ name: "a.txt", data: "???=" }] })),
    /Anhang/,
  );
  assert.equal(
    validOutgoingMail(
      mail({
        attachments: [
          {
            name: "large.bin",
            data: Buffer.alloc(8 * 1024 * 1024).toString("base64"),
          },
        ],
      }),
    ),
    true,
  );
});
