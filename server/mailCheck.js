import { db } from "./db.js";
import { decrypt } from "./security.js";
import { checkInbox, scanAccountKeys } from "./mail.js";
let running = false;
let scanningKeys = false;
export async function checkDueMailboxes() {
  if (running) return;
  running = true;
  try {
    const due = await db
      .prepare(
        `SELECT * FROM accounts
         WHERE check_interval_minutes > 0
           AND (last_checked_at IS NULL OR last_checked_at + check_interval_minutes * 60000 <= ?)
         ORDER BY last_checked_at, id`,
      )
      .all(Date.now());
    for (let index = 0; index < due.length; index += 3) {
      await Promise.all(
        due.slice(index, index + 3).map(async (account) => {
          try {
            if (!decrypt(account.password_enc)) return;
            const inbox = await checkInbox(account);
            await db
              .prepare(
                "UPDATE accounts SET last_checked_at=?,inbox_unseen=?,inbox_uid_next=?,check_failed=0 WHERE id=?",
              )
              .run(Date.now(), inbox.unseen, inbox.uidNext, account.id);
          } catch {
            await db
              .prepare(
                "UPDATE accounts SET last_checked_at=?,check_failed=1 WHERE id=?",
              )
              .run(Date.now(), account.id);
          }
        }),
      );
    }
  } finally {
    running = false;
  }
}
export function startMailChecks() {
  setTimeout(() => checkDueMailboxes().catch(console.error), 5000).unref();
  setInterval(() => checkDueMailboxes().catch(console.error), 30000).unref();
  const scan = async () => {
    if (scanningKeys) return;
    scanningKeys = true;
    let pending = false;
    try {
      const accounts = await db
        .prepare("SELECT * FROM accounts ORDER BY id")
        .all();
      for (const account of accounts) {
        if (!account.password_enc || !decrypt(account.password_enc)) continue;
        try {
          const result = await scanAccountKeys(account);
          pending ||= result.pending;
          if (result.stored || result.alternate)
            console.log("Mail keys collected", {
              accountId: account.id,
              folder: result.folder,
              stored: result.stored,
              alternate: result.alternate,
            });
        } catch (error) {
          pending = true;
          console.error("Mail key scan failed", {
            accountId: account.id,
            error: error.message,
          });
        }
      }
    } finally {
      scanningKeys = false;
      setTimeout(scan, pending ? 10000 : 300000).unref();
    }
  };
  setTimeout(scan, 10000).unref();
}
