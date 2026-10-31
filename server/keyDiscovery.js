import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import * as openpgp from "./openpgp.js";
import { simpleParser } from "mailparser";
import { validContact } from "./contacts.js";
import {
  certificateIsCurrent,
  emailInPgpKey,
  runOpenSSL,
  withCryptoTemp,
} from "./cryptoKeys.js";
import { inspectIncoming } from "./protectedMail.js";
const maxKeySize = 200000;
const maxMessageSize = 25 * 1024 * 1024;
function autocryptData(value, sender) {
  const raw = String(value || "").replace(/\r?\n[ \t]+/g, " ");
  const attributes = new Map(
    raw.split(";").map((part) => {
      const split = part.indexOf("=");
      return split < 0
        ? ["", ""]
        : [
            part.slice(0, split).trim().toLowerCase(),
            part.slice(split + 1).trim(),
          ];
    }),
  );
  if (attributes.get("addr")?.toLowerCase() !== sender.toLowerCase())
    return null;
  const data = attributes.get("keydata")?.replace(/\s/g, "");
  if (
    !data ||
    data.length > maxKeySize * 2 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
  )
    return null;
  const binary = Buffer.from(data, "base64");
  return binary.length <= maxKeySize ? binary : null;
}
async function pgpCandidate(input, email) {
  if (!input || input.length > maxKeySize) return null;
  try {
    const armored = Buffer.from(input).toString("utf8");
    const key = armored.includes("-----BEGIN PGP PUBLIC KEY BLOCK-----")
      ? await openpgp.readKey({
          armoredKey: armored,
        })
      : await openpgp.readKey({
          binaryKey: new Uint8Array(input),
        });
    if (!emailInPgpKey(key, email)) return null;
    await key.getEncryptionKey();
    return {
      kind: "pgp",
      fingerprint: key.getFingerprint().toUpperCase(),
      material: key.armor(),
      verified: false,
    };
  } catch {
    return null;
  }
}
function smimeCandidate(input, email, verified = false) {
  if (!input || input.length > maxKeySize) return null;
  try {
    const certificate = new crypto.X509Certificate(input);
    if (!certificate.checkEmail(email) || !certificateIsCurrent(certificate))
      return null;
    return {
      kind: "smime",
      fingerprint: certificate.fingerprint256,
      material: certificate.toString(),
      verified,
    };
  } catch {
    return null;
  }
}
async function certificatesInBundle(input, email) {
  try {
    return await withCryptoTemp(async (dir) => {
      const source = path.join(dir, "certificates.p7c");
      const output = path.join(dir, "certificates.pem");
      await fs.writeFile(source, input, {
        mode: 0o600,
      });
      await runOpenSSL([
        "pkcs7",
        "-inform",
        Buffer.from(input).toString("ascii", 0, 40).includes("BEGIN PKCS7")
          ? "PEM"
          : "DER",
        "-in",
        source,
        "-print_certs",
        "-out",
        output,
      ]);
      const pem = await fs.readFile(output, "utf8");
      return (
        pem.match(
          /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
        ) || []
      )
        .map((certificate) => smimeCandidate(certificate, email))
        .filter(Boolean);
    });
  } catch {
    return [];
  }
}
async function currentFingerprint(kind, material) {
  if (!material) return null;
  try {
    return kind === "pgp"
      ? (
          await openpgp.readKey({
            armoredKey: material,
          })
        )
          .getFingerprint()
          .toUpperCase()
      : new crypto.X509Certificate(material).fingerprint256;
  } catch {
    return null;
  }
}
async function storeCandidate(database, account, sender, candidate) {
  const now = Date.now();
  const email = sender.address.trim().toLowerCase();
  const name = validContact(sender.name || "", email) ? sender.name.trim() : "";
  await database
    .prepare(
      "INSERT IGNORE INTO contacts (user_id,name,email,source,created_at,updated_at) VALUES (?,?,?,'collected',?,?)",
    )
    .run(account.user_id, name, email, now, now);
  const contact = await database
    .prepare(
      "SELECT * FROM contacts WHERE user_id=? AND email=? COLLATE utf8mb4_0900_as_ci",
    )
    .get(account.user_id, email);
  if (!contact) return "alternate";
  const materialColumn = candidate.kind === "pgp" ? "pgp_public" : "smime_cert";
  const verifiedColumn =
    candidate.kind === "pgp" ? "pgp_verified" : "smime_verified";
  const sourceColumn = candidate.kind === "pgp" ? "pgp_source" : "smime_source";
  const existingFingerprint = await currentFingerprint(
    candidate.kind,
    contact[materialColumn],
  );
  await database
    .prepare(
      `INSERT INTO discovered_keys (user_id,email,kind,fingerprint,material,source,first_seen_at,last_seen_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         last_seen_at=VALUES(last_seen_at),seen_count=seen_count+1`,
    )
    .run(
      account.user_id,
      email,
      candidate.kind,
      candidate.fingerprint,
      candidate.material,
      candidate.source,
      now,
      now,
    );
  if (!contact[materialColumn]) {
    const result = await database
      .prepare(
        `UPDATE contacts SET ${materialColumn}=?,${verifiedColumn}=?,${sourceColumn}=?,updated_at=? WHERE id=? AND user_id=? AND email=? AND ${materialColumn} <=> ?`,
      )
      .run(
        candidate.material,
        candidate.verified ? 1 : 0,
        candidate.source,
        now,
        contact.id,
        account.user_id,
        email,
        contact[materialColumn],
      );
    // Discovery must never overwrite a key or a renamed contact saved while
    // this candidate was being checked. Keep it as an alternate instead.
    return result.changes ? "stored" : "alternate";
  }
  if (existingFingerprint === candidate.fingerprint) {
    if (candidate.verified && !contact[verifiedColumn])
      await database
        .prepare(
          `UPDATE contacts SET ${verifiedColumn}=1,updated_at=? WHERE id=? AND user_id=? AND email=? AND ${materialColumn}=?`,
        )
        .run(now, contact.id, account.user_id, email, contact[materialColumn]);
    return "known";
  }
  return "alternate";
}
export async function collectMessageKeys(database, account, raw) {
  if (!raw || raw.length > maxMessageSize)
    return {
      stored: 0,
      alternate: 0,
    };
  const parsed = await simpleParser(raw);
  const sender = parsed.from?.value?.[0];
  if (!sender || !validContact("", sender.address || ""))
    return {
      stored: 0,
      alternate: 0,
    };
  const own = await database
    .prepare(
      "SELECT 1 FROM accounts WHERE user_id=? AND email=? COLLATE utf8mb4_0900_as_ci",
    )
    .get(account.user_id, sender.address);
  if (own)
    return {
      stored: 0,
      alternate: 0,
    };
  const candidates = [];
  const autocrypt = parsed.headers.get("autocrypt");
  const headerValues = Array.isArray(autocrypt) ? autocrypt : [autocrypt];
  for (const value of headerValues) {
    const binary = autocryptData(value, sender.address);
    const candidate = binary && (await pgpCandidate(binary, sender.address));
    if (candidate)
      candidates.push({
        ...candidate,
        source: "autocrypt",
      });
  }
  for (const part of parsed.attachments || []) {
    if (!part.content || part.content.length > maxKeySize) continue;
    const filename = part.filename || "";
    if (
      part.contentType === "application/pgp-keys" ||
      /\.(asc|pgp)$/i.test(filename)
    ) {
      const candidate = await pgpCandidate(part.content, sender.address);
      if (candidate)
        candidates.push({
          ...candidate,
          source: "pgp-attachment",
        });
    }
    if (/\.(cer|crt|pem)$/i.test(filename)) {
      const candidate = smimeCandidate(part.content, sender.address);
      if (candidate)
        candidates.push({
          ...candidate,
          source: "smime-attachment",
        });
    }
    if (/\.(p7b|p7c)$/i.test(filename)) {
      for (const candidate of await certificatesInBundle(
        part.content,
        sender.address,
      ))
        candidates.push({
          ...candidate,
          source: "smime-attachment",
        });
    }
  }
  const inlineKeys = String(parsed.text || "").match(
    /-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]{0,200000}?-----END PGP PUBLIC KEY BLOCK-----/g,
  );
  for (const armored of inlineKeys || []) {
    const candidate = await pgpCandidate(Buffer.from(armored), sender.address);
    if (candidate)
      candidates.push({
        ...candidate,
        source: "pgp-inline",
      });
  }
  const type = parsed.headers.get("content-type");
  if (
    (type?.value === "multipart/signed" &&
      /pkcs7-signature/i.test(type.params?.protocol || "")) ||
    ((type?.value === "application/pkcs7-mime" ||
      type?.value === "application/x-pkcs7-mime") &&
      type.params?.["smime-type"] === "signed-data")
  ) {
    const inspected = await inspectIncoming(account, raw);
    if (inspected.discoveredSmime) {
      const candidate = smimeCandidate(
        inspected.discoveredSmime.certificate,
        sender.address,
        inspected.discoveredSmime.trusted,
      );
      if (candidate)
        candidates.push({
          ...candidate,
          source: "smime-signature",
        });
    }
  }
  const unique = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.kind}:${candidate.fingerprint}`;
    if (!unique.has(key) || candidate.verified) unique.set(key, candidate);
  }
  const totals = {
    stored: 0,
    alternate: 0,
  };
  for (const candidate of unique.values()) {
    const result = await storeCandidate(database, account, sender, candidate);
    if (result in totals) totals[result]++;
  }
  return totals;
}
