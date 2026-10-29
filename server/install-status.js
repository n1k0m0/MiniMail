import { db } from "./db.js";
console.log(
  (await db.prepare("SELECT id FROM users LIMIT 1").get())
    ? "configured"
    : "needs-admin",
);
await db.close();
