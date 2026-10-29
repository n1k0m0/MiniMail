export function messageSearchCriteria(query, unreadOnly = false) {
  return {
    ...(query
      ? {
          or: [
            { subject: query },
            { from: query },
            { to: query },
            { body: query },
          ],
        }
      : { all: true }),
    ...(unreadOnly ? { seen: false } : {}),
  };
}

export async function listMessagePage(
  client,
  summarize,
  { query = "", page = 0, unreadOnly = false } = {},
) {
  // IMAP applies the read filter before we count and paginate matching UIDs.
  const matches =
    (await client.search(messageSearchCriteria(query, unreadOnly), {
      uid: true,
    })) || [];
  const sorted = [...matches].sort((a, b) => b - a);
  const uids = sorted.slice(page * 60, (page + 1) * 60);
  if (!uids.length) return { messages: [], total: sorted.length, page };
  const messages = await client.fetchAll(
    uids,
    {
      uid: true,
      envelope: true,
      flags: true,
      internalDate: true,
      size: true,
      bodyStructure: true,
    },
    { uid: true },
  );
  const byUid = new Map(messages.map((item) => [item.uid, summarize(item)]));
  return {
    messages: uids.map((uid) => byUid.get(uid)).filter(Boolean),
    total: sorted.length,
    page,
  };
}
