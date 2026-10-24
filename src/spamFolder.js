// Prefer the server's special-use designation over provider-specific names.
export function findSpamFolder(folders) {
  const selectable = folders.filter(
    (folder) => folder.path && !folder.flags?.has("\\Noselect"),
  );
  const designated = selectable.find(
    (folder) => folder.specialUse?.toLowerCase() === "\\junk",
  );
  if (designated) return designated;
  return selectable.find((folder) => {
    if (folder.specialUse) return false;
    const name = (
      folder.name || folder.path.split(folder.delimiter || "/").at(-1)
    ).trim();
    return /^(spam|junk|junk[ -]?(e-?mail|mail)|unerwünscht|unerwünschte[ -]?(e-?mails?|nachrichten))$/i.test(
      name,
    );
  });
}
