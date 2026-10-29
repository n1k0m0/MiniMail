import { encrypt, decrypt } from "./security.js";
import { validOutgoingMail } from "./mailInput.js";

const validId = (id) => /^[a-zA-Z0-9-]{1,64}$/.test(id);

export function registerDraftRoutes(app, db) {
  db.exec(`CREATE TABLE IF NOT EXISTS drafts (
    user_id INTEGER NOT NULL, id TEXT NOT NULL, data_enc TEXT NOT NULL,
    updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, id)
  )`);
  if (
    !db
      .prepare("PRAGMA table_info(drafts)")
      .all()
      .some((column) => column.name === "metadata_enc")
  )
    db.exec("ALTER TABLE drafts ADD COLUMN metadata_enc TEXT");
  app.get("/api/drafts", (req, res) => {
    const drafts = db
      .prepare(
        "SELECT id,metadata_enc,updated_at FROM drafts WHERE user_id=? ORDER BY updated_at DESC",
      )
      .all(req.user.id);
    res.json(
      drafts.map((row) => {
        let draft;
        if (row.metadata_enc) draft = JSON.parse(decrypt(row.metadata_enc));
        else {
          // Migrate one old draft at a time instead of loading every attachment
          // into memory whenever the user opens the draft list.
          const stored = db
            .prepare("SELECT data_enc FROM drafts WHERE user_id=? AND id=?")
            .get(req.user.id, row.id);
          const legacy = JSON.parse(decrypt(stored.data_enc));
          draft = { subject: legacy.subject, to: legacy.to };
          db.prepare(
            "UPDATE drafts SET metadata_enc=? WHERE user_id=? AND id=?",
          ).run(encrypt(JSON.stringify(draft)), req.user.id, row.id);
        }
        return {
          id: row.id,
          subject: draft.subject,
          to: draft.to,
          updatedAt: row.updated_at,
        };
      }),
    );
  });
  app.get("/api/drafts/:id", (req, res) => {
    const row = db
      .prepare("SELECT data_enc FROM drafts WHERE user_id=? AND id=?")
      .get(req.user.id, req.params.id);
    if (!row) return res.status(404).json({ error: "Entwurf nicht gefunden." });
    res.json({ ...JSON.parse(decrypt(row.data_enc)), id: req.params.id });
  });
  app.put("/api/drafts/:id", (req, res) => {
    const draft = req.body;
    if (
      !validId(req.params.id) ||
      !validOutgoingMail(draft, { draft: true }) ||
      !Number.isSafeInteger(draft.accountId) ||
      !["compose", "reply", "reply-all", "forward"].includes(draft.type)
    )
      return res.status(400).json({ error: "Ungültiger Entwurf." });
    if (
      !db
        .prepare("SELECT id FROM accounts WHERE id=? AND user_id=?")
        .get(draft.accountId, req.user.id)
    )
      return res.status(400).json({ error: "Postfach nicht gefunden." });
    // Store only the editor fields, with the same encryption as mailbox credentials.
    const data = Object.fromEntries(
      [
        "accountId",
        "type",
        "to",
        "cc",
        "bcc",
        "subject",
        "text",
        "attachments",
        "crypto",
        "inReplyTo",
        "references",
      ]
        .filter((key) => draft[key] !== undefined)
        .map((key) => [key, draft[key]]),
    );
    const encrypted = encrypt(JSON.stringify(data));
    const usage = db
      .prepare(
        "SELECT count(*) AS count,coalesce(sum(length(data_enc)),0) AS bytes FROM drafts WHERE user_id=? AND id<>?",
      )
      .get(req.user.id, req.params.id);
    if (usage.count >= 50 || usage.bytes + encrypted.length > 64 * 1024 * 1024)
      return res
        .status(413)
        .json({ error: "Entwurfsspeicher voll. Bitte alte Entwürfe löschen." });
    db.prepare(
      `INSERT INTO drafts (user_id,id,data_enc,metadata_enc,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(user_id,id) DO UPDATE SET data_enc=excluded.data_enc, metadata_enc=excluded.metadata_enc, updated_at=excluded.updated_at`,
    ).run(
      req.user.id,
      req.params.id,
      encrypted,
      encrypt(JSON.stringify({ subject: data.subject, to: data.to })),
      Date.now(),
    );
    res.json({ id: req.params.id });
  });
  app.delete("/api/drafts/:id", (req, res) => {
    db.prepare("DELETE FROM drafts WHERE user_id=? AND id=?").run(
      req.user.id,
      req.params.id,
    );
    res.json({ ok: true });
  });
}
