import { isTrashFolder } from "./folderTypes.js";

export class MailOperationError extends Error {}

export function requireMailResult(result, message) {
  if (result === false) throw new MailOperationError(message);
  return result;
}

export async function deleteMailboxMessage(client, folder, uid) {
  const folders = await client.list();
  const selectable = (item) => !item.flags?.has("\\Noselect");
  const trash =
    folders.find((item) => item.specialUse === "\\Trash" && selectable(item)) ||
    folders.find((item) => isTrashFolder(item) && selectable(item));
  if (!trash)
    throw new MailOperationError(
      "Kein Papierkorb gefunden. Bitte einen Papierkorb im Postfach einrichten. Die Nachricht wurde nicht gelöscht.",
    );
  const lock = await client.getMailboxLock(folder);
  try {
    if (trash.path !== folder)
      requireMailResult(
        await client.messageMove(uid, trash.path, { uid: true }),
        "Nachricht konnte nicht in den Papierkorb verschoben werden.",
      );
    else
      requireMailResult(
        await client.messageDelete(uid, { uid: true }),
        "Nachricht konnte nicht gelöscht werden.",
      );
  } finally {
    lock.release();
  }
}
