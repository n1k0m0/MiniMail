// Permission belongs to the browser; preferences additionally belong to the
// signed-in MiniMail user. Never include message contents on the lock screen.
export const notificationKey = (username) =>
  `minimail-notifications:${encodeURIComponent(username)}`;

export function notificationPreferences(
  username,
  storage = globalThis.localStorage,
) {
  try {
    const value = JSON.parse(storage.getItem(notificationKey(username)));
    return { mail: value?.mail === true, calendar: value?.calendar === true };
  } catch {
    return { mail: false, calendar: false };
  }
}

export function notificationSupport() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "Notification" in window
  );
}

const notificationIcons = {
  brand: "/notifications/brand.png",
  mail: "/notifications/mail.png",
  calendar: "/notifications/calendar.png",
};

export function showNotification(title, options, onOpen, kind = "brand") {
  if (!notificationSupport() || Notification.permission !== "granted")
    return false;
  try {
    const notification = new Notification(title, {
      ...options,
      icon: Object.hasOwn(notificationIcons, kind)
        ? notificationIcons[kind]
        : notificationIcons.brand,
    });
    notification.onclick = () => {
      window.focus();
      onOpen?.();
      notification.close();
    };
    return true;
  } catch {
    // Some browsers expose permission but do not support desktop notifications.
    return false;
  }
}

// UIDNEXT detects arrivals independently of read/unread flag changes. Initial
// sync, errors, disabled accounts and UID resets must not announce old mail.
export function mailArrivals(previous, accounts) {
  const next = new Map(previous),
    arrivals = [];
  const present = new Set(accounts.map((account) => account.id));
  for (const id of next.keys()) if (!present.has(id)) next.delete(id);
  for (const account of accounts) {
    if (account.check_failed || account.needsCredentials) continue;
    const uid = Number(account.inbox_uid_next);
    if (!Number.isSafeInteger(uid) || uid <= 0) continue;
    const before = next.get(account.id);
    if (before !== undefined && uid > before) arrivals.push(account);
    next.set(account.id, uid);
  }
  return { next, arrivals };
}

export async function notifyOnce(username, category, key, callback) {
  const storageKey = `${notificationKey(username)}:${category}:shown`;
  const claim = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "[]");
      const entries = Array.isArray(stored)
        ? stored
            .filter((entry) => entry?.at > Date.now() - 86400000)
            .slice(-199)
        : [];
      if (entries.some((entry) => entry.key === key)) return;
      if (callback()) {
        entries.push({ key, at: Date.now() });
        localStorage.setItem(storageKey, JSON.stringify(entries));
      }
    } catch {
      // Do not risk repeated popups when browser storage is unavailable.
    }
  };
  if (globalThis.navigator?.locks) {
    try {
      await navigator.locks.request(storageKey, claim);
    } catch {
      claim();
    }
  } else claim();
}
