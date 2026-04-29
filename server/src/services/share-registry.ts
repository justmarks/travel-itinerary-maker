/**
 * Maps share tokens to trip-owner info. Lives in two layers:
 *
 *   1. In-memory `Map<shareToken, ShareEntry>` — primary read path,
 *      fast and synchronous.
 *   2. Optional Redis hash (`shares` field per token) — write-through
 *      persistence so entries survive process restarts. When the env
 *      vars aren't set, the registry behaves as pure in-memory.
 *
 * Used by the public `/shared/:token` route to find which user's Drive
 * contains a shared trip. Even with persistence the in-memory map is
 * the authoritative snapshot for the running process; Redis is the
 * durable shadow that hydrates a fresh process.
 */

import type { RedisStore } from "./redis-store";

export interface ShareEntry {
  shareToken: string;
  tripId: string;
  ownerUserId: string;
  createdAt: string;
}

const REDIS_HASH = "shares";

export class ShareRegistry {
  private entries: Map<string, ShareEntry> = new Map();
  private redis: RedisStore | null;

  constructor(redis: RedisStore | null = null) {
    this.redis = redis;
  }

  /**
   * Pull every persisted entry into the in-memory map. No-op when
   * Redis isn't configured. Call once at server startup.
   */
  async hydrate(): Promise<void> {
    if (!this.redis) return;
    try {
      const all = await this.redis.hgetall<ShareEntry>(REDIS_HASH);
      for (const [token, entry] of Object.entries(all)) {
        this.entries.set(token, entry);
      }
      console.log(
        `[share-registry] hydrated ${this.entries.size} entr${this.entries.size === 1 ? "y" : "ies"} from Redis`,
      );
    } catch (err) {
      console.warn(
        "[share-registry] hydrate failed, continuing without persisted shares:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  /** Register a share token mapping. */
  register(shareToken: string, tripId: string, ownerUserId: string): void {
    const entry: ShareEntry = {
      shareToken,
      tripId,
      ownerUserId,
      createdAt: new Date().toISOString(),
    };
    this.entries.set(shareToken, entry);
    this.redis
      ?.hset(REDIS_HASH, shareToken, entry)
      .catch((err) =>
        console.warn(
          `[share-registry] redis hset failed for ${shareToken.slice(0, 6)}…:`,
          err instanceof Error ? err.message : err,
        ),
      );
  }

  /** Look up a share token. */
  lookup(shareToken: string): ShareEntry | undefined {
    return this.entries.get(shareToken);
  }

  /** Remove a share token. */
  remove(shareToken: string): void {
    this.entries.delete(shareToken);
    this.redis
      ?.hdel(REDIS_HASH, shareToken)
      .catch((err) =>
        console.warn(
          `[share-registry] redis hdel failed for ${shareToken.slice(0, 6)}…:`,
          err instanceof Error ? err.message : err,
        ),
      );
  }

  /** Remove all shares for a given trip. */
  removeByTrip(tripId: string): void {
    for (const [token, entry] of this.entries) {
      if (entry.tripId === tripId) {
        this.remove(token);
      }
    }
  }

  /** Clear all entries (for testing). Does NOT touch Redis. */
  clear(): void {
    this.entries.clear();
  }
}
