import { db } from "./db.js";
import { decrypt } from "./security.js";
import { scanAccountKeys } from "./mail.js";

const accounts = db.prepare("SELECT * FROM accounts ORDER BY id").all();
for (const account of accounts) {
  if (!account.password_enc || !decrypt(account.password_enc)) {
    console.log(`Account ${account.id}: credentials missing`);
    continue;
  }
  let scanned = 0;
  let stored = 0;
  let alternate = 0;
  try {
    while (true) {
      const result = await scanAccountKeys(account);
      scanned += result.scanned;
      stored += result.stored;
      alternate += result.alternate;
      if (!result.pending) break;
      if (result.scanned)
        console.log(
          `Account ${account.id}: ${result.folder}, ${scanned} messages checked, ${stored} keys stored, ${alternate} alternate keys`,
        );
    }
    console.log(
      `Account ${account.id}: complete, ${scanned} messages checked, ${stored} keys stored, ${alternate} alternate keys`,
    );
  } catch (error) {
    console.error(`Account ${account.id}: ${error.message}`);
    process.exitCode = 1;
  }
}
db.close();
