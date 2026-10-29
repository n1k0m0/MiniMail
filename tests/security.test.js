import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("password verification stays asynchronous, bounded and compatible with stored scrypt hashes", async () => {
  const previousCwd = process.cwd();
  const temporary = await fs.mkdtemp(
    path.join(os.tmpdir(), "minimail-password-"),
  );
  process.chdir(temporary);
  try {
    const { hashPassword, verifyPassword, PasswordBusyError } =
      await import("../server/security.js");
    let yielded = false;
    setImmediate(() => {
      yielded = true;
    });
    const stored = await hashPassword("synthetic-long-password");
    assert.equal(yielded, true, "hashing leaves the event loop responsive");
    assert.equal(await verifyPassword("synthetic-long-password", stored), true);
    assert.equal(await verifyPassword("wrong-password", stored), false);
    assert.equal(await verifyPassword("wrong-password", undefined), false);
    assert.equal(await verifyPassword("x".repeat(1025), stored), false);
    const attempts = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        verifyPassword("synthetic-long-password", stored),
      ),
    );
    assert.equal(
      attempts.filter((result) => result.status === "fulfilled" && result.value)
        .length,
      4,
    );
    assert.equal(
      attempts.filter(
        (result) =>
          result.status === "rejected" &&
          result.reason instanceof PasswordBusyError,
      ).length,
      8,
    );
    const mixed = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) =>
        index % 2
          ? hashPassword("synthetic-long-password")
          : verifyPassword("synthetic-long-password", stored),
      ),
    );
    assert.equal(
      mixed.filter((result) => result.status === "fulfilled").length,
      4,
    );
    assert.ok(
      mixed
        .filter((result) => result.status === "rejected")
        .every((result) => result.reason instanceof PasswordBusyError),
    );
  } finally {
    process.chdir(previousCwd);
    await fs.rm(temporary, { recursive: true, force: true });
  }
});
