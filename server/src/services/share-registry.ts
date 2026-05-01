/**
 * Maps share tokens to trip-owner info. Lives in two layers:
 *
 *   1. In-memory `Map<shareToken, ShareEntry>` — primary read path,
 *      fast and synchronous. A secondary `Map<email, Set<token>>` index
 *      is rebuilt from the primary on hydrate so we don't need a second
 *      Redis hash.
 *   2. Optional Redis hash (`shares` field per token) — write-through
 *      persistence so entries survive process restarts. When the env
 *      vars aren't set, the registry behaves as pure in-memory.
 *
 * The token index is used by the public `/shared/:token` route to
 * resolve which user's Drive contains a shared trip. The email index
 * powers the contributor flow: a logged-in user's trip list includes
 * every trip whose share was issued to `thisUser.email`, and read /
 * write access is gated through the same lookup.
 */

import type { SharePermission } from "@travel-app/shared";
import type { RedisStore } from "./redis-store";

export interface ShareEntry {
  shareToken: string;
  tripId: string;
  ownerUserId: string;
  /** Owner's email — surfaced to the recipient so they know who shared. */
  ownerEmail?: string;
  /** Lower-cased email of the invited recipient, when known. */
  sharedWithEmail?: string;
  /** Access level granted to the invitee. */
  permission: SharePermission;
  /**
   * Per-share visibility flags chosen by the owner at share creation.
   * Threaded through `listSharedTrips` so the contributor's UI can hide
   * cost / todo affordances when the owner asked for that — same intent
   * as the public viewer at /shared/<token>.
   */
  showCosts: boolean;
  showTodos: boolean;
  createdAt: string;
}

const REDIS_HASH = "shares";

function normalizeEmail(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

export class ShareRegistry {
  private entries: Map<string, ShareEntry> = new Map();
  private byEmail: Map<string, Set<string>> = new Map();
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
        // Defensive: pre-PR-B entries on disk lack `permission` —
        // default to "view" so the legacy data still resolves cleanly.
        // Pre-cost/todo-flag entries default to fully-visible (matches
        // the historical /shared/<token> behaviour).
        const normalized: ShareEntry = {
          ...entry,
          permission: entry.permission ?? "view",
          sharedWithEmail: normalizeEmail(entry.sharedWithEmail),
          showCosts: entry.showCosts ?? true,
          showTodos: entry.showTodos ?? true,
        };
        this.entries.set(token, normalized);
        this.indexByEmail(normalized);
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
  register(args: {
    shareToken: string;
    tripId: string;
    ownerUserId: string;
    ownerEmail?: string;
    sharedWithEmail?: string;
    permission: SharePermission;
    showCosts: boolean;
    showTodos: boolean;
  }): void {
    // Drop the previous email-index entry first — re-registering an
    // existing token (e.g. after rebuild) must not leave a stale email
    // pointing at it if the recipient changed.
    this.unindexByEmail(args.shareToken);

    const entry: ShareEntry = {
      shareToken: args.shareToken,
      tripId: args.tripId,
      ownerUserId: args.ownerUserId,
      ownerEmail: args.ownerEmail,
      sharedWithEmail: normalizeEmail(args.sharedWithEmail),
      permission: args.permission,
      showCosts: args.showCosts,
      showTodos: args.showTodos,
      createdAt: new Date().toISOString(),
    };
    this.entries.set(entry.shareToken, entry);
    this.indexByEmail(entry);

    this.redis
      ?.hset(REDIS_HASH, entry.shareToken, entry)
      .catch((err) =>
        console.warn(
          `[share-registry] redis hset failed for ${entry.shareToken.slice(0, 6)}…:`,
          err instanceof Error ? err.message : err,
        ),
      );
  }

  /** Look up a share by its token. */
  lookup(shareToken: string): ShareEntry | undefined {
    return this.entries.get(shareToken);
  }

  /**
   * Look up every share that was invited to the given email. Returns
   * all entries — the caller filters on permission if they only want
   * editable trips.
   */
  lookupByEmail(email: string): ShareEntry[] {
    const normalized = normalizeEmail(email);
    if (!normalized) return [];
    const tokens = this.byEmail.get(normalized);
    if (!tokens) return [];
    const result: ShareEntry[] = [];
    for (const token of tokens) {
      const entry = this.entries.get(token);
      if (entry) result.push(entry);
    }
    return result;
  }

  /** Remove a share token. */
  remove(shareToken: string): void {
    this.unindexByEmail(shareToken);
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
    this.byEmail.clear();
  }

  private indexByEmail(entry: ShareEntry): void {
    if (!entry.sharedWithEmail) return;
    let set = this.byEmail.get(entry.sharedWithEmail);
    if (!set) {
      set = new Set();
      this.byEmail.set(entry.sharedWithEmail, set);
    }
    set.add(entry.shareToken);
  }

  private unindexByEmail(shareToken: string): void {
    const existing = this.entries.get(shareToken);
    if (!existing?.sharedWithEmail) return;
    const set = this.byEmail.get(existing.sharedWithEmail);
    if (!set) return;
    set.delete(shareToken);
    if (set.size === 0) this.byEmail.delete(existing.sharedWithEmail);
  }
}
