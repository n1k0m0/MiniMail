export function isTrashFolder(folder) {
  if (folder?.specialUse) return folder.specialUse === "\\Trash";
  return /^(papierkorb|trash|deleted items|deleted messages|gelöscht|gelöschte elemente)$/i.test(
    folder?.name || "",
  );
}
