export function replyRecipients(message, ownEmails = [], all = false) {
  const own = new Set(
    ownEmails.filter(Boolean).map((email) => email.toLowerCase()),
  );
  const seen = new Set();
  const unique = (items, excludeOwn) =>
    (items || []).filter((item) => {
      const key = item.address?.toLowerCase();
      if (!key || seen.has(key) || (excludeOwn && own.has(key))) return false;
      seen.add(key);
      return true;
    });
  const replyTarget = message.replyTo?.length
    ? message.replyTo
    : message.from || [];
  let to = unique(replyTarget, false);
  let cc = [];
  if (all) {
    for (const sender of message.from || []) {
      if (sender.address) seen.add(sender.address.toLowerCase());
    }
    const others = unique([...(message.to || []), ...(message.cc || [])], true);
    if (
      to.every((item) => own.has(item.address.toLowerCase())) &&
      others.length
    ) {
      to = others.slice(0, 1);
      cc = others.slice(1);
    } else {
      cc = others;
    }
  }
  return {
    to: to.map((item) => item.address).join(", "),
    cc: cc.map((item) => item.address).join(", "),
  };
}
