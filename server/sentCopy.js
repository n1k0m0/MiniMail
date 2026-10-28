// SMTP has already accepted the message. Never report a failed send just because
// IMAP cannot save the copy: retrying the whole send could deliver it twice.
export async function saveSentCopy(withClient, createRaw) {
  try {
    return await withClient(async (client) => {
      const folders = await client.list();
      const sent =
        folders.find((item) => item.specialUse === "\\Sent")?.path ||
        folders.find((item) => /^sent$/i.test(item.name))?.path;
      if (!sent) return { saved: false, reason: "folder-missing" };
      const appended = await client.append(sent, await createRaw(), ["\\Seen"]);
      if (!appended) return { saved: false, reason: "append-failed" };
      return { saved: true };
    });
  } catch {
    return { saved: false, reason: "append-failed" };
  }
}
