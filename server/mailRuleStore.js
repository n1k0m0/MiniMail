import { decrypt, encrypt } from "./security.js";

export class MailRuleError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export async function assertCurrentMailbox(db, account) {
  const current = await db
    .prepare(
      "SELECT imap_host,imap_port,imap_secure,username,vpn_profile FROM accounts WHERE id=?",
    )
    .get(account.id);
  if (!current) throw new MailRuleError("Postfach nicht gefunden.", 404);
  if (
    ["imap_host", "imap_port", "imap_secure", "username", "vpn_profile"].some(
      (key) => String(current[key] ?? "") !== String(account[key] ?? ""),
    )
  )
    throw new MailRuleError(
      "Die Postfachverbindung wurde geändert. Bitte aktualisieren.",
      409,
    );
}
const active = new Set();
export async function mailboxOperation(
  accountId,
  callback,
  { skipBusy = false } = {},
) {
  const key = String(accountId);
  if (active.has(key)) {
    if (skipBusy) return null;
    throw new MailRuleError(
      "Dieses Postfach verarbeitet gerade eine Ordner- oder Filteraktion. Bitte kurz warten.",
      409,
    );
  }
  active.add(key);
  try {
    return await callback();
  } finally {
    active.delete(key);
  }
}
export function emptyMailRules() {
  return {
    version: 1,
    revision: 0,
    rules: [],
    automatic: true,
    ...emptyState(),
  };
}
function emptyState() {
  return {
    cursor: null,
    job: null,
    pendingFolder: null,
    pendingMessage: null,
    lastRun: null,
    lastError: "",
  };
}
function decodeState(value) {
  if (!value) return emptyState();
  try {
    const parsed = JSON.parse(decrypt(value));
    if (parsed.version !== 1) throw new Error();
    return { ...emptyState(), ...parsed };
  } catch {
    throw new MailRuleError(
      "Der Filterstatus konnte nicht gelesen werden. Es wurde nichts überschrieben.",
      500,
    );
  }
}
function settingsPart(config) {
  return {
    version: 1,
    revision: config.revision,
    rules: config.rules,
    automatic: config.automatic,
  };
}
function statePart(config) {
  return Object.fromEntries(
    [
      "cursor",
      "job",
      "pendingFolder",
      "pendingMessage",
      "lastRun",
      "lastError",
    ].map((key) => [key, config[key]]),
  );
}
export function decodeMailRules(value, stateValue) {
  if (!value) return { ...emptyMailRules(), ...decodeState(stateValue) };
  try {
    const data = JSON.parse(decrypt(value));
    if (
      data.version !== 1 ||
      !Array.isArray(data.rules) ||
      data.rules.length > 100 ||
      !Number.isSafeInteger(data.revision) ||
      data.revision < 0
    )
      throw new Error();
    return { ...emptyMailRules(), ...data, ...decodeState(stateValue) };
  } catch {
    throw new MailRuleError(
      "Die gespeicherten Mailfilter konnten nicht gelesen werden. Es wurden keine Regeln überschrieben.",
      500,
    );
  }
}
export async function loadMailRules(db, accountId) {
  const row = await db
    .prepare(
      "SELECT mail_rules_enc,mail_rule_state_enc FROM accounts WHERE id=?",
    )
    .get(accountId);
  if (!row) throw new MailRuleError("Postfach nicht gefunden.", 404);
  return decodeMailRules(row.mail_rules_enc, row.mail_rule_state_enc);
}
export async function changeMailRules(db, accountId, callback) {
  return db.transaction(async () => {
    const row = await db
      .prepare(
        "SELECT mail_rules_enc,mail_rule_state_enc FROM accounts WHERE id=? FOR UPDATE",
      )
      .get(accountId);
    if (!row) throw new MailRuleError("Postfach nicht gefunden.", 404);
    const config = decodeMailRules(row.mail_rules_enc, row.mail_rule_state_enc);
    const beforeSettings = JSON.stringify(settingsPart(config)),
      beforeState = JSON.stringify(statePart(config));
    await callback(config);
    const afterSettings = JSON.stringify(settingsPart(config)),
      afterState = JSON.stringify(statePart(config));
    if (beforeSettings !== afterSettings || !row.mail_rules_enc)
      await db
        .prepare("UPDATE accounts SET mail_rules_enc=? WHERE id=?")
        .run(encrypt(afterSettings), accountId);
    if (beforeState !== afterState)
      await db
        .prepare("UPDATE accounts SET mail_rule_state_enc=? WHERE id=?")
        .run(
          encrypt(JSON.stringify({ version: 1, ...statePart(config) })),
          accountId,
        );
    return config;
  });
}
export async function changeMailRuleState(db, accountId, callback) {
  return db.transaction(async () => {
    const row = await db
      .prepare("SELECT mail_rule_state_enc FROM accounts WHERE id=? FOR UPDATE")
      .get(accountId);
    if (!row) throw new MailRuleError("Postfach nicht gefunden.", 404);
    const state = decodeState(row.mail_rule_state_enc);
    await callback(state);
    await db
      .prepare("UPDATE accounts SET mail_rule_state_enc=? WHERE id=?")
      .run(
        encrypt(JSON.stringify({ version: 1, ...statePart(state) })),
        accountId,
      );
    return state;
  });
}
export function assertNoFolderOperation(config) {
  if (config.pendingFolder)
    throw new MailRuleError(
      "Eine Ordneränderung muss zuerst mit dem Mailserver abgeglichen werden. Bitte die Ordner aktualisieren.",
      409,
    );
}
