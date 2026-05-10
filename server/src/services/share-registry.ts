/**
 * Maps share tokens to trip-owner info. Phase 2 of the Drive→Supabase
 * migration moves persistence from Redis to Postgres; the public API is
 * unchanged.
 *
 *   1. In-memory `Map<shareToken, ShareEntry>` — primary read path,
 *      fast and synchronous. A secondary `Map<email, Set<token>>` index
 *      is rebuilt from the primary on hydrate so we don't need a second
 *      query.
 *   2. Optional Postgres `trip_shares` table — write-through persistence
 *      so entries survive process restarts. When no `dbClient` is
 *      provided the registry behaves as pure in-memory (dev/test path,
 *      and the legacy run-without-Postgres fallback before the cutover
 *      is complete).
 *
 * The token index is used by the public `/shared/:token` route to
 * resolve which user's storage holds the shared trip. The email index
 * powers the contributor flow: a logged-in user's trip list includes
 * every trip whose share was issued to `thisUser.email`, and read /
 * write access is gated through the same lookup.
 *
 * Why keep the in-memory cache when Postgres is durable: `lookupByEmail`
 * fires on every authed `/trips` list. Round-tripping to Postgres on
 * every request would add 10-30ms × N requests of network latency
 * (Railway↔Supabase). The cache stays the hot read path; durability
 * comes free from the write-through.
 */

import { eq } from "drizzle-orm";
import type { SharePermission } from "@travel-app/shared";
import type { Db, DbClient } from "../db/client";
import { tripShares } from "../db/schema";

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

function normalizeEmail(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

export class ShareRegistry {
  private entries: Map<string, ShareEntry> = new Map();
  private byEmail: Map<string, Set<string>> = new Map();
  private db: Db | null;

  constructor(dbClient: DbClient | null = null) {
    this.db = dbClient?.db ?? null;
  }

  /**
   * Pull every persisted entry into the in-memory map. No-op when
   * Postgres isn't configured. Call once at server startup.
   */
  async hydrate(): Promise<void> {
    if (!this.db) return;
    try {
      const rows = await this.db.select().from(tripShares);
      for (const row of rows) {
        const entry: ShareEntry = {
          shareToken: row.shareToken,
          tripId: row.tripId,
          ownerUserId: row.ownerUserId,
          ownerEmail: row.ownerEmail ?? undefined,
          sharedWithEmail: normalizeEmail(row.sharedWithEmail ?? undefined),
          permission: row.permission as SharePermission,
          showCosts: row.showCosts,
          showTodos: row.showTodos,
          createdAt: row.createdAt.toISOString(),
        };
        this.entries.set(entry.shareToken, entry);
        this.indexByEmail(entry);
      }
      console.log(
        `[share-registry] hydrated ${this.entries.size} entr${this.entries.size === 1 ? "y" : "ies"} from Postgres`,
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

    this.persist(entry);
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
    if (this.db) {
      this.db
        .delete(tripShares)
        .where(eq(tripShares.shareToken, shareToken))
        .catch((err) =>
          console.warn(
            `[share-registry] db delete failed for ${shareToken.slice(0, 6)}…:`,
            err instanceof Error ? err.message : err,
          ),
        );
    }
  }

  /** Remove all shares for a given trip. */
  removeByTrip(tripId: string): void {
    for (const [token, entry] of this.entries) {
      if (entry.tripId === tripId) {
        this.remove(token);
      }
    }
  }

  /** Clear all entries (for testing). Does NOT touch Postgres. */
  clear(): void {
    this.entries.clear();
    this.byEmail.clear();
  }

  private persist(entry: ShareEntry): void {
    if (!this.db) return;
    // Write-through upsert. Fire-and-forget matches the existing
    // pattern: in-memory state is correct synchronously, durability
    // failures degrade silently to "lost on next restart" rather than
    // blocking the route handler.
    this.db
      .insert(tripShares)
      .values({
        shareToken: entry.shareToken,
        tripId: entry.tripId,
        ownerUserId: entry.ownerUserId,
        ownerEmail: entry.ownerEmail ?? null,
        sharedWithEmail: entry.sharedWithEmail ?? null,
        permission: entry.permission,
        showCosts: entry.showCosts,
        showTodos: entry.showTodos,
        createdAt: new Date(entry.createdAt),
      })
      .onConflictDoUpdate({
        target: tripShares.shareToken,
        set: {
          tripId: entry.tripId,
          ownerUserId: entry.ownerUserId,
          ownerEmail: entry.ownerEmail ?? null,
          sharedWithEmail: entry.sharedWithEmail ?? null,
          permission: entry.permission,
          showCosts: entry.showCosts,
          showTodos: entry.showTodos,
        },
      })
      .catch((err) =>
        console.warn(
          `[share-registry] db upsert failed for ${entry.shareToken.slice(0, 6)}…:`,
          err instanceof Error ? err.message : err,
        ),
      );
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
