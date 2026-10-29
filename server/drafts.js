import { encrypt, decrypt } from "./security.js";
import { validOutgoingMail } from "./mailInput.js";
const validId = (id) => /^[a-zA-Z0-9-]{1,64}$/.test(id);
export function registerDraftRoutes(app, db) {
  app.get("/api/drafts", async (req, res) => {
    const drafts = await db
      .prepare(
        "SELECT id,metadata_enc,updated_at FROM drafts WHERE user_id=? ORDER BY updated_at DESC",
      )
      .all(req.user.id);
    const summaries = [];
    for (const row of drafts) {
      let draft;
      if (row.metadata_enc) draft = JSON.parse(decrypt(row.metadata_enc));
      else {
        // Read and migrate old attachments one draft at a time.
        const stored = await db
          .prepare("SELECT data_enc FROM drafts WHERE user_id=? AND id=?")
          .get(req.user.id, row.id);
        if (!stored) continue;
        const legacy = JSON.parse(decrypt(stored.data_enc));
        draft = { subject: legacy.subject, to: legacy.to };
        await db
          .prepare("UPDATE drafts SET metadata_enc=? WHERE user_id=? AND id=?")
          .run(encrypt(JSON.stringify(draft)), req.user.id, row.id);
      }
      summaries.push({
        id: row.id,
        subject: draft.subject,
        to: draft.to,
        updatedAt: row.updated_at,
      });
    }
    res.json(summaries);
  });
  app.get("/api/drafts/:id", async (req, res) => {
    const row = await db
      .prepare("SELECT data_enc FROM drafts WHERE user_id=? AND id=?")
      .get(req.user.id, req.params.id);
    if (!row)
      return res.status(404).json({
        error: "Entwurf nicht gefunden.",
      });
    res.json({
      ...JSON.parse(decrypt(row.data_enc)),
      id: req.params.id,
    });
  });
  app.put("/api/drafts/:id", async (req, res) => {
    const draft = req.body;
    if (
      !validId(req.params.id) ||
      !validOutgoingMail(draft, {
        draft: true,
      }) ||
      !Number.isSafeInteger(draft.accountId) ||
      !["compose", "reply", "reply-all", "forward"].includes(draft.type)
    )
      return res.status(400).json({
        error: "Ungültiger Entwurf.",
      });
    if (
      !(await db
        .prepare("SELECT id FROM accounts WHERE id=? AND user_id=?")
        .get(draft.accountId, req.user.id))
    )
      return res.status(400).json({
        error: "Postfach nicht gefunden.",
      });
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
    const saved = await db.transaction(async () => {
      await db
        .prepare("SELECT id FROM users WHERE id=? FOR UPDATE")
        .get(req.user.id);
      const usage = await db
        .prepare(
          "SELECT count(*) AS count,coalesce(sum(length(data_enc)),0) AS bytes FROM drafts WHERE user_id=? AND id<>?",
        )
        .get(req.user.id, req.params.id);
      if (
        usage.count >= 50 ||
        usage.bytes + encrypted.length > 64 * 1024 * 1024
      )
        return false;
      await db
        .prepare(
          `INSERT INTO drafts (user_id,id,data_enc,metadata_enc,updated_at) VALUES (?,?,?,?,?)
      ON DUPLICATE KEY UPDATE data_enc=VALUES(data_enc), metadata_enc=VALUES(metadata_enc), updated_at=VALUES(updated_at)`,
        )
        .run(
          req.user.id,
          req.params.id,
          encrypted,
          encrypt(
            JSON.stringify({
              subject: data.subject,
              to: data.to,
            }),
          ),
          Date.now(),
        );
      return true;
    });
    if (!saved)
      return res
        .status(413)
        .json({ error: "Entwurfsspeicher voll. Bitte alte Entwürfe löschen." });
    res.json({
      id: req.params.id,
    });
  });
  app.delete("/api/drafts/:id", async (req, res) => {
    await db
      .prepare("DELETE FROM drafts WHERE user_id=? AND id=?")
      .run(req.user.id, req.params.id);
    res.json({
      ok: true,
    });
  });
}
