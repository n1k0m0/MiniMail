import crypto from "node:crypto";
import {
  MailRuleError,
  loadMailRules,
  changeMailRules,
} from "./mailRuleStore.js";
import { isTrashFolder } from "./folderTypes.js";
import { clearFolderIndex } from "./mailIndex.js";

export const sameFolder = (a, b) =>
  a === b || (/^INBOX$/i.test(a) && /^INBOX$/i.test(b));
export const inFolderTree = (path, parent, delimiter = "/") =>
  sameFolder(path, parent) || path.startsWith(parent + delimiter);
const canonical = (folder) => ({
  path: folder.path,
  name: folder.name,
  delimiter: folder.delimiter || "/",
  specialUse: folder.specialUse || null,
  count: Number(folder.status?.messages || 0),
  unseen: Number(folder.status?.unseen || 0),
  selectable: !folder.flags?.has("\\Noselect"),
});
export async function allRemoteFolders(client) {
  return (
    await client.list({
      statusQuery: { messages: true, unseen: true, uidValidity: true },
    })
  ).map((item) => ({
    ...canonical(item),
    uidValidity: String(item.status?.uidValidity || ""),
  }));
}
export function trashFolder(folders) {
  return (
    folders.find((folder) => folder.specialUse === "\\Trash") ||
    folders.find((folder) => !folder.specialUse && isTrashFolder(folder))
  );
}
function protectedFolder(folder, namespacePrefix = "") {
  const relative =
    namespacePrefix && folder.path.startsWith(namespacePrefix)
      ? folder.path.slice(namespacePrefix.length)
      : folder.path;
  return (
    !!folder.specialUse ||
    /^INBOX$/i.test(folder.path) ||
    /^(trash|papierkorb|deleted items|deleted messages|sent|gesendet|sent messages|drafts|entwürfe|junk|spam|archive|archiv)$/i.test(
      relative,
    )
  );
}
export async function createRemoteFolder(db, client, parent, name) {
  if (
    typeof parent !== "string" ||
    typeof name !== "string" ||
    !name.trim() ||
    name !== name.trim() ||
    name.length > 160 ||
    Buffer.byteLength(name) > 200 ||
    /[\x00-\x1f\x7f/\\]/.test(name) ||
    [".", ".."].includes(name)
  )
    throw new MailRuleError(
      "Bitte einen gültigen Ordnernamen ohne Pfadtrenner eingeben.",
    );
  const folders = await allRemoteFolders(client);
  const matching = folders.find((folder) => sameFolder(folder.path, parent));
  const delimiter =
    matching?.delimiter ||
    folders[0]?.delimiter ||
    client.namespace?.delimiter ||
    "/";
  if (name.includes(delimiter))
    throw new MailRuleError(
      "Der Ordnername darf keinen Hierarchietrenner enthalten.",
    );
  if (
    parent &&
    !matching &&
    !folders.some((folder) => inFolderTree(folder.path, parent, delimiter))
  )
    throw new MailRuleError(
      "Der übergeordnete Ordner wurde nicht gefunden.",
      404,
    );
  const path = parent
    ? parent + delimiter + name
    : (client.namespace?.prefix || "") + name;
  if (path.length > 700) throw new MailRuleError("Der Ordnerpfad ist zu lang.");
  if (folders.some((folder) => sameFolder(folder.path, path)))
    throw new MailRuleError("Dieser Ordner existiert bereits.", 409);
  if ((await db.transaction(() => client.mailboxCreate(path))) === false)
    throw new MailRuleError(
      "Der Mailserver konnte den Ordner nicht anlegen.",
      502,
    );
  await client.mailboxSubscribe(path).catch(() => {});
  if (
    !(await allRemoteFolders(client)).some((folder) =>
      sameFolder(folder.path, path),
    )
  )
    throw new MailRuleError(
      "Das Anlegen des Ordners wurde vom Mailserver nicht bestätigt. Bitte aktualisieren.",
      502,
    );
  return { path };
}
export async function folderDeletePlan(db, account, client, path) {
  if (
    typeof path !== "string" ||
    !path ||
    path.length > 700 ||
    /[\x00-\x1f\x7f]/.test(path)
  )
    throw new MailRuleError("Ungültiger Ordnerpfad.");
  const folders = await allRemoteFolders(client),
    source = folders.find((folder) => sameFolder(folder.path, path));
  if (!source) throw new MailRuleError("Der Ordner wurde nicht gefunden.", 404);
  const descendants = folders.filter((folder) =>
    inFolderTree(folder.path, source.path, source.delimiter),
  );
  if (descendants.length > 2000)
    throw new MailRuleError(
      "Bitte Ordner mit mehr als 2.000 Unterordnern in kleineren Gruppen verschieben.",
    );
  if (
    descendants.some((folder) =>
      protectedFolder(folder, client.namespace?.prefix || ""),
    )
  )
    throw new MailRuleError(
      "Systemordner wie Posteingang, Gesendet und Papierkorb können nicht gelöscht werden.",
      403,
    );
  const trash = trashFolder(folders);
  if (trash && inFolderTree(source.path, trash.path, trash.delimiter))
    throw new MailRuleError(
      "Dieser Ordner liegt bereits im Papierkorb. Er wird nicht erneut gelöscht.",
      409,
    );
  const config = await loadMailRules(db, account.id);
  if (config.pendingFolder)
    throw new MailRuleError(
      "Eine vorherige Ordneränderung muss zuerst geprüft werden. Bitte aktualisieren.",
      409,
    );
  if (config.pendingMessage)
    throw new MailRuleError(
      "Bitte die begonnene Filteraktion zuerst fortsetzen oder abbrechen.",
      409,
    );
  const affected = config.rules.filter(
    (rule) =>
      rule.actions?.moveTo &&
      inFolderTree(rule.actions.moveTo, source.path, source.delimiter),
  );
  const trashPath = trash?.path || (client.namespace?.prefix || "") + "Trash";
  if (inFolderTree(trashPath, source.path, source.delimiter))
    throw new MailRuleError(
      "Der Papierkorb darf nicht innerhalb des zu löschenden Ordners liegen.",
    );
  const hash = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        path: source.path,
        revision: config.revision,
        identity: [
          account.imap_host,
          account.imap_port,
          account.imap_secure,
          account.username,
        ],
        trashPath,
        children: descendants
          .map((folder) => [folder.path, folder.uidValidity])
          .sort(),
      }),
    )
    .digest("hex");
  return {
    path: source.path,
    name: source.name,
    delimiter: source.delimiter,
    trashPath,
    trashExists: !!trash,
    descendants: descendants.map((folder) => folder.path),
    subfolderCount: descendants.length - 1,
    messageCount: descendants.reduce((sum, folder) => sum + folder.count, 0),
    filters: affected.map((rule) => ({ id: rule.id, name: rule.name })),
    hash,
  };
}
export function folderTrashDestination(plan) {
  const name = Array.from(plan.name || "Ordner")
    .slice(0, 80)
    .join("");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const path =
    plan.trashPath +
    plan.delimiter +
    `${name} (${stamp}-${crypto.randomBytes(8).toString("hex")})`;
  if (path.length > 700)
    throw new MailRuleError("Der Zielpfad im Papierkorb ist zu lang.");
  return path;
}
async function clearMovedIndices(db, accountId, pending) {
  for (const path of pending.descendants) {
    const destination = pending.destination + path.slice(pending.path.length);
    for (const folder of [path, destination]) {
      await clearFolderIndex(db, accountId, folder);
      await db
        .prepare("DELETE FROM key_scan_folders WHERE account_id=? AND folder=?")
        .run(accountId, folder);
    }
  }
}
export async function reconcileFolderDelete(db, account, client) {
  const config = await loadMailRules(db, account.id),
    pending = config.pendingFolder;
  if (!pending) return { state: "none" };
  const folders = await allRemoteFolders(client);
  const has = (path) => folders.some((folder) => sameFolder(folder.path, path));
  if (
    has(pending.destination) &&
    pending.descendants.every((path) =>
      has(pending.destination + path.slice(pending.path.length)),
    )
  ) {
    // Clear caches before completing the durable journal. A retry is harmless.
    await clearMovedIndices(db, account.id, pending);
    await changeMailRules(db, account.id, (current) => {
      if (current.pendingFolder?.id !== pending.id)
        throw new MailRuleError("Die Ordneraktion hat sich geändert.", 409);
      const ids = new Set(pending.filterIds);
      current.rules = current.rules.filter((rule) => !ids.has(rule.id));
      if (
        ["running", "failed"].includes(current.job?.state) &&
        (inFolderTree(current.job.folder, pending.path, pending.delimiter) ||
          current.job.ruleIds.some((id) => ids.has(id)))
      )
        current.job = {
          ...current.job,
          state: "cancelled",
          error:
            "Der Quell- oder Zielordner wurde in den Papierkorb verschoben.",
        };
      current.pendingFolder = null;
      current.revision++;
      current.lastError = "";
    });
    return {
      state: "moved",
      path: pending.path,
      destination: pending.destination,
      deletedFilters: pending.filterNames,
    };
  }
  if (has(pending.path) && !has(pending.destination)) {
    await changeMailRules(db, account.id, (current) => {
      if (current.pendingFolder?.id === pending.id)
        current.pendingFolder = null;
    });
    return { state: "not-moved" };
  }
  throw new MailRuleError(
    "Der Mailserver hat die Ordneränderung noch nicht eindeutig bestätigt. Es wurden keine Filter gelöscht. Bitte die Ordner erneut aktualisieren.",
    409,
  );
}
export async function moveRemoteFolderToTrash(
  db,
  account,
  client,
  plan,
  destination,
) {
  if (!plan.trashExists) {
    if (
      (await db.transaction(() => client.mailboxCreate(plan.trashPath))) ===
      false
    )
      throw new MailRuleError(
        "Der Papierkorb konnte nicht angelegt werden. Es wurde nichts gelöscht.",
        502,
      );
    await client.mailboxSubscribe(plan.trashPath).catch(() => {});
  }
  if (
    (await allRemoteFolders(client)).some((folder) =>
      sameFolder(folder.path, destination),
    )
  )
    throw new MailRuleError(
      "Das Ziel im Papierkorb existiert bereits. Bitte erneut bestätigen.",
      409,
    );
  const pending = {
    id: crypto.randomUUID(),
    path: plan.path,
    destination,
    delimiter: plan.delimiter,
    descendants: plan.descendants,
    filterIds: plan.filters.map((rule) => rule.id),
    filterNames: plan.filters.map((rule) => rule.name),
    createdAt: Date.now(),
  };
  await changeMailRules(db, account.id, (current) => {
    if (current.pendingFolder)
      throw new MailRuleError("Eine andere Ordneraktion läuft bereits.", 409);
    current.pendingFolder = pending;
  });
  try {
    if (
      (await db.transaction(() =>
        client.mailboxRename(plan.path, destination),
      )) === false
    )
      throw new Error("rename rejected");
  } catch {
    /* Reconcile the server state after a rejected or lost reply. */
  }
  // A lost IMAP reply is not proof of failure. Confirm the resulting hierarchy
  // before deleting any dependent filters, also after reconnect/restart.
  let result;
  try {
    result = await reconcileFolderDelete(db, account, client);
  } catch (error) {
    throw new MailRuleError(
      "Die Bestätigung des Mailservers fehlt. Die Filter bleiben geschützt; bitte die Ordner aktualisieren.",
      502,
    );
  }
  if (result.state !== "moved")
    throw new MailRuleError(
      "Der Mailserver hat den Ordner nicht in den Papierkorb verschoben. Die Filter wurden beibehalten.",
      502,
    );
  await client.mailboxSubscribe(destination).catch(() => {});
  return result;
}
