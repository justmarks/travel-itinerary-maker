/**
 * Stores user refresh tokens server-side.
 *
 * Populated when users authenticate via POST /auth/google. Used by the
 * shared route to mint access tokens for trip owners on behalf of
 * recipients.
 *
 * Two-layer design:
 *   1. In-memory `Map<userId, TokenEntry>` — primary read path; sync.
 *      Holds plaintext refresh tokens.
 *   2. Optional Redis hash (`tokens` field per user) — write-through
 *      persistence. When present, `hydrate()` rebuilds the in-memory
 *      cache from Redis on startup. When absent, the store behaves as
 *      pure in-memory (existing dev / test behaviour).
 *
 * Writes to Redis are best-effort (logged on failure). The in-memory
 * map is the authoritative source for the running process; Redis is
 * the durable shadow that lets a fresh process bootstrap.
 *
 * Encryption at rest: when an encryption key is supplied, the
 * `refreshToken` field of each entry is AES-256-GCM-encrypted before
 * being written to Redis. Other fields (userId, email, updatedAt) stay
 * plaintext for debuggability. On hydrate, the reader detects the
 * `v1:` prefix and decrypts; entries that pre-date encryption (no
 * prefix) are loaded as-is and re-encrypted on the user's next login.
 * If decryption fails for an entry (key mismatch / corruption), the
 * entry is logged and skipped — a single bad row doesn't block boot.
 */

import { google } from "googleapis";
import { config } from "../config/env";
import type { RedisStore } from "./redis-store";
import { decryptToken, encryptToken, isEncrypted } from "./token-crypto";

export interface TokenEntry {
  userId: string;
  refreshToken: string;
  email: string;
  updatedAt: string;
}

const REDIS_HASH = "tokens";

export class TokenStore {
  private tokens: Map<string, TokenEntry> = new Map();
  private redis: RedisStore | null;
  private encryptionKey: Buffer | null;

  constructor(redis: RedisStore | null = null, encryptionKey: Buffer | null = null) {
    this.redis = redis;
    this.encryptionKey = encryptionKey;
  }

  /**
   * Build the at-rest representation of an entry: same shape as the
   * in-memory entry, but with the refresh token encrypted when a key
   * is configured. Returned object is safe to pass directly to Redis.
   */
  private toRedisEntry(entry: TokenEntry): TokenEntry {
    if (!this.encryptionKey) return entry;
    return {
      ...entry,
      refreshToken: encryptToken(entry.refreshToken, this.encryptionKey),
    };
  }

  /**
   * Pull every persisted entry into the in-memory cache. No-op when
   * Redis isn't configured. Call once at server startup.
   */
  async hydrate(): Promise<void> {
    if (!this.redis) return;
    try {
      const all = await this.redis.hgetall<TokenEntry>(REDIS_HASH);
      let skipped = 0;
      for (const [userId, entry] of Object.entries(all)) {
        const decrypted = this.decryptEntry(entry);
        if (!decrypted) {
          skipped += 1;
          continue;
        }
        this.tokens.set(userId, decrypted);
      }
      console.log(
        `[token-store] hydrated ${this.tokens.size} entr${this.tokens.size === 1 ? "y" : "ies"} from Redis${skipped ? ` (skipped ${skipped} undecryptable)` : ""}`,
      );
    } catch (err) {
      console.warn(
        "[token-store] hydrate failed, continuing without persisted tokens:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  /**
   * Convert a Redis-shaped entry into the in-memory form. Returns null
   * when the refresh token is encrypted but no key is configured, or
   * when decryption fails (wrong key, corrupted ciphertext, rotated
   * key). Callers should treat null as "skip this entry"; the user will
   * have to sign in again, and the new entry will overwrite the bad
   * one on their next login.
   */
  private decryptEntry(entry: TokenEntry): TokenEntry | null {
    if (!isEncrypted(entry.refreshToken)) {
      // Pre-encryption legacy entry. Keep as-is — it'll get rewritten
      // as encrypted on this user's next login.
      return entry;
    }
    if (!this.encryptionKey) {
      console.warn(
        `[token-store] encrypted entry for ${entry.userId} but no TOKEN_ENCRYPTION_KEY configured — skipping`,
      );
      return null;
    }
    try {
      return {
        ...entry,
        refreshToken: decryptToken(entry.refreshToken, this.encryptionKey),
      };
    } catch (err) {
      console.warn(
        `[token-store] failed to decrypt entry for ${entry.userId} — skipping:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }

  /** Store a user's refresh token after login. */
  set(userId: string, refreshToken: string, email: string): void {
    const entry: TokenEntry = {
      userId,
      refreshToken,
      email,
      updatedAt: new Date().toISOString(),
    };
    this.tokens.set(userId, entry);
    // Fire-and-forget write-through. We log but don't block the caller
    // on Redis latency — the in-memory map is the authoritative copy
    // for the running process. The Redis copy holds the encrypted form
    // when a key is configured; in-memory stays plaintext.
    this.redis
      ?.hset(REDIS_HASH, userId, this.toRedisEntry(entry))
      .catch((err) =>
        console.warn(
          `[token-store] redis hset failed for ${userId}:`,
          err instanceof Error ? err.message : err,
        ),
      );
  }

  /** Get a stored refresh token by user ID. */
  get(userId: string): TokenEntry | undefined {
    return this.tokens.get(userId);
  }

  /** List every userId we currently have a refresh token for. */
  listUserIds(): string[] {
    return Array.from(this.tokens.keys());
  }

  /** Get a fresh access token for a user using their stored refresh token. */
  async getAccessToken(userId: string): Promise<string | null> {
    const entry = this.get(userId);
    if (!entry) return null;

    try {
      const oauth2Client = new google.auth.OAuth2(
        config.google.clientId,
        config.google.clientSecret,
      );
      oauth2Client.setCredentials({ refresh_token: entry.refreshToken });

      const { credentials } = await oauth2Client.refreshAccessToken();
      return credentials.access_token ?? null;
    } catch {
      return null;
    }
  }

  /** Remove a user's token. */
  remove(userId: string): void {
    this.tokens.delete(userId);
    this.redis
      ?.hdel(REDIS_HASH, userId)
      .catch((err) =>
        console.warn(
          `[token-store] redis hdel failed for ${userId}:`,
          err instanceof Error ? err.message : err,
        ),
      );
  }

  /** Clear all tokens (for testing). Does NOT touch Redis. */
  clear(): void {
    this.tokens.clear();
  }
}
