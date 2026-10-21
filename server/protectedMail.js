import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import tls from "node:tls";
import * as openpgp from "openpgp";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";
import { db } from "./db.js";
import { decrypt } from "./security.js";
import { parseRecipients } from "./contacts.js";
import {
  certificateIsCurrent,
  runOpenSSL,
  withCryptoTemp,
} from "./cryptoKeys.js";

export class CryptoInputError extends Error {}

const crlf = (text) => String(text).replace(/\r?\n/g, "\r\n");
const name = (field) => field.split(":", 1)[0].toLowerCase();

function mimeParts(raw) {
  const text = Buffer.isBuffer(raw) ? raw.toString("latin1") : String(raw);
  const split = text.indexOf("\r\n\r\n");
  if (split < 0) throw new Error("Invalid MIME message");
  const headerLines = text.slice(0, split).split("\r\n");
  const fields = [];
  for (const line of headerLines) {
    if (/^[ \t]/.test(line) && fields.length)
      fields[fields.length - 1] += `\r\n${line}`;
    else fields.push(line);
  }
  const outer = fields.filter(
    (field) =>
      ![
        "mime-version",
        "content-type",
        "content-transfer-encoding",
        "content-disposition",
      ].includes(name(field)),
  );
  const inner = fields.filter((field) =>
    [
      "content-type",
      "content-transfer-encoding",
      "content-disposition",
    ].includes(name(field)),
  );
  const body = crlf(text.slice(split + 4)).replace(/\r\n$/, "");
  return {
    headers: outer,
    content: Buffer.from(`${inner.join("\r\n")}\r\n\r\n${body}`, "latin1"),
  };
}

function outerHeaders(headers, includeBcc) {
  return headers
    .filter((field) => includeBcc || name(field) !== "bcc")
    .join("\r\n");
}

function wrap(headers, mime, includeBcc) {
  const version = /^MIME-Version:/i.test(mime) ? "" : "MIME-Version: 1.0\r\n";
  return Buffer.from(
    `${outerHeaders(headers, includeBcc)}\r\n${version}${mime}`,
    "latin1",
  );
}

function multipartFirstPart(raw, boundary) {
  if (!boundary || boundary.length > 200)
    throw new Error("Invalid MIME boundary");
  const text = Buffer.isBuffer(raw) ? raw.toString("latin1") : String(raw);
  const separator = text.indexOf("\r\n\r\n");
  const body = text.slice(separator + 4);
  const startMarker = `--${boundary}\r\n`;
  const start = body.indexOf(startMarker);
  if (start < 0) throw new Error("MIME part not found");
  const contentStart = start + startMarker.length;
  const end = body.indexOf(`\r\n--${boundary}`, contentStart);
  if (end < 0) throw new Error("MIME part not terminated");
  return Buffer.from(body.slice(contentStart, end), "latin1");
}

function senderKey(userId, email) {
  const contact = db
    .prepare(
      "SELECT pgp_public FROM contacts WHERE user_id=? AND email=? COLLATE NOCASE",
    )
    .get(userId, email);
  if (contact?.pgp_public) return contact.pgp_public;
  const own = db
    .prepare(
      "SELECT pgp_private_enc FROM accounts WHERE user_id=? AND email=? COLLATE NOCASE",
    )
    .get(userId, email);
  return own?.pgp_private_enc ? decrypt(own.pgp_private_enc) : null;
}

async function unlockedPgp(account) {
  if (!account.pgp_private_enc)
    throw new CryptoInputError("OpenPGP-Privatschlüssel fehlt.");
  const key = await openpgp.readPrivateKey({
    armoredKey: decrypt(account.pgp_private_enc),
  });
  return key.isDecrypted()
    ? key
    : openpgp.decryptKey({
        privateKey: key,
        passphrase: decrypt(account.pgp_passphrase_enc),
      });
}

async function recipientMaterial(account, mail, column) {
  const addresses = [
    ...new Set(
      parseRecipients([mail.to, mail.cc, mail.bcc]).map((item) =>
        item.address.toLowerCase(),
      ),
    ),
  ];
  const missing = [];
  const material = [];
  for (const email of addresses) {
    if (email === account.email.toLowerCase()) continue;
    const contact = db
      .prepare(
        `SELECT ${column} AS key FROM contacts WHERE user_id=? AND email=? COLLATE NOCASE`,
      )
      .get(account.user_id, email);
    let key = contact?.key;
    if (!key) {
      const own = db
        .prepare(
          "SELECT pgp_private_enc,smime_cert FROM accounts WHERE user_id=? AND email=? COLLATE NOCASE",
        )
        .get(account.user_id, email);
      if (column === "smime_cert") key = own?.smime_cert;
      else if (own?.pgp_private_enc)
        key = (
          await openpgp.readPrivateKey({
            armoredKey: decrypt(own.pgp_private_enc),
          })
        )
          .toPublic()
          .armor();
    }
    if (key) {
      try {
        if (column === "pgp_public")
          await (await openpgp.readKey({ armoredKey: key })).getEncryptionKey();
        else if (!certificateIsCurrent(new crypto.X509Certificate(key)))
          key = null;
      } catch {
        key = null;
      }
    }
    if (!key) missing.push(email);
    else material.push(key);
  }
  if (missing.length) {
    const error = new CryptoInputError(
      `Für diese Empfänger fehlt ein ${column === "pgp_public" ? "OpenPGP-Schlüssel" : "S/MIME-Zertifikat"}: ${missing.join(", ")}`,
    );
    error.missing = missing;
    throw error;
  }
  return material;
}

export async function encryptionAvailability(account, mail) {
  if (!parseRecipients([mail.to, mail.cc, mail.bcc]).length)
    return { available: false, reason: "Bitte zuerst Empfänger eingeben." };
  try {
    if (mail.crypto.mode === "pgp") {
      const own = await unlockedPgp(account);
      await own.getEncryptionKey();
      await recipientMaterial(account, mail, "pgp_public");
    } else if (mail.crypto.mode === "smime") {
      if (!account.smime_cert || !account.smime_key_enc)
        throw new CryptoInputError(
          "S/MIME-Zertifikat mit Privatschlüssel fehlt.",
        );
      if (!certificateIsCurrent(new crypto.X509Certificate(account.smime_cert)))
        throw new CryptoInputError(
          "Das eigene S/MIME-Zertifikat ist abgelaufen.",
        );
      await recipientMaterial(account, mail, "smime_cert");
    } else {
      return {
        available: false,
        reason: "Kein Verschlüsselungsverfahren ausgewählt.",
      };
    }
    return { available: true };
  } catch (error) {
    if (error instanceof CryptoInputError)
      return {
        available: false,
        reason: error.message,
        ...(error.missing ? { missing: error.missing } : {}),
      };
    throw error;
  }
}

async function protectPgp(account, mail, content) {
  const signingKey = mail.crypto.sign ? await unlockedPgp(account) : null;
  const boundary = `minimail-${crypto.randomBytes(18).toString("hex")}`;
  if (mail.crypto.encrypt) {
    const publicKeys = await recipientMaterial(account, mail, "pgp_public");
    const ownKey = await unlockedPgp(account);
    const encryptionKeys = await Promise.all([
      ...publicKeys.map((key) => openpgp.readKey({ armoredKey: key })),
      Promise.resolve(ownKey.toPublic()),
    ]);
    const armored = await openpgp.encrypt({
      message: await openpgp.createMessage({ binary: new Uint8Array(content) }),
      encryptionKeys,
      ...(signingKey ? { signingKeys: signingKey } : {}),
    });
    const mime =
      `Content-Type: multipart/encrypted; protocol="application/pgp-encrypted"; boundary="${boundary}"\r\n\r\n` +
      `--${boundary}\r\nContent-Type: application/pgp-encrypted\r\n\r\nVersion: 1\r\n` +
      `--${boundary}\r\nContent-Type: application/octet-stream; name="encrypted.asc"\r\nContent-Disposition: inline; filename="encrypted.asc"\r\nContent-Transfer-Encoding: 7bit\r\n\r\n${crlf(armored).trimEnd()}\r\n--${boundary}--\r\n`;
    return mime;
  }
  const signature = await openpgp.sign({
    message: await openpgp.createMessage({ binary: new Uint8Array(content) }),
    signingKeys: signingKey,
    detached: true,
    config: { preferredHashAlgorithm: openpgp.enums.hash.sha256 },
  });
  return (
    `Content-Type: multipart/signed; micalg=pgp-sha256; protocol="application/pgp-signature"; boundary="${boundary}"\r\n\r\n` +
    `--${boundary}\r\n${content.toString("latin1")}\r\n` +
    `--${boundary}\r\nContent-Type: application/pgp-signature; name="signature.asc"\r\nContent-Disposition: attachment; filename="signature.asc"\r\nContent-Transfer-Encoding: 7bit\r\n\r\n${crlf(signature).trimEnd()}\r\n--${boundary}--\r\n`
  );
}

async function protectSmime(account, mail, content) {
  if (
    (mail.crypto.sign || mail.crypto.encrypt) &&
    (!account.smime_cert || !account.smime_key_enc)
  )
    throw new CryptoInputError("S/MIME-Zertifikat mit Privatschlüssel fehlt.");
  if (!certificateIsCurrent(new crypto.X509Certificate(account.smime_cert)))
    throw new CryptoInputError(
      "Das S/MIME-Zertifikat ist abgelaufen oder noch nicht gültig und kann nur zum Lesen alter Nachrichten verwendet werden.",
    );
  return withCryptoTemp(async (dir) => {
    const input = path.join(dir, "input.mime");
    const cert = path.join(dir, "own.pem");
    const key = path.join(dir, "key.pem");
    const output = path.join(dir, "output.mime");
    await fs.writeFile(input, content, { mode: 0o600 });
    await fs.writeFile(cert, account.smime_cert, { mode: 0o600 });
    await fs.writeFile(key, decrypt(account.smime_key_enc), { mode: 0o600 });
    let current = input;
    if (mail.crypto.sign) {
      await runOpenSSL([
        "cms",
        "-sign",
        "-crlfeol",
        "-binary",
        "-md",
        "sha256",
        "-in",
        current,
        "-signer",
        cert,
        "-inkey",
        key,
        "-out",
        output,
        "-outform",
        "SMIME",
      ]);
      current = output;
    }
    if (mail.crypto.encrypt) {
      const recipients = await recipientMaterial(account, mail, "smime_cert");
      const files = [];
      for (const [index, pem] of [
        ...recipients,
        account.smime_cert,
      ].entries()) {
        const file = path.join(dir, `recipient-${index}.pem`);
        await fs.writeFile(file, pem, { mode: 0o600 });
        files.push(file);
      }
      const encrypted = path.join(dir, "encrypted.mime");
      await runOpenSSL([
        "cms",
        "-encrypt",
        "-crlfeol",
        "-binary",
        "-aes256",
        "-in",
        current,
        "-out",
        encrypted,
        "-outform",
        "SMIME",
        ...files,
      ]);
      current = encrypted;
    }
    return (await fs.readFile(current)).toString("latin1");
  });
}

export async function protectOutgoing(account, mail, outgoing) {
  let cryptoOptions = mail.crypto;
  if (cryptoOptions?.encrypt === "auto") {
    const availability = await encryptionAvailability(account, mail);
    cryptoOptions = { ...cryptoOptions, encrypt: availability.available };
  }
  if (
    !cryptoOptions ||
    cryptoOptions.mode === "none" ||
    (!cryptoOptions.sign && !cryptoOptions.encrypt)
  )
    return null;
  const generated = await nodemailer
    .createTransport({
      streamTransport: true,
      buffer: true,
      disableFileAccess: true,
      disableUrlAccess: true,
    })
    .sendMail(outgoing);
  const { headers, content } = mimeParts(generated.message);
  const mime =
    cryptoOptions.mode === "pgp"
      ? await protectPgp(account, { ...mail, crypto: cryptoOptions }, content)
      : await protectSmime(
          account,
          { ...mail, crypto: cryptoOptions },
          content,
        );
  const messageId =
    /(?:^|\r\n)Message-ID:\s*(\S+)/i.exec(headers.join("\r\n"))?.[1] ||
    generated.messageId;
  return {
    messageId,
    smtpRaw: wrap(headers, mime, false),
    sentRaw: wrap(headers, mime, true),
    envelope: {
      from: account.email,
      to: parseRecipients([mail.to, mail.cc, mail.bcc]).map(
        (item) => item.address,
      ),
    },
  };
}

async function verifyPgp(content, armoredSignature, userId, sender) {
  const armored = senderKey(userId, sender);
  if (!armored) return { signed: true, signature: "unknown-key" };
  try {
    const key = armored.includes("PRIVATE KEY")
      ? (await openpgp.readPrivateKey({ armoredKey: armored })).toPublic()
      : await openpgp.readKey({ armoredKey: armored });
    const signature = await openpgp.readSignature({ armoredSignature });
    const result = await openpgp.verify({
      message: await openpgp.createMessage({ binary: new Uint8Array(content) }),
      signature,
      verificationKeys: key,
      format: "binary",
    });
    if (!result.signatures.length) throw new Error("Missing PGP signature");
    await result.signatures[0].verified;
    return {
      signed: true,
      signature: "valid",
      fingerprint: key.getFingerprint().toUpperCase(),
    };
  } catch {
    return { signed: true, signature: "invalid" };
  }
}

async function readPgp(account, raw, parsed, kind) {
  const sender = parsed.from?.value?.[0]?.address || "";
  if (kind === "signed") {
    const boundary = parsed.headers.get("content-type")?.params?.boundary;
    const content = multipartFirstPart(raw, boundary);
    const signature = parsed.attachments.find(
      (item) => item.contentType === "application/pgp-signature",
    );
    if (!signature) throw new Error("Missing PGP signature");
    return {
      parsed: await simpleParser(content),
      security: {
        kind: "pgp",
        encrypted: false,
        ...(await verifyPgp(
          content,
          signature.content.toString("utf8"),
          account.user_id,
          sender,
        )),
      },
    };
  }
  const attachment = parsed.attachments.find(
    (item) =>
      item.contentType === "application/octet-stream" &&
      item.content.toString("utf8").includes("BEGIN PGP MESSAGE"),
  );
  const armored =
    attachment?.content.toString("utf8") ||
    (parsed.text?.includes("BEGIN PGP MESSAGE") ? parsed.text : null);
  if (!armored) throw new Error("Missing PGP message");
  if (!account.pgp_private_enc)
    return {
      parsed: await simpleParser("Content-Type: text/plain\r\n\r\n"),
      security: { kind: "pgp", encrypted: true, status: "missing-key" },
    };
  const key = await unlockedPgp(account);
  const signer = senderKey(account.user_id, sender);
  const verificationKeys = signer
    ? signer.includes("PRIVATE KEY")
      ? (await openpgp.readPrivateKey({ armoredKey: signer })).toPublic()
      : await openpgp.readKey({ armoredKey: signer })
    : undefined;
  const result = await openpgp.decrypt({
    message: await openpgp.readMessage({ armoredMessage: armored }),
    decryptionKeys: key,
    ...(verificationKeys ? { verificationKeys } : {}),
    format: "binary",
  });
  let signature = result.signatures?.length ? "unknown-key" : "none";
  if (result.signatures?.length && verificationKeys) {
    try {
      await result.signatures[0].verified;
      signature = "valid";
    } catch {
      signature = "invalid";
    }
  }
  return {
    parsed:
      parsed.headers.get("content-type")?.value === "multipart/encrypted"
        ? await simpleParser(Buffer.from(result.data))
        : {
            ...parsed,
            text: Buffer.from(result.data).toString("utf8"),
            html: "",
            attachments: [],
          },
    security: {
      kind: "pgp",
      encrypted: true,
      signed: signature !== "none",
      signature,
      fingerprint: verificationKeys?.getFingerprint().toUpperCase(),
    },
  };
}

async function readSmime(
  account,
  raw,
  parsed,
  encrypted,
  opaqueSigned = false,
) {
  const outerSender = parsed.from?.value?.[0]?.address || "";
  if (encrypted && (!account.smime_cert || !account.smime_key_enc))
    return {
      parsed: await simpleParser("Content-Type: text/plain\r\n\r\n"),
      security: { kind: "smime", encrypted: true, status: "missing-key" },
    };
  return withCryptoTemp(async (dir) => {
    const source = path.join(dir, "source.mime");
    const output = path.join(dir, "output.mime");
    const cert = path.join(dir, "cert.pem");
    const key = path.join(dir, "key.pem");
    const signer = path.join(dir, "signer.pem");
    await fs.writeFile(source, raw, { mode: 0o600 });
    let current = source;
    let security = {
      kind: "smime",
      encrypted,
      signed: false,
      signature: "none",
    };
    if (encrypted) {
      await fs.writeFile(cert, account.smime_cert, { mode: 0o600 });
      await fs.writeFile(key, decrypt(account.smime_key_enc), { mode: 0o600 });
      await runOpenSSL([
        "cms",
        "-decrypt",
        "-inform",
        "SMIME",
        "-in",
        source,
        "-recip",
        cert,
        "-inkey",
        key,
        "-out",
        output,
      ]);
      current = output;
      parsed = await simpleParser(await fs.readFile(current));
    }
    const type = parsed.headers.get("content-type");
    if (
      opaqueSigned ||
      (type?.value === "multipart/signed" &&
        /pkcs7-signature/i.test(type.params?.protocol || ""))
    ) {
      const verified = path.join(dir, "verified.mime");
      const chain = path.join(dir, "ca.pem");
      await fs.writeFile(chain, tls.rootCertificates.join("\n"), {
        mode: 0o600,
      });
      let trusted = true;
      let signatureValid = true;
      try {
        await runOpenSSL([
          "cms",
          "-verify",
          "-inform",
          "SMIME",
          "-in",
          current,
          "-CAfile",
          chain,
          "-signer",
          signer,
          "-out",
          verified,
        ]);
      } catch {
        trusted = false;
        try {
          await runOpenSSL([
            "cms",
            "-verify",
            "-inform",
            "SMIME",
            "-in",
            current,
            "-noverify",
            "-signer",
            signer,
            "-out",
            verified,
          ]);
        } catch {
          signatureValid = false;
          await runOpenSSL([
            "cms",
            "-verify",
            "-inform",
            "SMIME",
            "-in",
            current,
            "-noverify",
            "-nosigs",
            "-signer",
            signer,
            "-out",
            verified,
          ]);
        }
      }
      const signerCert = new crypto.X509Certificate(await fs.readFile(signer));
      const identityMatches = !!senderCertEmail(signerCert, outerSender);
      const certificateCurrent = certificateIsCurrent(signerCert);
      const savedContact = db
        .prepare(
          "SELECT smime_cert FROM contacts WHERE user_id=? AND email=? COLLATE NOCASE",
        )
        .get(account.user_id, outerSender);
      const savedOwn = db
        .prepare(
          "SELECT smime_cert FROM accounts WHERE user_id=? AND email=? COLLATE NOCASE",
        )
        .get(account.user_id, outerSender);
      const pinned = [savedContact?.smime_cert, savedOwn?.smime_cert]
        .filter(Boolean)
        .some((pem) => {
          try {
            return (
              new crypto.X509Certificate(pem).fingerprint256 ===
              signerCert.fingerprint256
            );
          } catch {
            return false;
          }
        });
      security = {
        ...security,
        signed: true,
        signature: !signatureValid
          ? "invalid"
          : !identityMatches
            ? "identity-mismatch"
            : !certificateCurrent
              ? "expired"
              : trusted || pinned
                ? "valid"
                : "untrusted",
        fingerprint: signerCert.fingerprint256,
      };
      parsed = await simpleParser(await fs.readFile(verified));
    }
    return { parsed, security };
  });
}

function senderCertEmail(certificate, sender) {
  return sender && certificate.checkEmail(sender);
}

export async function inspectIncoming(account, raw) {
  const parsed = await simpleParser(raw);
  const type = parsed.headers.get("content-type");
  const protocol = type?.params?.protocol?.toLowerCase() || "";
  try {
    let result;
    if (
      type?.value === "multipart/encrypted" &&
      protocol === "application/pgp-encrypted"
    )
      result = await readPgp(account, raw, parsed, "encrypted");
    else if (
      type?.value === "multipart/signed" &&
      protocol === "application/pgp-signature"
    )
      result = await readPgp(account, raw, parsed, "signed");
    else if (
      type?.value === "application/pkcs7-mime" ||
      type?.value === "application/x-pkcs7-mime"
    )
      result = await readSmime(
        account,
        raw,
        parsed,
        type.params?.["smime-type"] !== "signed-data",
        type.params?.["smime-type"] === "signed-data",
      );
    else if (
      type?.value === "multipart/signed" &&
      /pkcs7-signature/i.test(protocol)
    )
      result = await readSmime(account, raw, parsed, false);
    else if (parsed.text?.includes("-----BEGIN PGP MESSAGE-----"))
      result = await readPgp(account, raw, parsed, "encrypted");
    if (result) {
      for (const field of [
        "subject",
        "date",
        "from",
        "to",
        "cc",
        "bcc",
        "replyTo",
        "messageId",
        "references",
      ])
        result.parsed[field] = parsed[field];
      return result;
    }
    if (parsed.text?.includes("-----BEGIN PGP SIGNED MESSAGE-----")) {
      const armored = senderKey(
        account.user_id,
        parsed.from?.value?.[0]?.address || "",
      );
      const clear = await openpgp.readCleartextMessage({
        cleartextMessage: parsed.text,
      });
      if (!armored)
        return {
          parsed: { ...parsed, text: clear.getText(), html: "" },
          security: {
            kind: "pgp",
            signed: true,
            encrypted: false,
            signature: "unknown-key",
          },
        };
      const key = armored.includes("PRIVATE KEY")
        ? (await openpgp.readPrivateKey({ armoredKey: armored })).toPublic()
        : await openpgp.readKey({ armoredKey: armored });
      const result = await openpgp.verify({
        message: clear,
        verificationKeys: key,
      });
      let signature = "valid";
      try {
        await result.signatures[0].verified;
      } catch {
        signature = "invalid";
      }
      return {
        parsed: { ...parsed, text: result.data, html: "" },
        security: {
          kind: "pgp",
          signed: true,
          encrypted: false,
          signature,
          fingerprint: key.getFingerprint().toUpperCase(),
        },
      };
    }
    return { parsed, security: null };
  } catch {
    const smimeEncrypted =
      type?.value?.includes("pkcs7-mime") &&
      type.params?.["smime-type"] !== "signed-data";
    const inlinePgpEncrypted = parsed.text?.includes(
      "-----BEGIN PGP MESSAGE-----",
    );
    return {
      parsed:
        type?.value?.includes("pkcs7-mime") ||
        protocol === "application/pgp-encrypted" ||
        inlinePgpEncrypted
          ? await simpleParser("Content-Type: text/plain\r\n\r\n")
          : parsed,
      security: {
        kind: type?.value?.includes("pkcs7") ? "smime" : "pgp",
        encrypted:
          smimeEncrypted ||
          protocol === "application/pgp-encrypted" ||
          !!inlinePgpEncrypted,
        status: "error",
      },
    };
  }
}
