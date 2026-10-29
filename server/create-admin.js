import { db } from "./db.js";
import { hashPassword } from "./security.js";
const username = process.argv[2];
if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username || "")) {
  console.error(
    "Aufruf: npm run admin:create -- <benutzername> (3–40 Zeichen)",
  );
  process.exit(1);
}
if (await db.prepare("SELECT id FROM users LIMIT 1").get()) {
  console.error(
    "Ein Benutzer existiert bereits. Die Admin-Einrichtung ist gesperrt.",
  );
  process.exit(1);
}
if (!process.stdin.isTTY || !process.stdin.setRawMode) {
  console.error(
    "Für die sichere Passworteingabe ist ein interaktives Terminal nötig.",
  );
  process.exit(1);
}
function readSecret(label) {
  return new Promise((resolve, reject) => {
    let value = "";
    process.stdout.write(label);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const onData = (chunk) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\u0003") {
          cleanup();
          reject(new Error("Abgebrochen."));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\b" || char === "\u007f") value = value.slice(0, -1);
        else if (char >= " ") value += char;
      }
    };
    function cleanup() {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
    process.stdin.on("data", onData);
  });
}
try {
  const password = await readSecret("Admin-Passwort (mindestens 12 Zeichen): ");
  const confirmation = await readSecret("Passwort wiederholen: ");
  if (
    password.length < 12 ||
    password.length > 1024 ||
    password !== confirmation
  )
    throw new Error("Passwort zu kurz oder Eingaben stimmen nicht überein.");
  await db
    .prepare(
      "INSERT INTO users (username,password_hash,created_at,role,must_change_password) VALUES (?,?,?,'admin',0)",
    )
    .run(username, await hashPassword(password), Date.now());
  console.log(
    `Admin „${username}“ angelegt. Beim ersten Login wird 2FA eingerichtet.`,
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
