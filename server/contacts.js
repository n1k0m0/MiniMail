import addressparser from "nodemailer/lib/addressparser";

export function validContact(name, email) {
  return (
    typeof name === "string" &&
    name.length <= 200 &&
    !/[\u0000-\u001f\u007f]/.test(name) &&
    typeof email === "string" &&
    email.length <= 254 &&
    /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email)
  );
}

export function parseRecipients(fields) {
  return fields.flatMap((field) =>
    addressparser(field || "").filter((item) =>
      validContact(item.name || "", item.address),
    ),
  );
}

export function collectSentRecipients(db, userId, mail, ownEmails = []) {
  const own = new Set(ownEmails.map((email) => email.toLowerCase()));
  const add = db.prepare(
    "INSERT OR IGNORE INTO contacts (user_id,name,email,source,created_at,updated_at) VALUES (?, ?, ?, 'collected', ?, ?)",
  );
  const now = Date.now();
  const seen = new Set();
  for (const item of parseRecipients([mail.to, mail.cc, mail.bcc])) {
    const email = item.address.trim();
    const key = email.toLowerCase();
    if (own.has(key) || seen.has(key)) continue;
    seen.add(key);
    add.run(userId, (item.name || "").trim(), email, now, now);
  }
}
