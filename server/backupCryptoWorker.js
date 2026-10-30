// A separate, time-limited process bounds the cost of parsing untrusted backups.
import fs from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as pgp from "openpgp";

const limit = 512 * 1024 * 1024;
const config = {
  aeadProtect: true,
  preferredSymmetricAlgorithm: pgp.enums.symmetric.aes256,
  preferredAEADAlgorithm: pgp.enums.aead.gcm,
  preferredCompressionAlgorithm: pgp.enums.compression.uncompressed,
  s2kType: pgp.enums.s2k.argon2,
  s2kArgon2Params: { passes: 3, parallelism: 4, memoryExponent: 16 },
  maxArgon2MemoryExponent: 16,
  maxDecompressedMessageSize: limit,
};
try {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 8192) throw new Error();
  }
  const { password } = JSON.parse(input);
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 1024
  )
    throw new Error();
  const [action, source, destination] = process.argv.slice(2);
  if (fs.statSync(source).size > limit) throw new Error();
  const stream = Readable.toWeb(fs.createReadStream(source));
  let result;
  if (action === "encrypt") {
    result = await pgp.encrypt({
      message: await pgp.createMessage({ binary: stream }),
      passwords: [password],
      format: "binary",
      config,
    });
  } else if (action === "decrypt") {
    const message = await pgp.readMessage({ binaryMessage: stream, config });
    const packets = message.packets;
    const s2k = packets[0]?.s2k;
    // Only our bounded RFC 9580 password/AEAD profile is accepted. In
    // particular, never run attacker-selected Argon2 pass/lane counts.
    if (
      packets.length !== 2 ||
      packets[0].constructor.tag !== pgp.enums.packet.symEncryptedSessionKey ||
      packets[0].version !== 6 ||
      s2k?.type !== "argon2" ||
      s2k.t !== 3 ||
      s2k.p !== 4 ||
      s2k.encodedM !== 16 ||
      packets[1].constructor.tag !==
        pgp.enums.packet.symEncryptedIntegrityProtectedData ||
      packets[1].version !== 2
    )
      throw new Error();
    result = (
      await pgp.decrypt({
        message,
        passwords: [password],
        format: "binary",
        config,
      })
    ).data;
  } else throw new Error();
  let size = 0;
  const bounded = new Transform({
    transform(chunk, encoding, callback) {
      size += chunk.length;
      callback(size > limit ? new Error() : null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(result),
    bounded,
    fs.createWriteStream(destination, { flags: "wx", mode: 0o600 }),
  );
} catch {
  // Never expose passwords, decrypted contents, or library diagnostic data.
  process.exitCode = 1;
}
