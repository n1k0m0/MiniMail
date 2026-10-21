import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as openpgp from "openpgp";

const exec = promisify(execFile);
const originalCwd = process.cwd();
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "minimail-crypto-test-"));
process.chdir(temp);
process.env.OPENSSL_BIN ||=
  process.platform === "win32"
    ? "C:\\Program Files\\Git\\usr\\bin\\openssl.exe"
    : "openssl";
const { db } = await import("../server/db.js");
const { encrypt } = await import("../server/security.js");
const { protectOutgoing, inspectIncoming, encryptionAvailability } =
  await import("../server/protectedMail.js");
const { readPkcs12, validateSmimeIdentity } =
  await import("../server/cryptoKeys.js");
db.prepare(
  "INSERT INTO users (id,username,password_hash,created_at) VALUES (1,'owner','test',1)",
).run();

const outgoing = (from, to, text) => ({
  from: { name: "Sender", address: from },
  to,
  subject: "Protected mail",
  text,
});

test("OpenPGP signed and encrypted mail round-trips with authenticated content", async () => {
  const alice = await openpgp.generateKey({
    type: "ecc",
    curve: "curve25519",
    userIDs: [{ name: "Alice", email: "alice@example.test" }],
  });
  const bob = await openpgp.generateKey({
    type: "ecc",
    curve: "curve25519",
    userIDs: [{ name: "Bob", email: "bob@example.test" }],
  });
  db.prepare(
    "INSERT INTO contacts (user_id,name,email,source,created_at,updated_at,pgp_public) VALUES (?,?,?,?,?,?,?)",
  ).run(1, "Bob", "bob@example.test", "manual", 1, 1, bob.publicKey);
  db.prepare(
    "INSERT INTO contacts (user_id,name,email,source,created_at,updated_at,pgp_public) VALUES (?,?,?,?,?,?,?)",
  ).run(1, "Alice", "alice@example.test", "manual", 1, 1, alice.publicKey);
  const account = {
    id: 1,
    user_id: 1,
    email: "alice@example.test",
    pgp_private_enc: encrypt(alice.privateKey),
    pgp_passphrase_enc: encrypt(""),
  };
  const mail = {
    to: "bob@example.test",
    cc: "",
    bcc: "bob@example.test",
    crypto: { mode: "pgp", sign: true, encrypt: true },
  };
  const message = {
    ...outgoing(account.email, mail.to, "Secret PGP body"),
    bcc: mail.bcc,
    attachments: [
      { filename: "note.txt", content: Buffer.from("Attachment secret") },
    ],
  };
  const protectedMessage = await protectOutgoing(account, mail, message);
  assert.match(protectedMessage.smtpRaw.toString(), /multipart\/encrypted/);
  assert.doesNotMatch(protectedMessage.smtpRaw.toString(), /Secret PGP body/);
  assert.doesNotMatch(protectedMessage.smtpRaw.toString(), /^Bcc:/m);
  assert.match(protectedMessage.sentRaw.toString(), /^Bcc:/m);
  const decoded = await inspectIncoming(account, protectedMessage.sentRaw);
  assert.equal(decoded.parsed.text.trim(), "Secret PGP body");
  assert.equal(
    decoded.parsed.attachments[0].content.toString(),
    "Attachment secret",
  );
  assert.equal(decoded.security.encrypted, true);
  assert.equal(decoded.security.signature, "valid");

  const signed = await protectOutgoing(
    account,
    { ...mail, crypto: { mode: "pgp", sign: true, encrypt: false } },
    outgoing(account.email, mail.to, "Signed PGP body"),
  );
  const verified = await inspectIncoming(account, signed.sentRaw);
  assert.equal(verified.parsed.text.trim(), "Signed PGP body");
  assert.equal(verified.security.signature, "valid");
  const autoEncrypted = await protectOutgoing(
    account,
    { ...mail, crypto: { mode: "pgp", sign: true, encrypt: "auto" } },
    outgoing(account.email, mail.to, "Automatic PGP encryption"),
  );
  assert.match(autoEncrypted.smtpRaw.toString(), /multipart\/encrypted/);
  assert.deepEqual(await encryptionAvailability(account, mail), {
    available: true,
  });
  const autoSigned = await protectOutgoing(
    account,
    {
      ...mail,
      cc: "missing@example.test",
      crypto: { mode: "pgp", sign: true, encrypt: "auto" },
    },
    outgoing(account.email, mail.to, "Automatic signing fallback"),
  );
  assert.match(autoSigned.smtpRaw.toString(), /multipart\/signed/);
  assert.doesNotMatch(autoSigned.smtpRaw.toString(), /multipart\/encrypted/);
  assert.deepEqual(
    (
      await encryptionAvailability(account, {
        ...mail,
        cc: "missing@example.test",
      })
    ).missing,
    ["missing@example.test"],
  );
  const noProtection = await protectOutgoing(
    account,
    {
      ...mail,
      bcc: "missing@example.test",
      crypto: { mode: "pgp", sign: false, encrypt: "auto" },
    },
    outgoing(account.email, mail.to, "No available encryption"),
  );
  assert.equal(noProtection, null);
  await assert.rejects(
    protectOutgoing(
      account,
      { ...mail, to: "missing@example.test" },
      outgoing(account.email, "missing@example.test", "secret"),
    ),
    /fehlt/,
  );
  const inlineCiphertext = await openpgp.encrypt({
    message: await openpgp.createMessage({ text: "Inline secret" }),
    encryptionKeys: await openpgp.readKey({ armoredKey: alice.publicKey }),
  });
  const inline = await inspectIncoming(
    account,
    Buffer.from(
      `From: Alice <alice@example.test>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${inlineCiphertext}`,
    ),
  );
  assert.equal(inline.parsed.text.trim(), "Inline secret");
  const clearSigned = await openpgp.sign({
    message: await openpgp.createCleartextMessage({ text: "Inline signed" }),
    signingKeys: await openpgp.readPrivateKey({ armoredKey: alice.privateKey }),
  });
  const clear = await inspectIncoming(
    account,
    Buffer.from(
      `From: Alice <alice@example.test>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${clearSigned}`,
    ),
  );
  assert.equal(clear.parsed.text.trim(), "Inline signed");
  assert.equal(clear.security.signature, "valid");
});

test("S/MIME signed and encrypted mail round-trips without exposing plaintext", async () => {
  const makeCertificate = async (name) => {
    const key = path.join(temp, `${name}-key.pem`);
    const cert = path.join(temp, `${name}-cert.pem`);
    await exec(process.env.OPENSSL_BIN, [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      `/CN=${name}/emailAddress=${name.toLowerCase()}@example.test`,
      "-addext",
      `subjectAltName=email:${name.toLowerCase()}@example.test`,
      "-keyout",
      key,
      "-out",
      cert,
    ]);
    return {
      key: await fs.readFile(key, "utf8"),
      cert: await fs.readFile(cert, "utf8"),
    };
  };
  const alice = await makeCertificate("Alice");
  const bob = await makeCertificate("Bob");
  assert.ok(
    validateSmimeIdentity(alice.cert, alice.key, "", "alice@example.test")
      .fingerprint,
  );
  const bundle = path.join(temp, "alice.p12");
  await exec(process.env.OPENSSL_BIN, [
    "pkcs12",
    "-export",
    "-in",
    path.join(temp, "Alice-cert.pem"),
    "-inkey",
    path.join(temp, "Alice-key.pem"),
    "-passout",
    "pass:test-pass",
    "-out",
    bundle,
  ]);
  assert.ok(
    (
      await readPkcs12(
        (await fs.readFile(bundle)).toString("base64"),
        "test-pass",
        "alice@example.test",
      )
    ).fingerprint,
  );
  db.prepare(
    "UPDATE contacts SET smime_cert=? WHERE user_id=1 AND email='bob@example.test'",
  ).run(bob.cert);
  const account = {
    id: 1,
    user_id: 1,
    email: "alice@example.test",
    smime_cert: alice.cert,
    smime_key_enc: encrypt(alice.key),
  };
  const mail = {
    to: "bob@example.test",
    cc: "",
    bcc: "bob@example.test",
    crypto: { mode: "smime", sign: true, encrypt: true },
  };
  const protectedMessage = await protectOutgoing(account, mail, {
    ...outgoing(account.email, mail.to, "Secret S/MIME body — Grüße"),
    bcc: mail.bcc,
  });
  assert.match(protectedMessage.smtpRaw.toString(), /application\/pkcs7-mime/);
  assert.equal(
    (protectedMessage.smtpRaw.toString().match(/^MIME-Version:/gim) || [])
      .length,
    1,
  );
  assert.doesNotMatch(
    protectedMessage.smtpRaw.toString(),
    /Secret S\/MIME body/,
  );
  assert.doesNotMatch(protectedMessage.smtpRaw.toString(), /^Bcc:/m);
  assert.match(protectedMessage.sentRaw.toString(), /^Bcc:/m);
  const decoded = await inspectIncoming(account, protectedMessage.sentRaw);
  assert.equal(decoded.parsed.text.trim(), "Secret S/MIME body — Grüße");
  assert.equal(decoded.security.encrypted, true);
  assert.equal(decoded.security.signature, "untrusted");
  const signed = await protectOutgoing(
    account,
    { ...mail, crypto: { mode: "smime", sign: true, encrypt: false } },
    outgoing(account.email, mail.to, "Signed S/MIME body"),
  );
  const verified = await inspectIncoming(account, signed.sentRaw);
  assert.equal(
    (signed.sentRaw.toString().match(/^MIME-Version:/gim) || []).length,
    1,
  );
  assert.equal(verified.parsed.text.trim(), "Signed S/MIME body");
  assert.equal(verified.security.signature, "untrusted");
  const tamperedRaw = signed.sentRaw
    .toString("latin1")
    .replace("Signed S/MIME body", "Tampered S/MIME body");
  assert.notEqual(tamperedRaw, signed.sentRaw.toString("latin1"));
  const tampered = await inspectIncoming(
    account,
    Buffer.from(tamperedRaw, "latin1"),
  );
  assert.equal(tampered.parsed.text.trim(), "Tampered S/MIME body");
  assert.equal(tampered.security.signature, "invalid");
  const autoEncrypted = await protectOutgoing(
    account,
    { ...mail, crypto: { mode: "smime", sign: true, encrypt: "auto" } },
    outgoing(account.email, mail.to, "Automatic S/MIME encryption"),
  );
  assert.match(autoEncrypted.smtpRaw.toString(), /application\/pkcs7-mime/);
  const autoSigned = await protectOutgoing(
    account,
    {
      ...mail,
      bcc: "missing@example.test",
      crypto: { mode: "smime", sign: true, encrypt: "auto" },
    },
    outgoing(account.email, mail.to, "Automatic S/MIME fallback"),
  );
  assert.match(autoSigned.smtpRaw.toString(), /multipart\/signed/);
  const opaqueInput = path.join(temp, "opaque-input.mime");
  const opaqueOutput = path.join(temp, "opaque-output.mime");
  await fs.writeFile(
    opaqueInput,
    "Content-Type: text/plain; charset=utf-8\r\n\r\nOpaque signed body",
  );
  await exec(process.env.OPENSSL_BIN, [
    "cms",
    "-sign",
    "-nodetach",
    "-binary",
    "-in",
    opaqueInput,
    "-signer",
    path.join(temp, "Alice-cert.pem"),
    "-inkey",
    path.join(temp, "Alice-key.pem"),
    "-outform",
    "SMIME",
    "-out",
    opaqueOutput,
  ]);
  const opaque = await inspectIncoming(
    account,
    Buffer.concat([
      Buffer.from("From: Alice <alice@example.test>\r\n"),
      await fs.readFile(opaqueOutput),
    ]),
  );
  assert.equal(opaque.parsed.text.trim(), "Opaque signed body");
  assert.equal(opaque.security.signature, "untrusted");
});

test.after(async () => {
  db.close();
  process.chdir(originalCwd);
  await fs.rm(temp, { recursive: true, force: true });
});
