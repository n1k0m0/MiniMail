import { decrypt, matchingTotpCounter, tokenHash } from "./security.js";

// Persist the accepted time step: rejecting replays must also work after a
// restart and with concurrent login requests. Call inside the user's locked
// authentication transaction so a password/2FA reset cannot race a login.
export async function consumeTotp(
  db,
  userId,
  encryptedSecret,
  code,
  now = Date.now(),
) {
  const secret = decrypt(encryptedSecret);
  const counter = matchingTotpCounter(secret, code, now);
  if (counter === null) return false;
  const fingerprint = tokenHash(secret);
  const previous = await db
    .prepare("SELECT * FROM auth_totp_state WHERE user_id=?")
    .get(userId);
  if (previous?.secret_hash === fingerprint && previous.last_counter >= counter)
    return false;
  await db
    .prepare(
      "INSERT INTO auth_totp_state(user_id,secret_hash,last_counter) VALUES (?,?,?) ON DUPLICATE KEY UPDATE secret_hash=VALUES(secret_hash),last_counter=VALUES(last_counter)",
    )
    .run(userId, fingerprint, counter);
  return true;
}
