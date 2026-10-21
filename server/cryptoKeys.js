import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import * as openpgp from "openpgp";

const execFileAsync = promisify(execFile);
const openssl = process.env.OPENSSL_BIN || "openssl";

export async function runOpenSSL(args) {
  try {
    return await execFileAsync(openssl, args, {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(
      `OpenSSL operation failed: ${String(error.stderr || error.message).slice(0, 500)}`,
    );
  }
}

export async function withCryptoTemp(callback) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "minimail-crypto-"));
  try {
    await fs.chmod(dir, 0o700);
    return await callback(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export function emailInPgpKey(key, email) {
  const wanted = email.toLowerCase();
  return key
    .getUserIDs()
    .some(
      (id) =>
        id.toLowerCase().includes(`<${wanted}>`) || id.toLowerCase() === wanted,
    );
}

export async function validatePgpPrivate(armored, passphrase, email) {
  if (
    typeof armored !== "string" ||
    armored.length > 200000 ||
    !armored.includes("BEGIN PGP PRIVATE KEY BLOCK")
  )
    throw new Error("Ungültiger OpenPGP-Privatschlüssel.");
  const key = await openpgp.readPrivateKey({ armoredKey: armored });
  if (!emailInPgpKey(key, email))
    throw new Error("Der OpenPGP-Schlüssel gehört nicht zur Postfachadresse.");
  const unlocked = key.isDecrypted()
    ? key
    : await openpgp.decryptKey({
        privateKey: key,
        passphrase: passphrase || "",
      });
  return {
    fingerprint: key.getFingerprint().toUpperCase(),
    publicKey: unlocked.toPublic().armor(),
  };
}

export async function validatePgpPublic(armored, email) {
  if (
    typeof armored !== "string" ||
    armored.length > 200000 ||
    !armored.includes("BEGIN PGP PUBLIC KEY BLOCK")
  )
    throw new Error("Ungültiger öffentlicher OpenPGP-Schlüssel.");
  const key = await openpgp.readKey({ armoredKey: armored });
  if (!emailInPgpKey(key, email))
    throw new Error(
      "Die E-Mail-Adresse ist nicht im OpenPGP-Schlüssel enthalten.",
    );
  return { fingerprint: key.getFingerprint().toUpperCase() };
}

export function validateSmimeCertificate(pem, email) {
  if (
    typeof pem !== "string" ||
    pem.length > 200000 ||
    !pem.includes("BEGIN CERTIFICATE")
  )
    throw new Error("Ungültiges S/MIME-Zertifikat.");
  const certificate = new crypto.X509Certificate(pem);
  if (!certificate.checkEmail(email))
    throw new Error("Das S/MIME-Zertifikat gehört nicht zur E-Mail-Adresse.");
  const now = Date.now();
  if (
    now < Date.parse(certificate.validFrom) ||
    now > Date.parse(certificate.validTo)
  )
    throw new Error(
      "Das S/MIME-Zertifikat ist noch nicht gültig oder abgelaufen.",
    );
  return { fingerprint: certificate.fingerprint256, certificate };
}

export function validateSmimeIdentity(
  certificatePem,
  keyPem,
  passphrase,
  email,
) {
  const { fingerprint, certificate } = validateSmimeCertificate(
    certificatePem,
    email,
  );
  if (typeof keyPem !== "string" || keyPem.length > 200000)
    throw new Error("Ungültiger S/MIME-Privatschlüssel.");
  const key = crypto.createPrivateKey({
    key: keyPem,
    passphrase: passphrase || undefined,
  });
  const publicFromKey = crypto
    .createPublicKey(key)
    .export({ format: "der", type: "spki" });
  const publicFromCert = certificate.publicKey.export({
    format: "der",
    type: "spki",
  });
  if (!publicFromKey.equals(publicFromCert))
    throw new Error(
      "S/MIME-Zertifikat und Privatschlüssel passen nicht zusammen.",
    );
  const normalizedKey = key.export({ format: "pem", type: "pkcs8" }).toString();
  return {
    fingerprint,
    certificate: certificatePem,
    privateKey: normalizedKey,
  };
}

export async function readPkcs12(base64, passphrase, email) {
  if (
    typeof base64 !== "string" ||
    base64.length > 1500000 ||
    !/^[A-Za-z0-9+/=]+$/.test(base64)
  )
    throw new Error("Ungültige PKCS#12-Datei.");
  return withCryptoTemp(async (dir) => {
    const bundle = path.join(dir, "identity.p12");
    const passFile = path.join(dir, "pass.txt");
    const certFile = path.join(dir, "cert.pem");
    const keyFile = path.join(dir, "key.pem");
    await fs.writeFile(bundle, Buffer.from(base64, "base64"), { mode: 0o600 });
    await fs.writeFile(passFile, passphrase || "", { mode: 0o600 });
    const extract = async (legacy) => {
      const base = [
        "pkcs12",
        ...(legacy ? ["-legacy"] : []),
        "-in",
        bundle,
        "-passin",
        `file:${passFile}`,
      ];
      await runOpenSSL([...base, "-clcerts", "-nokeys", "-out", certFile]);
      await runOpenSSL([...base, "-nocerts", "-nodes", "-out", keyFile]);
    };
    try {
      await extract(false);
    } catch {
      await extract(true);
    }
    const certOutput = await fs.readFile(certFile, "utf8");
    const keyOutput = await fs.readFile(keyFile, "utf8");
    const certPem = certOutput.match(
      /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/,
    )?.[0];
    const keyPem = keyOutput.match(
      /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/,
    )?.[0];
    if (!certPem || !keyPem)
      throw new Error("PKCS#12 enthält kein Zertifikat mit Privatschlüssel.");
    return validateSmimeIdentity(certPem, keyPem, "", email);
  });
}
