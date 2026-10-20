import { db } from "./db.js";
import { decrypt } from "./security.js";
import { checkInbox } from "./mail.js";

let running = false;

export async function checkDueMailboxes() {
  if (running) return;
  running = true;
  try {
    const due = db
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
            db.prepare(
              "UPDATE accounts SET last_checked_at=?,inbox_unseen=?,inbox_uid_next=?,check_failed=0 WHERE id=?",
            ).run(Date.now(), inbox.unseen, inbox.uidNext, account.id);
          } catch {
            db.prepare(
              "UPDATE accounts SET last_checked_at=?,check_failed=1 WHERE id=?",
            ).run(Date.now(), account.id);
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
}
