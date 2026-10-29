function normalizeId(value) {
  return String(value || "")
    .trim()
    .replace(/^<|>$/g, "")
    .toLowerCase();
}

function referenceIds(headers) {
  if (!headers) return [];
  const text = headers.toString("utf8").replace(/\r?\n[ \t]+/g, " ");
  const line = text.match(/^references:\s*([^\r\n]*)/im)?.[1] || "";
  return [...line.matchAll(/<([^<>]+)>/g)].map((match) =>
    normalizeId(match[1]),
  );
}

function orderByDate(a, b) {
  const difference = new Date(a.date || 0) - new Date(b.date || 0);
  return difference || a.uid - b.uid;
}

export function groupMessages(items, { unreadOnly = false } = {}) {
  const parents = new Map(items.map((item) => [item.uid, item.uid]));
  const find = (uid) => {
    const parent = parents.get(uid);
    if (parent !== uid) parents.set(uid, find(parent));
    return parents.get(uid);
  };
  const join = (left, right) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parents.set(b, a);
  };
  const byMessageId = new Map();
  const byThreadId = new Map();
  for (const item of items) {
    const id = normalizeId(item.messageId);
    if (id && !byMessageId.has(id)) byMessageId.set(id, item.uid);
  }
  for (const item of items) {
    if (item.threadId) {
      const previous = byThreadId.get(item.threadId);
      if (previous) join(item.uid, previous);
      else byThreadId.set(item.threadId, item.uid);
    }
    const references = [...(item.references || []), item.inReplyTo];
    for (let index = references.length - 1; index >= 0; index--) {
      const parent = byMessageId.get(normalizeId(references[index]));
      if (parent && parent !== item.uid) {
        join(item.uid, parent);
        break;
      }
    }
  }
  const groups = new Map();
  for (const item of items) {
    const root = find(item.uid);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(item);
  }
  return [...groups.values()]
    .map((allMembers) => {
      // Build the complete conversation first: a read message can connect two
      // unread replies. Then show only unread members when filtering is enabled.
      const members = unreadOnly
        ? allMembers.filter((member) => !member.seen)
        : allMembers;
      if (!members.length) return null;
      members.sort(orderByDate);
      const latest = members.at(-1);
      return {
        ...latest,
        thread: members.map(
          ({ messageId, inReplyTo, references, threadId, ...member }) => member,
        ),
        threadUnread: members.some((member) => !member.seen),
      };
    })
    .filter(Boolean)
    .sort((a, b) => orderByDate(b, a));
}

export function messageReferences(headers) {
  return referenceIds(headers);
}
