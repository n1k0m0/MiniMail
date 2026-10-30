import { db } from "./db.js";
import { decrypt } from "./security.js";
import { runAccountMailFilters } from "./mail.js";
import { loadMailRules } from "./mailRuleStore.js";
let running = false;
const checked = new Map();
async function processAccount(id, { force = false } = {}) {
  const account = await db.prepare("SELECT * FROM accounts WHERE id=?").get(id);
  if (!account?.password_enc || !decrypt(account.password_enc)) return;
  const config = await loadMailRules(db, id);
  if (
    !config.pendingFolder &&
    config.job?.state !== "running" &&
    !(config.automatic && config.rules.some((rule) => rule.enabled))
  )
    return;
  if (
    !force &&
    !config.pendingFolder &&
    config.job?.state !== "running" &&
    Date.now() - (checked.get(String(id)) || 0) < 30000
  )
    return;
  checked.set(String(id), Date.now());
  try {
    await runAccountMailFilters(account);
  } catch {
    console.error("Mail filter check deferred", { accountId: id });
  }
}
export function kickMailFilters(accountId) {
  // Re-read credentials and job state in the new activity. Never reuse an old
  // request's account object after an application-data restore.
  setImmediate(() =>
    Promise.resolve()
      .then(() =>
        db.activity(() => processAccount(accountId, { force: true }), true),
      )
      .catch(() => {}),
  );
}
export function startMailRuleChecks() {
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await db.activity(async () => {
        const rows = await db
          .prepare("SELECT id FROM accounts WHERE mail_rules_enc IS NOT NULL")
          .all();
        const existing = new Set(rows.map((row) => String(row.id)));
        for (const id of checked.keys())
          if (!existing.has(id)) checked.delete(id);
        for (let i = 0; i < rows.length; i += 2)
          await Promise.all(
            rows.slice(i, i + 2).map((row) => processAccount(row.id)),
          );
      }, true);
    } catch {
    } finally {
      running = false;
    }
  };
  setTimeout(tick, 7000).unref();
  setInterval(tick, 10000).unref();
}
