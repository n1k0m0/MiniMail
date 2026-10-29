import { db } from "./db.js";
console.log(
  db.prepare("SELECT id FROM users LIMIT 1").get()
    ? "configured"
    : "needs-admin",
);
db.close();
