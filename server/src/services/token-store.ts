/**
 * Stores user refresh tokens server-side.
 *
 * Populated when users authenticate via POST /auth/google. Used by the
 * shared route to mint access tokens for trip owners on behalf of
 * recipients.
 *
 * Two-layer design:
 *   1. In-memory `Map<userId, TokenEntry>` — primary read path; sync.
 *   2. Optional Redis hash (`tokens` field per user) — write-through
 *      persistence. When present, `hydrate()` rebuilds the in-memory
 *      cache from Redis on startup. When absent, the store behaves as
 *      pure in-memory (existing dev / test behaviour).
 *
 * Writes to Redis are best-effort (logged on failure). The in-memory
 * map is the authoritative source for the running process; Redis is
 * the durable shadow that lets a fresh process bootstrap.
 */

import { google } from "googleapis";
import { config } from "../config/env";
import type { RedisStore } from "./redis-store";

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

  constructor(redis: RedisStore | null = null) {
    this.redis = redis;
  }

  /**
   * Pull every persisted entry into the in-memory cache. No-op when
   * Redis isn't configured. Call once at server startup.
   */
  async hydrate(): Promise<void> {
    if (!this.redis) return;
    try {
      const all = await this.redis.hgetall<TokenEntry>(REDIS_HASH);
      for (const [userId, entry] of Object.entries(all)) {
        this.tokens.set(userId, entry);
      }
      console.log(
        `[token-store] hydrated ${this.tokens.size} entr${this.tokens.size === 1 ? "y" : "ies"} from Redis`,
      );
    } catch (err) {
      console.warn(
        "[token-store] hydrate failed, continuing without persisted tokens:",
        err instanceof Error ? err.message : err,
      );
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
    // for the running process.
    this.redis
      ?.hset(REDIS_HASH, userId, entry)
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
