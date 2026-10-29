import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { testDatabase, insertTestUser } from "./mysqlTestHelper.js";
import { encrypt, matchingTotpCounter } from "../server/security.js";
import { consumeTotp } from "../server/totp.js";
import { initializeSchema } from "../server/schema.js";

const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
function code(counter, key = Buffer.from("12345678901234567890")) {
  const input = Buffer.alloc(8);
  input.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", key).update(input).digest();
  return String(
    (digest.readUInt32BE(digest.at(-1) & 15) & 0x7fffffff) % 1000000,
  ).padStart(6, "0");
}
test("TOTP validates the skew window and refuses malformed or expired codes", () => {
  assert.equal(matchingTotpCounter(secret, code(999), 1000 * 30000), 999);
  assert.equal(matchingTotpCounter(secret, code(1001), 1000 * 30000), 1001);
  assert.equal(matchingTotpCounter(secret, code(998), 1000 * 30000), null);
  assert.equal(matchingTotpCounter(secret, "12345", 1000 * 30000), null);
});
test("TOTP replay protection persists and isolates users and newly enrolled secrets", async (t) => {
  const db = await testDatabase(t);
  await insertTestUser(db, 1);
  await insertTestUser(db, 2);
  const encrypted = encrypt(secret);
  const use = (user, counter, token = encrypted) =>
    db.transaction(async () => {
      await db.prepare("SELECT id FROM users WHERE id=? FOR UPDATE").get(user);
      return consumeTotp(db, user, token, code(counter), 1000 * 30000);
    });
  assert.deepEqual((await Promise.all([use(1, 1000), use(1, 1000)])).sort(), [
    false,
    true,
  ]);
  assert.equal(await use(2, 1000), true);
  assert.equal(await use(1, 999), false);
  assert.equal(await use(1, 1001), true);
  assert.equal(await use(1, 1001), false);
  await initializeSchema(db);
  assert.equal(
    await use(1, 1001),
    false,
    "schema initialization keeps replay state",
  );
  assert.equal(
    (
      await db
        .prepare("SELECT last_counter FROM auth_totp_state WHERE user_id=1")
        .get()
    ).last_counter,
    1001,
  );
  // Re-enrollment changes the secret fingerprint without deleting replay rows.
  await db.transaction(async () => {
    await db.prepare("SELECT id FROM users WHERE id=1 FOR UPDATE").get();
    assert.equal(
      await consumeTotp(
        db,
        1,
        encrypt("JBSWY3DPEHPK3PXP"),
        code(1000, Buffer.from("48656c6c6f21deadbeef", "hex")),
        1000 * 30000,
      ),
      true,
    );
  });
});
