import assert from "node:assert/strict";
import test from "node:test";
import { highlightMailSource } from "../src/mailSourceHighlight.js";

test("highlights folded MIME headers, boundaries and HTML without changing source", () => {
  const source = [
    "Content-Type: multipart/mixed;\r\n",
    ' boundary="part-123"\r\n',
    "Subject: Example\r\n",
    "\r\n",
    "--part-123\r\n",
    "Content-Type: text/html\r\n",
    "\r\n",
    '<p title="safe">Hello &amp; goodbye</p>\r\n',
    "--part-123--\r\n",
  ].join("");
  const tokens = highlightMailSource(source);

  assert.equal(tokens.map(({ text }) => text).join(""), source);
  assert.deepEqual(
    tokens.filter(({ type }) => type === "boundary").map(({ text }) => text),
    ["--part-123", "--part-123--"],
  );
  assert.ok(
    tokens.some(
      ({ text, type }) => text === "Content-Type" && type === "header",
    ),
  );
  assert.ok(
    tokens.some(({ text, type }) => text.includes("<p") && type === "markup"),
  );
});

test("distinguishes encoded message data and preserves line endings", () => {
  const source = "Content-Transfer-Encoding: base64\n\nSGVsbG8=\n";
  const tokens = highlightMailSource(source);
  assert.equal(tokens.map(({ text }) => text).join(""), source);
  assert.ok(
    tokens.some(({ text, type }) => text === "SGVsbG8=" && type === "encoded"),
  );
});
