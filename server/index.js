import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import { db } from "./db.js";
import { CryptoInputError } from "./protectedMail.js";
import {
  validatePgpPrivate,
  validatePgpPublic,
  validateSmimeCertificate,
  validateSmimeIdentity,
  readPkcs12,
  certificateIsCurrent,
} from "./cryptoKeys.js";
import { collectSentRecipients, validContact } from "./contacts.js";
import { startMailChecks } from "./mailCheck.js";
import { vpnProfiles } from "./vpn.js";
import {
  encrypt,
  decrypt,
  hashPassword,
  verifyPassword,
  randomToken,
  tokenHash,
  newTotpSecret,
  verifyTotp,
} from "./security.js";
import {
  testAccount,
  listFolders,
  listMessages,
  getMessage,
  getMessageSource,
  getAttachment,
  updateFlags,
  markFolderRead,
  moveMessage,
  deleteMessage,
  emptyTrash,
  sendMessage,
} from "./mail.js";

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || "127.0.0.1";
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  if (
    req.path.startsWith("/api/") &&
    !["GET", "HEAD", "OPTIONS"].includes(req.method)
  ) {
    const fetchSite = req.get("sec-fetch-site");
    if (fetchSite && fetchSite !== "same-origin")
      return res.status(403).json({ error: "Ungültiger Ursprung." });
    const origin = req.get("origin");
    if (origin) {
      try {
        const parsed = new URL(origin);
        const expectedProtocol =
          process.env.NODE_ENV === "production" ? "https:" : "http:";
        if (
          parsed.host !== req.get("host") ||
          parsed.protocol !== expectedProtocol
        )
          return res.status(403).json({ error: "Ungültiger Ursprung." });
      } catch {
        return res.status(403).json({ error: "Ungültiger Ursprung." });
      }
    }
    // Already-open tabs may still run the previous bundle without our custom
    // header. Browsers set Sec-Fetch-Site for same-origin requests themselves.
    if (req.get("x-minimail-request") !== "1" && fetchSite !== "same-origin")
      return res.status(403).json({ error: "Ungültiger Ursprung." });
  }
  next();
});
app.use("/api/accounts/:id/send", express.json({ limit: "12mb" }));
app.use("/api/accounts/:id/crypto", express.json({ limit: "2mb" }));
app.use("/api/contacts/:id/crypto", express.json({ limit: "512kb" }));
app.use(express.json({ limit: "64kb" }));
const asyncRoute = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res)).catch(next);
function cookie(req, name) {
  return (req.headers.cookie || "")
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
const sessionCookieName =
  process.env.NODE_ENV === "production"
    ? "__Host-minimail_session"
    : "minimail_session";
function sessionCookie(res, token, clear = false) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${sessionCookieName}=${clear ? "" : token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${clear ? 0 : 60 * 60 * 24 * 14}${secure}`,
  );
}
function issueSession(res, userId) {
  const token = randomToken();
  db.prepare(
    "INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)",
  ).run(tokenHash(token), userId, Date.now() + 14 * 86400000);
  sessionCookie(res, token);
}
function rotateSessions(res, userId) {
  db.prepare("DELETE FROM sessions WHERE user_id=?").run(userId);
  issueSession(res, userId);
}
app.use("/api", (req, res, next) => {
  const token = cookie(req, sessionCookieName);
  if (token)
    req.user = db
      .prepare(
        "SELECT users.* FROM users JOIN sessions ON sessions.user_id=users.id WHERE sessions.token_hash=? AND sessions.expires_at>?",
      )
      .get(tokenHash(token), Date.now());
  next();
});
function authenticated(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Bitte anmelden." });
  next();
}
function ready(req, res, next) {
  if (req.user?.must_change_password)
    return res.status(403).json({ error: "Bitte zuerst das Passwort ändern." });
  if (!req.user?.totp_secret)
    return res
      .status(403)
      .json({ error: "Zwei-Faktor-Anmeldung zuerst einrichten." });
  next();
}
function adminOnly(req, res, next) {
  if (req.user?.role !== "admin")
    return res.status(403).json({ error: "Nur für Admins verfügbar." });
  next();
}
const loginAttempts = new Map();
function canAttempt(key) {
  const data = loginAttempts.get(key);
  if (data?.until < Date.now()) {
    loginAttempts.delete(key);
    return true;
  }
  return !data || data.count < 8;
}
function failedAttempt(key) {
  const data = loginAttempts.get(key);
  loginAttempts.set(
    key,
    data?.until > Date.now()
      ? { count: data.count + 1, until: data.until }
      : { count: 1, until: Date.now() + 15 * 60000 },
  );
}
app.get("/api/auth/me", (req, res) => {
  const exists = !!db.prepare("SELECT id FROM users LIMIT 1").get();
  res.json({
    adminSetupRequired: !exists,
    user: req.user
      ? {
          username: req.user.username,
          role: req.user.role,
          mustChangePassword: !!req.user.must_change_password,
          twoFactorEnabled: !!req.user.totp_secret,
          collectRecipients: !!req.user.collect_recipients,
        }
      : null,
  });
});
app.post(
  "/api/auth/login",
  asyncRoute(async (req, res) => {
    const { username, password, code } = req.body || {};
    const user = db
      .prepare("SELECT * FROM users WHERE username=?")
      .get(typeof username === "string" ? username : "");
    const key = user ? `user:${user.id}` : `unknown:${req.ip}`;
    if (!canAttempt(key))
      return res
        .status(429)
        .json({ error: "Zu viele Versuche. Bitte später erneut versuchen." });
    if (
      !user ||
      typeof password !== "string" ||
      password.length > 1024 ||
      !verifyPassword(password, user.password_hash) ||
      (user.totp_secret && !verifyTotp(decrypt(user.totp_secret), code))
    ) {
      failedAttempt(key);
      return res
        .status(401)
        .json({ error: "Anmeldedaten oder 2FA-Code stimmen nicht." });
    }
    loginAttempts.delete(key);
    issueSession(res, user.id);
    res.json({ ok: true });
  }),
);
app.post("/api/auth/logout", authenticated, (req, res) => {
  const token = cookie(req, sessionCookieName);
  if (token)
    db.prepare("DELETE FROM sessions WHERE token_hash=?").run(tokenHash(token));
  sessionCookie(res, "", true);
  res.json({ ok: true });
});
app.post("/api/auth/change-password", authenticated, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (
    !verifyPassword(String(currentPassword || ""), req.user.password_hash) ||
    typeof newPassword !== "string" ||
    newPassword.length < 12 ||
    newPassword.length > 1024
  )
    return res.status(400).json({
      error:
        "Aktuelles Passwort prüfen und ein neues mit mindestens 12 Zeichen wählen.",
    });
  db.prepare(
    "UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?",
  ).run(hashPassword(newPassword), req.user.id);
  rotateSessions(res, req.user.id);
  res.json({ ok: true });
});
app.post(
  "/api/auth/2fa/start",
  authenticated,
  asyncRoute(async (req, res) => {
    if (req.user.must_change_password)
      return res
        .status(403)
        .json({ error: "Bitte zuerst das Passwort ändern." });
    if (req.user.totp_secret)
      return res.status(409).json({ error: "2FA ist bereits aktiv." });
    const secret = newTotpSecret();
    db.prepare("UPDATE users SET pending_totp_secret=? WHERE id=?").run(
      encrypt(secret),
      req.user.id,
    );
    const uri = `otpauth://totp/MiniMail:${encodeURIComponent(req.user.username)}?secret=${secret}&issuer=MiniMail&algorithm=SHA1&digits=6&period=30`;
    res.json({
      secret,
      qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }),
    });
  }),
);
app.post("/api/auth/2fa/verify", authenticated, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
  if (
    !user.pending_totp_secret ||
    !verifyTotp(decrypt(user.pending_totp_secret), req.body?.code)
  )
    return res.status(400).json({ error: "Der Code ist ungültig." });
  db.prepare(
    "UPDATE users SET totp_secret=pending_totp_secret,pending_totp_secret=NULL WHERE id=?",
  ).run(user.id);
  rotateSessions(res, user.id);
  res.json({ ok: true });
});
app.use("/api", authenticated, ready);

app.patch("/api/settings/contacts", (req, res) => {
  if (typeof req.body?.collectRecipients !== "boolean")
    return res.status(400).json({ error: "Ungültige Einstellung." });
  db.prepare("UPDATE users SET collect_recipients=? WHERE id=?").run(
    Number(req.body.collectRecipients),
    req.user.id,
  );
  res.json({ collectRecipients: req.body.collectRecipients });
});

app.get("/api/contacts", (req, res) => {
  const query = String(req.query.q || "").trim();
  if (query.length > 200)
    return res.status(400).json({ error: "Suchbegriff zu lang." });
  const contacts = db
    .prepare(
      "SELECT * FROM contacts WHERE user_id=? ORDER BY name COLLATE NOCASE, email COLLATE NOCASE",
    )
    .all(req.user.id);
  res.json(
    (query
      ? contacts.filter((item) =>
          `${item.name} ${item.email}`
            .toLocaleLowerCase()
            .includes(query.toLocaleLowerCase()),
        )
      : contacts
    ).map(publicContact),
  );
});

function publicContact(contact) {
  const { pgp_public, smime_cert, user_id, created_at, updated_at, ...rest } =
    contact;
  return {
    ...rest,
    hasPgpKey: !!pgp_public,
    hasSmimeCertificate: !!smime_cert,
  };
}

function contactFor(req, res) {
  const contact = db
    .prepare("SELECT * FROM contacts WHERE id=? AND user_id=?")
    .get(Number(req.params.id), req.user.id);
  if (!contact) res.status(404).json({ error: "Kontakt nicht gefunden." });
  return contact;
}

app.post("/api/contacts", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : null;
  const email =
    typeof req.body?.email === "string" ? req.body.email.trim() : null;
  if (!validContact(name, email))
    return res
      .status(400)
      .json({ error: "Name oder E-Mail-Adresse ungültig." });
  try {
    const result = db
      .prepare(
        "INSERT INTO contacts (user_id,name,email,source,created_at,updated_at) VALUES (?, ?, ?, 'manual', ?, ?)",
      )
      .run(req.user.id, name, email, Date.now(), Date.now());
    res
      .status(201)
      .json(
        publicContact(
          db
            .prepare("SELECT * FROM contacts WHERE id=?")
            .get(result.lastInsertRowid),
        ),
      );
  } catch (error) {
    if (
      error.code === "ERR_SQLITE_ERROR" &&
      error.message.startsWith("UNIQUE constraint failed: contacts.")
    )
      return res
        .status(409)
        .json({ error: "Diese Adresse ist bereits im Adressbuch." });
    throw error;
  }
});

app.put("/api/contacts/:id", (req, res) => {
  const id = Number(req.params.id);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : null;
  const email =
    typeof req.body?.email === "string" ? req.body.email.trim() : null;
  if (!Number.isSafeInteger(id) || id < 1 || !validContact(name, email))
    return res
      .status(400)
      .json({ error: "Name oder E-Mail-Adresse ungültig." });
  const previous = db
    .prepare("SELECT * FROM contacts WHERE id=? AND user_id=?")
    .get(id, req.user.id);
  if (!previous)
    return res.status(404).json({ error: "Kontakt nicht gefunden." });
  try {
    const result = db
      .prepare(
        "UPDATE contacts SET name=?,email=?,source='manual',updated_at=? WHERE id=? AND user_id=?",
      )
      .run(name, email, Date.now(), id, req.user.id);
    if (!result.changes)
      return res.status(404).json({ error: "Kontakt nicht gefunden." });
    if (previous.email.toLowerCase() !== email.toLowerCase())
      db.prepare(
        "UPDATE contacts SET pgp_public=NULL,smime_cert=NULL WHERE id=? AND user_id=?",
      ).run(id, req.user.id);
    res.json(
      publicContact(db.prepare("SELECT * FROM contacts WHERE id=?").get(id)),
    );
  } catch (error) {
    if (
      error.code === "ERR_SQLITE_ERROR" &&
      error.message.startsWith("UNIQUE constraint failed: contacts.")
    )
      return res
        .status(409)
        .json({ error: "Diese Adresse ist bereits im Adressbuch." });
    throw error;
  }
});

app.delete("/api/contacts/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1)
    return res.status(400).json({ error: "Ungültiger Kontakt." });
  const result = db
    .prepare("DELETE FROM contacts WHERE id=? AND user_id=?")
    .run(id, req.user.id);
  if (!result.changes)
    return res.status(404).json({ error: "Kontakt nicht gefunden." });
  res.json({ ok: true });
});

app.put(
  "/api/contacts/:id/crypto/:kind",
  asyncRoute(async (req, res) => {
    const contact = contactFor(req, res);
    if (!contact) return;
    const kind = req.params.kind;
    try {
      if (kind === "pgp") {
        const key = String(req.body?.publicKey || "");
        const { fingerprint } = await validatePgpPublic(key, contact.email);
        db.prepare(
          "UPDATE contacts SET pgp_public=?,updated_at=? WHERE id=? AND user_id=?",
        ).run(key, Date.now(), contact.id, req.user.id);
        return res.json({ ok: true, fingerprint });
      }
      if (kind === "smime") {
        const certificate = String(req.body?.certificate || "");
        const { fingerprint } = validateSmimeCertificate(
          certificate,
          contact.email,
        );
        db.prepare(
          "UPDATE contacts SET smime_cert=?,updated_at=? WHERE id=? AND user_id=?",
        ).run(certificate, Date.now(), contact.id, req.user.id);
        return res.json({ ok: true, fingerprint });
      }
      return res.status(404).json({ error: "Verfahren nicht gefunden." });
    } catch {
      return res.status(400).json({
        error:
          "Schlüssel oder Zertifikat ist ungültig oder passt nicht zur Adresse.",
      });
    }
  }),
);

app.delete("/api/contacts/:id/crypto/:kind", (req, res) => {
  const contact = contactFor(req, res);
  if (!contact) return;
  const column = { pgp: "pgp_public", smime: "smime_cert" }[req.params.kind];
  if (!column)
    return res.status(404).json({ error: "Verfahren nicht gefunden." });
  db.prepare(
    `UPDATE contacts SET ${column}=NULL,updated_at=? WHERE id=? AND user_id=?`,
  ).run(Date.now(), contact.id, req.user.id);
  res.json({ ok: true });
});

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    twoFactorEnabled: !!user.totp_secret,
    mustChangePassword: !!user.must_change_password,
    createdAt: user.created_at,
  };
}
app.get("/api/admin/users", adminOnly, (req, res) => {
  res.json(db.prepare("SELECT * FROM users ORDER BY id").all().map(publicUser));
});
app.post("/api/admin/users", adminOnly, (req, res) => {
  const username = String(req.body?.username || "").trim();
  if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username))
    return res.status(400).json({
      error: "Benutzername: 3–40 Zeichen (Buchstaben, Zahlen, . _ -).",
    });
  if (db.prepare("SELECT id FROM users WHERE username=?").get(username))
    return res
      .status(409)
      .json({ error: "Benutzername ist bereits vergeben." });
  const temporaryPassword = randomToken();
  const result = db
    .prepare(
      "INSERT INTO users (username,password_hash,created_at,role,must_change_password) VALUES (?,?,?,'user',1)",
    )
    .run(username, hashPassword(temporaryPassword), Date.now());
  res.status(201).json({
    user: publicUser(
      db
        .prepare("SELECT * FROM users WHERE id=?")
        .get(Number(result.lastInsertRowid)),
    ),
    temporaryPassword,
  });
});
app.post("/api/admin/users/:id/reset-password", adminOnly, (req, res) => {
  const user = db
    .prepare("SELECT * FROM users WHERE id=?")
    .get(Number(req.params.id));
  if (!user) return res.status(404).json({ error: "Benutzer nicht gefunden." });
  if (user.id === req.user.id)
    return res
      .status(400)
      .json({ error: "Eigenes Passwort über das Profil ändern." });
  const temporaryPassword = randomToken();
  db.prepare(
    "UPDATE users SET password_hash=?, must_change_password=1 WHERE id=?",
  ).run(hashPassword(temporaryPassword), user.id);
  db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
  res.json({ temporaryPassword });
});
app.post("/api/admin/users/:id/reset-2fa", adminOnly, (req, res) => {
  const user = db
    .prepare("SELECT * FROM users WHERE id=?")
    .get(Number(req.params.id));
  if (!user) return res.status(404).json({ error: "Benutzer nicht gefunden." });
  if (user.id === req.user.id)
    return res
      .status(400)
      .json({ error: "Eigene 2FA kann hier nicht zurückgesetzt werden." });
  db.prepare(
    "UPDATE users SET totp_secret=NULL,pending_totp_secret=NULL WHERE id=?",
  ).run(user.id);
  db.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
  res.json({ ok: true });
});

function publicAccount(account) {
  const {
    password_enc,
    smtp_password_enc,
    pgp_private_enc,
    pgp_passphrase_enc,
    smime_key_enc,
    smime_cert,
    user_id,
    ...rest
  } = account;
  return {
    ...rest,
    hasPgpKey: !!pgp_private_enc,
    hasSmimeCertificate: !!smime_cert && !!smime_key_enc,
    smimeCertificateExpired:
      !!smime_cert &&
      !certificateIsCurrent(new crypto.X509Certificate(smime_cert)),
    cryptoSignDefault: !!rest.crypto_sign_default,
    cryptoEncryptDefault: !!rest.crypto_encrypt_default,
    imap_secure: !!rest.imap_secure,
    smtp_secure: !!rest.smtp_secure,
    check_failed: !!rest.check_failed,
    is_primary: !!rest.is_primary,
    smtp_username: rest.smtp_username || "",
    needsCredentials: !decrypt(password_enc),
  };
}
function accountFor(req, res) {
  const account = db
    .prepare("SELECT * FROM accounts WHERE id=? AND user_id=?")
    .get(Number(req.params.id), req.user.id);
  if (!account) res.status(404).json({ error: "Postfach nicht gefunden." });
  return account;
}
app.get("/api/accounts/:id/crypto", (req, res) => {
  const account = accountFor(req, res);
  if (!account) return;
  res.json({
    mode: account.crypto_mode,
    sign: !!account.crypto_sign_default,
    encrypt: !!account.crypto_encrypt_default,
    hasPgpKey: !!account.pgp_private_enc,
    hasSmimeCertificate: !!account.smime_cert && !!account.smime_key_enc,
    smimeCertificateExpired:
      !!account.smime_cert &&
      !certificateIsCurrent(new crypto.X509Certificate(account.smime_cert)),
  });
});
app.patch("/api/accounts/:id/crypto", (req, res) => {
  const account = accountFor(req, res);
  if (!account) return;
  const { mode, sign, encrypt: encryptMail } = req.body || {};
  if (
    !["none", "pgp", "smime"].includes(mode) ||
    typeof sign !== "boolean" ||
    typeof encryptMail !== "boolean" ||
    (mode === "none" && (sign || encryptMail)) ||
    (mode !== "none" && !sign && !encryptMail)
  )
    return res
      .status(400)
      .json({ error: "Ungültige Verschlüsselungseinstellung." });
  if ((sign || encryptMail) && mode === "pgp" && !account.pgp_private_enc)
    return res.status(400).json({ error: "OpenPGP-Privatschlüssel fehlt." });
  if (
    (sign || encryptMail) &&
    mode === "smime" &&
    (!account.smime_cert || !account.smime_key_enc)
  )
    return res
      .status(400)
      .json({ error: "S/MIME-Zertifikat mit Privatschlüssel fehlt." });
  if (
    mode === "smime" &&
    !certificateIsCurrent(new crypto.X509Certificate(account.smime_cert))
  )
    return res.status(400).json({
      error:
        "Das S/MIME-Zertifikat ist abgelaufen und kann nur zum Lesen alter Nachrichten verwendet werden.",
    });
  db.prepare(
    "UPDATE accounts SET crypto_mode=?,crypto_sign_default=?,crypto_encrypt_default=? WHERE id=? AND user_id=?",
  ).run(mode, Number(sign), Number(encryptMail), account.id, req.user.id);
  res.json({ mode, sign, encrypt: encryptMail });
});
app.put(
  "/api/accounts/:id/crypto/pgp",
  asyncRoute(async (req, res) => {
    const account = accountFor(req, res);
    if (!account) return;
    const privateKey = req.body?.privateKey;
    const passphrase = req.body?.passphrase || "";
    if (typeof passphrase !== "string" || passphrase.length > 4096)
      return res.status(400).json({ error: "Ungültige Schlüsselpassphrase." });
    try {
      const { fingerprint } = await validatePgpPrivate(
        privateKey,
        passphrase,
        account.email,
      );
      db.prepare(
        "UPDATE accounts SET pgp_private_enc=?,pgp_passphrase_enc=? WHERE id=? AND user_id=?",
      ).run(encrypt(privateKey), encrypt(passphrase), account.id, req.user.id);
      res.json({ ok: true, fingerprint });
    } catch {
      res.status(400).json({
        error:
          "OpenPGP-Privatschlüssel oder Passphrase ist ungültig oder passt nicht zum Postfach.",
      });
    }
  }),
);
app.put(
  "/api/accounts/:id/crypto/smime",
  asyncRoute(async (req, res) => {
    const account = accountFor(req, res);
    if (!account) return;
    const b = req.body || {};
    if (typeof b.passphrase !== "string" || b.passphrase.length > 4096)
      return res.status(400).json({ error: "Ungültige Schlüsselpassphrase." });
    try {
      const identity = b.pkcs12Base64
        ? await readPkcs12(b.pkcs12Base64, b.passphrase, account.email, {
            allowExpired: true,
          })
        : validateSmimeIdentity(
            b.certificate,
            b.privateKey,
            b.passphrase,
            account.email,
            { allowExpired: true },
          );
      db.prepare(
        "UPDATE accounts SET smime_cert=?,smime_key_enc=? WHERE id=? AND user_id=?",
      ).run(
        identity.certificate,
        encrypt(identity.privateKey),
        account.id,
        req.user.id,
      );
      res.json({ ok: true, fingerprint: identity.fingerprint });
    } catch {
      res.status(400).json({
        error:
          "S/MIME-Datei, Zertifikat oder Passphrase ist ungültig oder passt nicht zum Postfach.",
      });
    }
  }),
);
app.delete("/api/accounts/:id/crypto/:kind", (req, res) => {
  const account = accountFor(req, res);
  if (!account) return;
  if (req.params.kind === "pgp")
    db.prepare(
      "UPDATE accounts SET pgp_private_enc=NULL,pgp_passphrase_enc=NULL,crypto_mode=CASE WHEN crypto_mode='pgp' THEN 'none' ELSE crypto_mode END,crypto_sign_default=CASE WHEN crypto_mode='pgp' THEN 0 ELSE crypto_sign_default END,crypto_encrypt_default=CASE WHEN crypto_mode='pgp' THEN 0 ELSE crypto_encrypt_default END WHERE id=? AND user_id=?",
    ).run(account.id, req.user.id);
  else if (req.params.kind === "smime")
    db.prepare(
      "UPDATE accounts SET smime_cert=NULL,smime_key_enc=NULL,crypto_mode=CASE WHEN crypto_mode='smime' THEN 'none' ELSE crypto_mode END,crypto_sign_default=CASE WHEN crypto_mode='smime' THEN 0 ELSE crypto_sign_default END,crypto_encrypt_default=CASE WHEN crypto_mode='smime' THEN 0 ELSE crypto_encrypt_default END WHERE id=? AND user_id=?",
    ).run(account.id, req.user.id);
  else return res.status(404).json({ error: "Verfahren nicht gefunden." });
  res.json({ ok: true });
});
class AccountInputError extends Error {}
function validateAccount(body, role) {
  const fields = ["name", "email", "imap_host", "smtp_host", "username"];
  for (const field of fields)
    if (typeof body[field] !== "string" || !body[field].trim())
      throw new AccountInputError(`${field} fehlt.`);
  if (!/^\S+@\S+\.\S+$/.test(body.email))
    throw new AccountInputError("Ungültige E-Mail-Adresse.");
  for (const field of ["imap_port", "smtp_port"])
    if (
      !Number.isInteger(Number(body[field])) ||
      Number(body[field]) < 1 ||
      Number(body[field]) > 65535
    )
      throw new AccountInputError(`${field} ist ungültig.`);
  if (
    body.password !== undefined &&
    (typeof body.password !== "string" || body.password.length > 2048)
  )
    throw new AccountInputError("Ungültiges Postfach-Passwort.");
  if (
    body.smtp_username != null &&
    (typeof body.smtp_username !== "string" || body.smtp_username.length > 256)
  )
    throw new AccountInputError("Ungültiger SMTP-Benutzername.");
  if (
    body.smtp_password != null &&
    (typeof body.smtp_password !== "string" || body.smtp_password.length > 2048)
  )
    throw new AccountInputError("Ungültiges SMTP-Passwort.");
  if (
    body.check_interval_minutes !== undefined &&
    (!Number.isInteger(Number(body.check_interval_minutes)) ||
      Number(body.check_interval_minutes) < 0 ||
      Number(body.check_interval_minutes) > 1440)
  )
    throw new AccountInputError(
      "Das Abrufintervall muss zwischen 0 und 1440 Minuten liegen.",
    );
  if (body.vpn_profile !== undefined && typeof body.vpn_profile !== "string")
    throw new AccountInputError("Ungültiges VPN-Profil.");
  if (
    body.sender_name !== undefined &&
    (typeof body.sender_name !== "string" ||
      body.sender_name.length > 256 ||
      /[\r\n\u0000-\u001f\u007f]/.test(body.sender_name))
  )
    throw new AccountInputError("Ungültiger Absendername.");
  if (
    body.signature !== undefined &&
    (typeof body.signature !== "string" || body.signature.length > 10000)
  )
    throw new AccountInputError("Ungültige Signatur.");
  if (
    body.vpn_profile &&
    (role !== "admin" ||
      !vpnProfiles().some((profile) => profile.id === body.vpn_profile))
  )
    throw new AccountInputError("Dieses VPN-Profil ist nicht verfügbar.");
}
app.get("/api/vpn-profiles", (req, res) => {
  res.json(req.user.role === "admin" ? vpnProfiles() : []);
});
app.get("/api/accounts", (req, res) => {
  res.json(
    db
      .prepare("SELECT * FROM accounts WHERE user_id=? ORDER BY id")
      .all(req.user.id)
      .map(publicAccount),
  );
});
app.post(
  "/api/accounts/test",
  asyncRoute(async (req, res) => {
    validateAccount(req.body || {}, req.user.role);
    const existing = req.body.id
      ? db
          .prepare("SELECT * FROM accounts WHERE id=? AND user_id=?")
          .get(Number(req.body.id), req.user.id)
      : null;
    const password =
      req.body.password || (existing && decrypt(existing.password_enc));
    const smtp_password =
      req.body.smtp_password ||
      (existing?.smtp_password_enc && decrypt(existing.smtp_password_enc));
    if (!password)
      return res.status(400).json({ error: "Postfach-Passwort fehlt." });
    await testAccount({ ...req.body, password, smtp_password });
    res.json({ ok: true });
  }),
);
app.post(
  "/api/accounts",
  asyncRoute(async (req, res) => {
    validateAccount(req.body || {}, req.user.role);
    if (!req.body.password)
      return res.status(400).json({ error: "Postfach-Passwort fehlt." });
    const b = req.body;
    const makePrimary = !db
      .prepare("SELECT id FROM accounts WHERE user_id=? AND is_primary=1")
      .get(req.user.id);
    const result = db
      .prepare(
        "INSERT INTO accounts (user_id,name,email,imap_host,imap_port,imap_secure,smtp_host,smtp_port,smtp_secure,username,password_enc,smtp_username,smtp_password_enc,created_at,check_interval_minutes,is_primary,vpn_profile,sender_name,signature) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        req.user.id,
        b.name.trim(),
        b.email.trim(),
        b.imap_host.trim(),
        Number(b.imap_port),
        b.imap_secure ? 1 : 0,
        b.smtp_host.trim(),
        Number(b.smtp_port),
        b.smtp_secure ? 1 : 0,
        b.username.trim(),
        encrypt(b.password),
        b.smtp_username?.trim() || null,
        b.smtp_password ? encrypt(b.smtp_password) : null,
        Date.now(),
        b.check_interval_minutes === undefined
          ? 5
          : Number(b.check_interval_minutes),
        makePrimary ? 1 : 0,
        b.vpn_profile || "",
        b.sender_name?.trim() || "",
        b.signature || "",
      );
    res.json(
      publicAccount(
        db
          .prepare("SELECT * FROM accounts WHERE id=?")
          .get(Number(result.lastInsertRowid)),
      ),
    );
  }),
);
app.put(
  "/api/accounts/:id",
  asyncRoute(async (req, res) => {
    const existing = accountFor(req, res);
    if (!existing) return;
    validateAccount(req.body || {}, req.user.role);
    const b = req.body;
    db.prepare(
      "UPDATE accounts SET name=?,email=?,imap_host=?,imap_port=?,imap_secure=?,smtp_host=?,smtp_port=?,smtp_secure=?,username=?,password_enc=?,smtp_username=?,smtp_password_enc=?,check_interval_minutes=?,vpn_profile=?,sender_name=?,signature=?,last_checked_at=NULL,inbox_unseen=NULL,inbox_uid_next=NULL,check_failed=0 WHERE id=?",
    ).run(
      b.name.trim(),
      b.email.trim(),
      b.imap_host.trim(),
      Number(b.imap_port),
      b.imap_secure ? 1 : 0,
      b.smtp_host.trim(),
      Number(b.smtp_port),
      b.smtp_secure ? 1 : 0,
      b.username.trim(),
      b.password ? encrypt(b.password) : existing.password_enc,
      b.smtp_username?.trim() || null,
      b.smtp_password ? encrypt(b.smtp_password) : existing.smtp_password_enc,
      b.check_interval_minutes === undefined
        ? existing.check_interval_minutes
        : Number(b.check_interval_minutes),
      b.vpn_profile || "",
      b.sender_name === undefined ? existing.sender_name : b.sender_name.trim(),
      b.signature === undefined ? existing.signature : b.signature,
      existing.id,
    );
    if (existing.email.toLowerCase() !== b.email.trim().toLowerCase())
      db.prepare(
        "UPDATE accounts SET pgp_private_enc=NULL,pgp_passphrase_enc=NULL,smime_cert=NULL,smime_key_enc=NULL,crypto_mode='none',crypto_sign_default=0,crypto_encrypt_default=0 WHERE id=? AND user_id=?",
      ).run(existing.id, req.user.id);
    res.json(
      publicAccount(
        db.prepare("SELECT * FROM accounts WHERE id=?").get(existing.id),
      ),
    );
  }),
);
app.patch("/api/accounts/:id/primary", (req, res) => {
  const account = accountFor(req, res);
  if (!account) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE accounts SET is_primary=0 WHERE user_id=?").run(
      req.user.id,
    );
    db.prepare("UPDATE accounts SET is_primary=1 WHERE id=? AND user_id=?").run(
      account.id,
      req.user.id,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  res.json({ ok: true });
});
app.delete("/api/accounts/:id", (req, res) => {
  const account = accountFor(req, res);
  if (!account) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM accounts WHERE id=?").run(account.id);
    if (account.is_primary)
      db.prepare(
        "UPDATE accounts SET is_primary=1 WHERE id=(SELECT id FROM accounts WHERE user_id=? ORDER BY id LIMIT 1)",
      ).run(req.user.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  res.json({ ok: true });
});
app.get(
  "/api/accounts/:id/folders",
  asyncRoute(async (req, res) => {
    const account = accountFor(req, res);
    if (!account) return;
    res.json(await listFolders(account));
  }),
);
app.patch(
  "/api/accounts/:id/folders/mark-read",
  asyncRoute(async (req, res) => {
    const account = accountFor(req, res);
    if (!account) return;
    const path = req.body?.folder;
    if (typeof path !== "string" || !path.trim() || path.length > 1024)
      return res.status(400).json({ error: "Ordner fehlt." });
    await markFolderRead(account, path);
    if (path.toUpperCase() === "INBOX")
      db.prepare("UPDATE accounts SET inbox_unseen=0 WHERE id=?").run(
        account.id,
      );
    res.json({ ok: true });
  }),
);
function folder(req) {
  return String(req.query.folder || req.body?.folder || "INBOX");
}
app.get(
  "/api/accounts/:id/messages",
  asyncRoute(async (req, res) => {
    const account = accountFor(req, res);
    if (!account) return;
    res.json(
      await listMessages(
        account,
        folder(req),
        String(req.query.q || "").slice(0, 200),
        Math.max(0, Math.floor(Number(req.query.page) || 0)),
        req.query.threaded === "1",
      ),
    );
  }),
);
app.get(
  "/api/accounts/:id/messages/:uid",
  asyncRoute(async (req, res) => {
    const account = accountFor(req, res);
    if (!account) return;
    const message = await getMessage(
      account,
      folder(req),
      Number(req.params.uid),
    );
    if (!message)
      return res.status(404).json({ error: "Nachricht nicht gefunden." });
    res.json(message);
  }),
);
app.get(
  "/api/accounts/:id/messages/:uid/source",
  asyncRoute(async (req, res) => {
    const account = accountFor(req, res);
    if (!account) return;
    const raw = await getMessageSource(
      account,
      folder(req),
      Number(req.params.uid),
    );
    if (!raw)
      return res.status(404).json({ error: "Nachricht nicht gefunden." });
    res.type("text/plain; charset=utf-8").send(raw.toString("utf8"));
  }),
);
app.get(
  "/api/accounts/:id/messages/:uid/attachments/:index",
  asyncRoute(async (req, res) => {
    const account = accountFor(req, res);
    if (!account) return;
    const attachment = await getAttachment(
      account,
      folder(req),
      Number(req.params.uid),
      Number(req.params.index),
    );
    if (!attachment)
      return res.status(404).json({ error: "Anhang nicht gefunden." });
    res.type("application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename || "anhang")}`,
    );
    res.send(attachment.content);
  }),
);
app.patch(
  "/api/accounts/:id/messages/:uid/flags",
  asyncRoute(async (req, res) => {
    const account = accountFor(req, res);
    if (!account) return;
    await updateFlags(
      account,
      folder(req),
      Number(req.params.uid),
      req.body?.flags || {},
    );
    res.json({ ok: true });
  }),
);
app.post(
  "/api/accounts/:id/messages/:uid/move",
  asyncRoute(async (req, res) => {
    const account = accountFor(req, res);
    if (!account) return;
    if (!req.body?.destination)
      return res.status(400).json({ error: "Zielordner fehlt." });
    await moveMessage(
      account,
      folder(req),
      Number(req.params.uid),
      req.body.destination,
    );
    res.json({ ok: true });
  }),
);
app.delete(
  "/api/accounts/:id/messages/:uid",
  asyncRoute(async (req, res) => {
    const account = accountFor(req, res);
    if (!account) return;
    await deleteMessage(account, folder(req), Number(req.params.uid));
    res.json({ ok: true });
  }),
);
app.post(
  "/api/accounts/:id/trash/empty",
  asyncRoute(async (req, res) => {
    const account = accountFor(req, res);
    if (!account) return;
    const path = req.body?.folder;
    if (typeof path !== "string" || !path.trim() || path.length > 1024)
      return res.status(400).json({ error: "Papierkorb fehlt." });
    const deleted = await emptyTrash(account, path);
    if (deleted === null)
      return res.status(400).json({ error: "Kein Papierkorb-Ordner." });
    res.json({ ok: true, deleted });
  }),
);
const maxAttachmentBytes = 8 * 1024 * 1024;
function validOutgoingMail(mail) {
  if (
    typeof mail.to !== "string" ||
    ![mail.to, mail.cc, mail.bcc].some(
      (field) => typeof field === "string" && field.trim(),
    ) ||
    mail.to.length > 4096 ||
    /[\r\n]/.test(mail.to) ||
    (mail.cc !== undefined &&
      (typeof mail.cc !== "string" ||
        mail.cc.length > 4096 ||
        /[\r\n]/.test(mail.cc))) ||
    (mail.bcc !== undefined &&
      (typeof mail.bcc !== "string" ||
        mail.bcc.length > 4096 ||
        /[\r\n]/.test(mail.bcc))) ||
    (mail.subject !== undefined &&
      (typeof mail.subject !== "string" ||
        mail.subject.length > 998 ||
        /[\r\n]/.test(mail.subject))) ||
    (mail.inReplyTo !== undefined &&
      (typeof mail.inReplyTo !== "string" ||
        !/^<[^<>\r\n]{1,998}>$/.test(mail.inReplyTo))) ||
    (mail.references !== undefined &&
      (!Array.isArray(mail.references) ||
        mail.references.length > 30 ||
        mail.references.some(
          (id) => typeof id !== "string" || !/^<[^<>\r\n]{1,998}>$/.test(id),
        ))) ||
    typeof mail.text !== "string" ||
    mail.text.length > 500000 ||
    (mail.crypto !== undefined &&
      (!mail.crypto ||
        typeof mail.crypto !== "object" ||
        Array.isArray(mail.crypto) ||
        !["none", "pgp", "smime"].includes(mail.crypto.mode) ||
        typeof mail.crypto.sign !== "boolean" ||
        typeof mail.crypto.encrypt !== "boolean" ||
        (mail.crypto.mode === "none" &&
          (mail.crypto.sign || mail.crypto.encrypt)) ||
        (mail.crypto.mode !== "none" &&
          !mail.crypto.sign &&
          !mail.crypto.encrypt))) ||
    (mail.attachments !== undefined && !Array.isArray(mail.attachments))
  )
    return false;
  const attachments = mail.attachments || [];
  if (attachments.length > 8) return false;
  let totalBytes = 0;
  for (const file of attachments) {
    const data = file?.data;
    const padding =
      typeof data === "string"
        ? data.endsWith("==")
          ? 2
          : data.endsWith("=")
            ? 1
            : 0
        : 0;
    const content = padding ? data.slice(0, -padding) : data;
    if (
      !file ||
      typeof file.name !== "string" ||
      !file.name ||
      file.name.length > 255 ||
      /[\u0000-\u001f\u007f]/.test(file.name) ||
      typeof data !== "string" ||
      data.length > Math.ceil((maxAttachmentBytes * 4) / 3) + 4 ||
      data.length % 4 !== 0 ||
      content.includes("=") ||
      /[^A-Za-z0-9+/]/.test(content)
    )
      return false;
    totalBytes += (data.length / 4) * 3 - padding;
    if (totalBytes > maxAttachmentBytes) return false;
  }
  return true;
}
app.post(
  "/api/accounts/:id/send",
  asyncRoute(async (req, res) => {
    const account = accountFor(req, res);
    if (!account) return;
    const b = {
      ...(req.body || {}),
      crypto: req.body?.crypto ?? {
        mode: account.crypto_mode,
        sign: !!account.crypto_sign_default,
        encrypt: !!account.crypto_encrypt_default,
      },
    };
    if (!validOutgoingMail(b))
      return res
        .status(400)
        .json({ error: "Empfänger, Nachricht oder Anhänge sind ungültig." });
    if (
      (b.crypto.sign || b.crypto.encrypt) &&
      b.crypto.mode === "pgp" &&
      !account.pgp_private_enc
    )
      return res.status(400).json({ error: "OpenPGP-Privatschlüssel fehlt." });
    if (
      (b.crypto.sign || b.crypto.encrypt) &&
      b.crypto.mode === "smime" &&
      (!account.smime_cert || !account.smime_key_enc)
    )
      return res
        .status(400)
        .json({ error: "S/MIME-Zertifikat mit Privatschlüssel fehlt." });
    const result = await sendMessage(account, b);
    res.json(result);
    if (req.user.collect_recipients) {
      try {
        const own = db
          .prepare("SELECT email FROM accounts WHERE user_id=?")
          .all(req.user.id)
          .map((item) => item.email);
        collectSentRecipients(db, req.user.id, b, own);
      } catch (error) {
        console.error("Could not collect sent recipients:", error);
      }
    }
  }),
);

const dist = path.resolve("dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) =>
    req.path.startsWith("/api/")
      ? next()
      : res.sendFile(path.join(dist, "index.html")),
  );
}
app.use((error, req, res, next) => {
  if (error instanceof AccountInputError || error instanceof CryptoInputError)
    return res.status(400).json({ error: error.message });
  if (error.type === "entity.too.large")
    return res.status(413).json({ error: "Die Anfrage ist zu groß." });
  if (error.type === "entity.parse.failed")
    return res.status(400).json({ error: "Ungültiges JSON." });
  if (process.env.NODE_ENV === "production")
    console.error("MiniMail request failed", {
      method: req.method,
      path: req.path,
      code: error.code || null,
      stage: error.mailStage || null,
    });
  else console.error(error);
  const message = error.message || "Ein Fehler ist aufgetreten.";
  res
    .status(
      message.includes("fehlt") || message.includes("ungültig") ? 400 : 500,
    )
    .json({
      error: error.mailStage
        ? `${error.mailStage}-Verbindung oder Anmeldung fehlgeschlagen. Bitte Server, Port und Zugangsdaten prüfen.`
        : process.env.NODE_ENV === "production"
          ? "Die Anfrage konnte nicht abgeschlossen werden. Bitte Verbindung und Eingaben prüfen."
          : message,
    });
});
app.listen(port, host, () =>
  console.log(`MiniMail server: http://${host}:${port}`),
);
if (process.env.DISABLE_MAIL_CHECKS !== "1") startMailChecks();
