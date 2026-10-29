import test from "node:test";
import assert from "node:assert/strict";
import * as pgp from "openpgp";
import * as boundedPgp from "../server/openpgp.js";

test("highly compressed encrypted mail is rejected before unbounded expansion", async () => {
  const passwords = ["synthetic-test-password"];
  const armored = await pgp.encrypt({
    message: await pgp.createMessage({
      binary: new Uint8Array(boundedPgp.maxDecompressedMessageSize + 1024),
    }),
    passwords,
    config: {
      preferredCompressionAlgorithm: pgp.enums.compression.zlib,
      s2kIterationCountByte: 0,
    },
  });
  assert.ok(
    armored.length < 100000,
    "small encrypted input expands beyond the configured cap",
  );
  await assert.rejects(
    async () =>
      boundedPgp.decrypt({
        message: await boundedPgp.readMessage({ armoredMessage: armored }),
        passwords,
        format: "binary",
      }),
    /Maximum decompressed message size exceeded/,
  );
  assert.equal(
    pgp.config.maxDecompressedMessageSize,
    Infinity,
    "no mutation of shared library configuration",
  );
});
test("compressed mail below the cap still decrypts normally", async () => {
  const text = "Synthetic body\n".repeat(1000),
    passwords = ["synthetic-test-password"];
  const armored = await pgp.encrypt({
    message: await pgp.createMessage({ text }),
    passwords,
    config: {
      preferredCompressionAlgorithm: pgp.enums.compression.zlib,
      s2kIterationCountByte: 0,
    },
  });
  const result = await boundedPgp.decrypt({
    message: await boundedPgp.readMessage({ armoredMessage: armored }),
    passwords,
  });
  assert.equal(result.data, text);
});
