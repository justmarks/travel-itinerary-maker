/**
 * Persists displayable share metadata so the public share page can render
 * a useful unfurl preview (Open Graph / Twitter card) without hitting the
 * Express backend. The Cloudflare Pages Edge runtime reads from this
 * Redis hash inside `generateMetadata` for `/shared/[token]`.
 *
 * Schema (Redis hash):
 *   share-snapshots    field=shareToken    value=JSON(ShareSnapshot)
 *
 * Lifecycle (write-side):
 *   - share created → set(token, snapshot)
 *   - share revoked → delete(token)
 *   - trip deleted  → deleteMany(tokens) for every token that lived on it
 *
 * No in-memory mirror: the server is a write-only client of this store.
 * Reads happen on the edge (different process, different runtime), so a
 * server-side cache would be wasted memory.
 *
 * Like ShareRegistry, the store is a no-op when Redis isn't configured —
 * dev/test paths keep working without persistence, the unfurl preview
 * just falls back to the static OG description in `layout.tsx`.
 */

import type { RedisStore } from "./redis-store";

export interface ShareSnapshot {
  /** Trip title — used as the unfurl card title. */
  title: string;
  /** ISO YYYY-MM-DD; the unfurl description renders a date range from these. */
  startDate: string;
  endDate: string;
  /** Number of days in the trip — surfaced in the unfurl description. */
  dayCount: number;
}

const REDIS_HASH = "share-snapshots";

function tokenLabel(token: string): string {
  return `${token.slice(0, 6)}…`;
}

export class ShareSnapshotStore {
  constructor(private redis: RedisStore | null) {}

  /** Write or overwrite the snapshot for a token. Fire-and-forget. */
  set(token: string, snapshot: ShareSnapshot): void {
    if (!this.redis) return;
    this.redis.hset(REDIS_HASH, token, snapshot).catch((err) => {
      console.warn(
        `[share-snapshot-store] hset failed for ${tokenLabel(token)}:`,
        err instanceof Error ? err.message : err,
      );
    });
  }

  /** Remove the snapshot for a token. Fire-and-forget. */
  delete(token: string): void {
    if (!this.redis) return;
    this.redis.hdel(REDIS_HASH, token).catch((err) => {
      console.warn(
        `[share-snapshot-store] hdel failed for ${tokenLabel(token)}:`,
        err instanceof Error ? err.message : err,
      );
    });
  }

  /** Convenience: cascade-delete used when a trip is removed. */
  deleteMany(tokens: string[]): void {
    for (const token of tokens) {
      this.delete(token);
    }
  }
}
