/**
 * AES-256-GCM encryption for refresh tokens at rest.
 *
 * Refresh tokens persisted to Redis grant long-lived access to a user's
 * Google Drive / Gmail / Calendar. Anyone with read access to the Redis
 * instance (a leaked Upstash token, a compromised host, a careless
 * backup) can use them as-is. Encrypting them with a server-held key
 * means the Redis dump alone isn't enough — an attacker needs the key
 * too.
 *
 * Format on disk: `v1:<nonce-hex>:<ciphertext-hex>:<tag-hex>`
 *   - Versioned prefix (`v1:`) so we can migrate to a stronger scheme
 *     later without touching old entries.
 *   - 12-byte nonce (96 bits) is the GCM standard; freshly random per
 *     encryption.
 *   - 16-byte auth tag, validated on decrypt — wrong key or tampered
 *     ciphertext throws.
 *
 * Backwards compatibility: this module only handles the refresh-token
 * field. Other fields on a TokenEntry (userId, email, updatedAt) stay
 * plaintext for debuggability — they aren't credentials. Old entries
 * stored before encryption was wired up will have a plain refresh token
 * (no `v1:` prefix); `isEncrypted()` lets the reader detect and route
 * accordingly. New writes always go through `encryptToken()` when a key
 * is configured.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const PREFIX = "v1:";

/**
 * Read the at-rest encryption key from `TOKEN_ENCRYPTION_KEY`. Returns
 * `null` when the env var is unset or empty (dev / test fall through to
 * plaintext storage). Throws if the var is set but malformed — better
 * to fail fast at boot than to silently disable encryption in prod.
 *
 * Expected format: 64 lowercase hex chars (= 32 raw bytes). Generate
 * one with `openssl rand -hex 32`.
 */
export function loadEncryptionKey(): Buffer | null {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) return null;
  if (!/^[0-9a-fA-F]+$/.test(raw)) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be hex-encoded — non-hex characters detected.",
    );
  }
  const buf = Buffer.from(raw, "hex");
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${buf.length}). Expected ${KEY_BYTES * 2} hex chars.`,
    );
  }
  return buf;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptToken(plaintext: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new Error(`encryption key must be ${KEY_BYTES} bytes`);
  }
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${nonce.toString("hex")}:${ciphertext.toString("hex")}:${tag.toString("hex")}`;
}

export function decryptToken(payload: string, key: Buffer): string {
  if (!isEncrypted(payload)) {
    throw new Error("decryptToken called on a non-encrypted value");
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(`encryption key must be ${KEY_BYTES} bytes`);
  }
  const body = payload.slice(PREFIX.length);
  const parts = body.split(":");
  if (parts.length !== 3) {
    throw new Error("malformed ciphertext: expected nonce:ciphertext:tag");
  }
  const [nonceHex, ctHex, tagHex] = parts;
  const nonce = Buffer.from(nonceHex, "hex");
  const ciphertext = Buffer.from(ctHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  if (nonce.length !== NONCE_BYTES) {
    throw new Error(`malformed nonce: expected ${NONCE_BYTES} bytes`);
  }
  if (tag.length !== TAG_BYTES) {
    throw new Error(`malformed auth tag: expected ${TAG_BYTES} bytes`);
  }
  const decipher = createDecipheriv(ALGORITHM, key, nonce);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
