import { encrypt, decrypt } from "./security.js";
import { validOutgoingMail } from "./mailInput.js";

const validId = (id) => /^[a-zA-Z0-9-]{1,64}$/.test(id);

export function registerDraftRoutes(app, db) {
  db.exec(`CREATE TABLE IF NOT EXISTS drafts (
    user_id INTEGER NOT NULL, id TEXT NOT NULL, data_enc TEXT NOT NULL,
    updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, id)
  )`);
  app.get("/api/drafts", (req, res) => {
    const drafts = db
      .prepare(
        "SELECT id,data_enc,updated_at FROM drafts WHERE user_id=? ORDER BY updated_at DESC",
      )
      .all(req.user.id);
    res.json(
      drafts.map((row) => {
        const draft = JSON.parse(decrypt(row.data_enc));
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
    db.prepare(
      `INSERT INTO drafts (user_id,id,data_enc,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(user_id,id) DO UPDATE SET data_enc=excluded.data_enc, updated_at=excluded.updated_at`,
    ).run(
      req.user.id,
      req.params.id,
      encrypt(JSON.stringify(data)),
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
