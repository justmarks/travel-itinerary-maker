/**
 * Thin wrapper around the Upstash Redis REST client. Exposes the
 * hash-based read/write/delete operations TokenStore and ShareRegistry
 * use to persist their entries.
 *
 * The whole module is a no-op when `UPSTASH_REDIS_REST_URL` /
 * `UPSTASH_REDIS_REST_TOKEN` aren't set: `createRedisStore()` returns
 * `null`, and consumers that detect `null` keep their in-memory-only
 * behaviour. This way dev / tests don't need a Redis instance and the
 * production server transparently gets persistence the moment the env
 * vars are populated.
 *
 * Schema (hashes):
 *   tokens         field=userId        value=JSON(TokenEntry)
 *   shares         field=shareToken    value=JSON(ShareEntry)
 *
 * Why hashes: a single HGETALL on startup pulls every entry in one
 * round-trip — much cheaper than scanning N individual keys via the
 * REST API (each command is a separate HTTP request).
 */

import { Redis } from "@upstash/redis";
import { config } from "../config/env";

export interface RedisStore {
  hgetall<T>(hash: string): Promise<Record<string, T>>;
  hset<T>(hash: string, field: string, value: T): Promise<void>;
  hdel(hash: string, field: string): Promise<void>;
}

class UpstashRedisStore implements RedisStore {
  constructor(private redis: Redis) {}

  async hgetall<T>(hash: string): Promise<Record<string, T>> {
    const result = await this.redis.hgetall<Record<string, T>>(hash);
    return result ?? {};
  }

  async hset<T>(hash: string, field: string, value: T): Promise<void> {
    // Upstash auto-serialises non-string values to JSON, so the caller
    // can pass an object and we don't need a manual stringify here.
    await this.redis.hset(hash, { [field]: value });
  }

  async hdel(hash: string, field: string): Promise<void> {
    await this.redis.hdel(hash, field);
  }
}

/**
 * Construct a RedisStore from `config.redis` if both URL and token are
 * present, otherwise return null. Callers should treat null as "no
 * persistence configured".
 */
export function createRedisStore(): RedisStore | null {
  const { url, token } = config.redis;
  if (!url || !token) return null;
  try {
    const client = new Redis({ url, token });
    return new UpstashRedisStore(client);
  } catch (err) {
    console.warn(
      "[redis-store] failed to construct Upstash client — running in-memory only:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
