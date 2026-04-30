import { randomBytes } from "crypto";
import {
  decryptToken,
  encryptToken,
  isEncrypted,
  loadEncryptionKey,
} from "../../src/services/token-crypto";

describe("token-crypto", () => {
  const key = randomBytes(32);

  describe("encryptToken / decryptToken", () => {
    it("round-trips a plaintext refresh token", () => {
      const plaintext = "1//0abc-DEF.ghIJklmnopQRStuvwxyz1234567890";
      const ciphertext = encryptToken(plaintext, key);
      expect(ciphertext).not.toContain(plaintext);
      expect(decryptToken(ciphertext, key)).toBe(plaintext);
    });

    it("produces a different ciphertext on each call (fresh nonce)", () => {
      const plaintext = "refresh-token-abc";
      const a = encryptToken(plaintext, key);
      const b = encryptToken(plaintext, key);
      expect(a).not.toBe(b);
      expect(decryptToken(a, key)).toBe(plaintext);
      expect(decryptToken(b, key)).toBe(plaintext);
    });

    it("emits the v1 prefix so the format is identifiable", () => {
      const ciphertext = encryptToken("anything", key);
      expect(ciphertext.startsWith("v1:")).toBe(true);
      expect(isEncrypted(ciphertext)).toBe(true);
      expect(isEncrypted("plain-refresh-token")).toBe(false);
    });

    it("rejects decryption with the wrong key (auth tag mismatch)", () => {
      const ciphertext = encryptToken("secret", key);
      const wrongKey = randomBytes(32);
      expect(() => decryptToken(ciphertext, wrongKey)).toThrow();
    });

    it("rejects tampered ciphertext", () => {
      const ciphertext = encryptToken("secret", key);
      // Flip a nibble in the ciphertext segment.
      const parts = ciphertext.split(":");
      parts[2] = parts[2].replace(/^./, (c) => (c === "f" ? "0" : "f"));
      const tampered = parts.join(":");
      expect(() => decryptToken(tampered, key)).toThrow();
    });

    it("rejects malformed payloads", () => {
      expect(() => decryptToken("not-encrypted-at-all", key)).toThrow();
      expect(() => decryptToken("v1:only-one-part", key)).toThrow();
      expect(() => decryptToken("v1:bad:hex:tag", key)).toThrow();
    });

    it("requires a 32-byte key", () => {
      const shortKey = randomBytes(16);
      expect(() => encryptToken("x", shortKey)).toThrow(/32 bytes/);
      expect(() => decryptToken(encryptToken("x", key), shortKey)).toThrow(
        /32 bytes/,
      );
    });
  });

  describe("loadEncryptionKey", () => {
    const original = process.env.TOKEN_ENCRYPTION_KEY;
    afterEach(() => {
      if (original === undefined) {
        delete process.env.TOKEN_ENCRYPTION_KEY;
      } else {
        process.env.TOKEN_ENCRYPTION_KEY = original;
      }
    });

    it("returns null when the env var is unset", () => {
      delete process.env.TOKEN_ENCRYPTION_KEY;
      expect(loadEncryptionKey()).toBeNull();
    });

    it("returns null when the env var is empty", () => {
      process.env.TOKEN_ENCRYPTION_KEY = "";
      expect(loadEncryptionKey()).toBeNull();
    });

    it("returns a Buffer for valid 64-char hex", () => {
      process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("hex");
      const key = loadEncryptionKey();
      expect(key).toBeInstanceOf(Buffer);
      expect(key!.length).toBe(32);
    });

    it("throws when the key has the wrong byte length", () => {
      process.env.TOKEN_ENCRYPTION_KEY = randomBytes(16).toString("hex");
      expect(() => loadEncryptionKey()).toThrow(/32 bytes/);
    });

    it("throws when the value is not hex", () => {
      process.env.TOKEN_ENCRYPTION_KEY = "not-hex-at-all-zz!!";
      expect(() => loadEncryptionKey()).toThrow(/hex-encoded/);
    });
  });
});
