/**
 * Stores per-user Web Push subscriptions.
 *
 * One user can have many subscriptions (laptop browser, phone PWA, etc.) —
 * each is a distinct endpoint. The send path fans out to every endpoint
 * the user has registered.
 *
 * Phase 2 of the Drive→Supabase migration moves persistence from Redis
 * to Postgres. Public API is unchanged — sync reads, the write-through
 * pattern, hydrate-at-startup — only the durable backing swaps.
 *
 *   1. In-memory `Map<userId, PushEntry[]>` — primary read path.
 *   2. Optional Postgres `push_subscriptions` table — write-through so
 *      subscriptions survive process restarts. When no `dbClient` is
 *      provided the store behaves as pure in-memory (dev / test path).
 *
 * Subscriptions are also indexed by email so the share-creation flow
 * can look up "every device the invited recipient is signed in on"
 * without first resolving an email → userId. Recipients are identified
 * by email (the same shape the share registry uses) so we don't depend
 * on the recipient having ever logged in to *this* server.
 */

import { eq } from "drizzle-orm";
import type { PushSubscription } from "@itinly/shared";
import type { Db, DbClient } from "../db/client";
import { pushSubscriptions } from "../db/schema";

export interface PushEntry {
  /** Google user ID — primary owner key. */
  userId: string;
  /** Lower-cased email — used to find subscriptions for a share recipient. */
  email: string;
  subscription: PushSubscription;
  /** Best-effort hint from the browser; useful in a "your devices" UI. */
  userAgent?: string;
  createdAt: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class PushSubscriptionStore {
  private byUser: Map<string, PushEntry[]> = new Map();
  private byEmail: Map<string, Set<string>> = new Map();
  private db: Db | null;

  constructor(dbClient: DbClient | null = null) {
    this.db = dbClient?.db ?? null;
  }

  async hydrate(): Promise<void> {
    if (!this.db) return;
    try {
      const rows = await this.db.select().from(pushSubscriptions);
      for (const row of rows) {
        const entry: PushEntry = {
          userId: row.userId,
          email: row.email,
          subscription: {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          userAgent: row.userAgent ?? undefined,
          createdAt: row.createdAt.toISOString(),
        };
        const list = this.byUser.get(entry.userId) ?? [];
        list.push(entry);
        this.byUser.set(entry.userId, list);
        this.indexEmail(entry);
      }
      const total = Array.from(this.byUser.values()).reduce(
        (n, list) => n + list.length,
        0,
      );
      console.log(
        `[push-subs] hydrated ${total} subscription${total === 1 ? "" : "s"} for ${this.byUser.size} user${this.byUser.size === 1 ? "" : "s"} from Postgres`,
      );
    } catch (err) {
      console.warn(
        "[push-subs] hydrate failed, continuing without persisted subscriptions:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  /**
   * Register or replace a subscription for the given user. Subscriptions
   * are keyed by their `endpoint` URL — the same browser registering a
   * second time updates the existing entry rather than creating a
   * duplicate. The browser issues a fresh subscription whenever its
   * push manager rotates the endpoint, so de-duping by URL is the
   * canonical pattern.
   */
  upsert(args: {
    userId: string;
    email: string;
    subscription: PushSubscription;
    userAgent?: string;
  }): void {
    const email = normalizeEmail(args.email);
    const list = this.byUser.get(args.userId) ?? [];
    const existingIdx = list.findIndex(
      (e) => e.subscription.endpoint === args.subscription.endpoint,
    );
    const entry: PushEntry = {
      userId: args.userId,
      email,
      subscription: args.subscription,
      userAgent: args.userAgent,
      createdAt:
        existingIdx >= 0
          ? (list[existingIdx]?.createdAt ?? new Date().toISOString())
          : new Date().toISOString(),
    };
    if (existingIdx >= 0) {
      list[existingIdx] = entry;
    } else {
      list.push(entry);
    }
    this.byUser.set(args.userId, list);
    this.indexEmail(entry);
    this.persistUpsert(entry);
  }

  /** Remove a subscription by endpoint. Used when the browser unsubscribes. */
  remove(userId: string, endpoint: string): boolean {
    const list = this.byUser.get(userId);
    if (!list) return false;
    const idx = list.findIndex((e) => e.subscription.endpoint === endpoint);
    if (idx < 0) return false;
    const [removed] = list.splice(idx, 1);
    if (removed) this.unindexEmail(removed.email, removed.subscription.endpoint);
    if (list.length === 0) {
      this.byUser.delete(userId);
    }
    this.persistDelete(endpoint);
    return true;
  }

  /**
   * Remove a subscription by endpoint regardless of which user owns it.
   * Used by the send path when a push provider returns 410 Gone — the
   * caller doesn't always know whose subscription died, so we sweep.
   */
  removeByEndpoint(endpoint: string): void {
    for (const [userId, list] of this.byUser) {
      const idx = list.findIndex((e) => e.subscription.endpoint === endpoint);
      if (idx < 0) continue;
      const [removed] = list.splice(idx, 1);
      if (removed)
        this.unindexEmail(removed.email, removed.subscription.endpoint);
      if (list.length === 0) {
        this.byUser.delete(userId);
      }
      this.persistDelete(endpoint);
      return;
    }
  }

  /** Subscriptions for a single user. */
  listForUser(userId: string): PushEntry[] {
    return this.byUser.get(userId) ?? [];
  }

  /**
   * Subscriptions for whichever user is signed in with the given email.
   * Returns an empty array when no one with that email has subscribed
   * (cold-invite case — fall back to email-only delivery upstream).
   */
  listForEmail(email: string): PushEntry[] {
    const normalized = normalizeEmail(email);
    const endpoints = this.byEmail.get(normalized);
    if (!endpoints) return [];
    const result: PushEntry[] = [];
    for (const list of this.byUser.values()) {
      for (const entry of list) {
        if (endpoints.has(entry.subscription.endpoint)) result.push(entry);
      }
    }
    return result;
  }

  /** Test helper. Does NOT touch Postgres. */
  clear(): void {
    this.byUser.clear();
    this.byEmail.clear();
  }

  /**
   * Hard-delete every subscription for `userId` from both the in-memory
   * index and the Postgres table. Used by the account-deletion route;
   * irreversible.
   */
  async deleteAllForUser(userId: string): Promise<void> {
    const list = this.byUser.get(userId);
    if (list) {
      for (const entry of list) {
        this.unindexEmail(entry.email, entry.subscription.endpoint);
      }
      this.byUser.delete(userId);
    }
    if (this.db) {
      await this.db
        .delete(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId));
    }
  }

  private persistUpsert(entry: PushEntry): void {
    if (!this.db) return;
    // Endpoint is the PK; same browser re-registering updates the row.
    // Fire-and-forget matches the existing pattern: in-memory state is
    // correct synchronously; durability failures degrade silently.
    this.db
      .insert(pushSubscriptions)
      .values({
        endpoint: entry.subscription.endpoint,
        userId: entry.userId,
        email: entry.email,
        p256dh: entry.subscription.keys.p256dh,
        auth: entry.subscription.keys.auth,
        userAgent: entry.userAgent ?? null,
        createdAt: new Date(entry.createdAt),
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId: entry.userId,
          email: entry.email,
          p256dh: entry.subscription.keys.p256dh,
          auth: entry.subscription.keys.auth,
          userAgent: entry.userAgent ?? null,
        },
      })
      .catch((err) =>
        console.warn(
          "[push-subs] db upsert failed:",
          err instanceof Error ? err.message : err,
        ),
      );
  }

  private persistDelete(endpoint: string): void {
    if (!this.db) return;
    this.db
      .delete(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
      .catch((err) =>
        console.warn(
          "[push-subs] db delete failed:",
          err instanceof Error ? err.message : err,
        ),
      );
  }

  private indexEmail(entry: PushEntry): void {
    let set = this.byEmail.get(entry.email);
    if (!set) {
      set = new Set();
      this.byEmail.set(entry.email, set);
    }
    set.add(entry.subscription.endpoint);
  }

  private unindexEmail(email: string, endpoint: string): void {
    const set = this.byEmail.get(email);
    if (!set) return;
    set.delete(endpoint);
    if (set.size === 0) this.byEmail.delete(email);
  }
}
