import { randomBytes } from "node:crypto";

/**
 * Generate a cryptographically secure, URL-safe share-link token.
 *
 * Why a dedicated function rather than `generateId()`:
 * the shared package's `generateId()` produces
 * `{Date.now()-base36}-{Math.random()-base36-8-chars}` — that's
 * ~40 bits of entropy from a non-CSPRNG, brute-forceable in days
 * at modest request rates. Share tokens are the entire auth
 * secret for unauthenticated viewers of a trip, so they need
 * proper entropy and a CSPRNG source.
 *
 * Format: 32 random bytes (256 bits) encoded as URL-safe base64
 * → 43 characters of `[A-Za-z0-9_-]`. No timestamp prefix —
 * sharing creation time isn't useful here and would leak the
 * approximate moment a share went live.
 *
 * Existing tokens issued before this change stay valid (they're
 * stored verbatim, not derived) — they're just shorter and from
 * the weaker source. New shares from this commit forward get the
 * stronger format.
 */
export function generateShareToken(): string {
  return randomBytes(32).toString("base64url");
}
