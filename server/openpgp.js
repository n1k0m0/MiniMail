import * as pgp from "openpgp";

export const maxDecompressedMessageSize = 25 * 1024 * 1024;
export const maxArgon2MemoryExponent = 16; // 64 MiB per key derivation.
const bounded = (operation) => (options) =>
  pgp[operation]({
    ...options,
    config: {
      ...options.config,
      maxDecompressedMessageSize,
      maxArgon2MemoryExponent,
    },
  });
// Apply bounds at both parsing and decryption: compressed packets may appear
// outside encryption too. Never change the library's process-wide defaults.
export const readMessage = bounded("readMessage");
export const decrypt = bounded("decrypt");
export const readPrivateKey = bounded("readPrivateKey");
export const decryptKey = bounded("decryptKey");
export const readKey = bounded("readKey");
export const readSignature = bounded("readSignature");
export const readCleartextMessage = bounded("readCleartextMessage");
export const verify = bounded("verify");
export { createMessage, encrypt, sign, enums } from "openpgp";
