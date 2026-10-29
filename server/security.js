import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve("data");
fs.mkdirSync(dataDir, { recursive: true });
const keyFile = path.join(dataDir, "secret.key");
let keyHex = process.env.APP_ENCRYPTION_KEY;
if (!keyHex) {
  if (process.env.NODE_ENV === "production")
    throw new Error("APP_ENCRYPTION_KEY must be set in production");
  if (!fs.existsSync(keyFile))
    fs.writeFileSync(keyFile, crypto.randomBytes(32).toString("hex"), {
      mode: 0o600,
    });
  keyHex = fs.readFileSync(keyFile, "utf8").trim();
}
if (!/^[a-f0-9]{64}$/i.test(keyHex))
  throw new Error("APP_ENCRYPTION_KEY must be 64 hex characters");
const key = Buffer.from(keyHex, "hex");

export function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}
export function decrypt(value) {
  const raw = Buffer.from(value, "base64");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    raw.subarray(0, 12),
  );
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([
    decipher.update(raw.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}
export class PasswordBusyError extends Error {}
let passwordChecks = 0;
export async function verifyPassword(password, stored) {
  if (typeof password !== "string" || password.length > 1024) return false;
  if (passwordChecks >= 4) throw new PasswordBusyError("Password checks busy");
  const validStored = /^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(String(stored));
  const [salt, expected] = validStored
    ? stored.split(":")
    : ["00".repeat(16), "00".repeat(64)];
  passwordChecks++;
  try {
    const actual = await new Promise((resolve, reject) => {
      crypto.scrypt(password, Buffer.from(salt, "hex"), 64, (error, key) =>
        error ? reject(error) : resolve(key),
      );
    });
    return (
      validStored &&
      crypto.timingSafeEqual(actual, Buffer.from(expected, "hex"))
    );
  } finally {
    passwordChecks--;
  }
}
export function randomToken() {
  return crypto.randomBytes(32).toString("base64url");
}
export function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function newTotpSecret() {
  const bytes = crypto.randomBytes(20);
  let bits = 0,
    value = 0,
    result = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits -= 5)) & 31];
    }
  }
  return result;
}
function base32Decode(input) {
  let bits = 0,
    value = 0;
  const bytes = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const n = alphabet.indexOf(char);
    if (n < 0) throw new Error("Invalid TOTP secret");
    value = (value << 5) | n;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits -= 8)) & 255);
    }
  }
  return Buffer.from(bytes);
}
export function verifyTotp(secret, code, now = Date.now()) {
  if (!/^\d{6}$/.test(String(code))) return false;
  const secretBytes = base32Decode(secret);
  for (let offset = -1; offset <= 1; offset++) {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(now / 30000) + offset));
    const digest = crypto
      .createHmac("sha1", secretBytes)
      .update(counter)
      .digest();
    const position = digest.at(-1) & 15;
    const value = (digest.readUInt32BE(position) & 0x7fffffff) % 1000000;
    if (
      crypto.timingSafeEqual(
        Buffer.from(String(value).padStart(6, "0")),
        Buffer.from(String(code)),
      )
    )
      return true;
  }
  return false;
}
