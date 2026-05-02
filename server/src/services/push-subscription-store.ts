/**
 * Stores per-user Web Push subscriptions.
 *
 * One user can have many subscriptions (laptop browser, phone PWA, etc.) —
 * each is a distinct endpoint. The send path fans out to every endpoint
 * the user has registered.
 *
 * Two-layer design mirrors `TokenStore` / `ShareRegistry`:
 *   1. In-memory `Map<userId, PushEntry[]>` — primary read path.
 *   2. Optional Redis hash (`push-subs` field per user) — write-through
 *      so subscriptions survive process restarts. When Redis isn't
 *      configured the store behaves as pure in-memory.
 *
 * Subscriptions are also indexed by email so the share-creation flow
 * can look up "every device the invited recipient is signed in on"
 * without first resolving an email → userId. Recipients are identified
 * by email (the same shape the share registry uses) so we don't depend
 * on the recipient having ever logged in to *this* server.
 */

import type { PushSubscription } from "@travel-app/shared";
import type { RedisStore } from "./redis-store";

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

const REDIS_HASH = "push-subs";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export class PushSubscriptionStore {
  private byUser: Map<string, PushEntry[]> = new Map();
  private byEmail: Map<string, Set<string>> = new Map();
  private redis: RedisStore | null;

  constructor(redis: RedisStore | null = null) {
    this.redis = redis;
  }

  async hydrate(): Promise<void> {
    if (!this.redis) return;
    try {
      const all = await this.redis.hgetall<PushEntry[]>(REDIS_HASH);
      for (const [userId, entries] of Object.entries(all)) {
        const list = Array.isArray(entries) ? entries : [];
        this.byUser.set(userId, list);
        for (const entry of list) this.indexEmail(entry);
      }
      const total = Array.from(this.byUser.values()).reduce((n, list) => n + list.length, 0);
      console.log(
        `[push-subs] hydrated ${total} subscription${total === 1 ? "" : "s"} for ${this.byUser.size} user${this.byUser.size === 1 ? "" : "s"} from Redis`,
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
        existingIdx >= 0 ? (list[existingIdx]?.createdAt ?? new Date().toISOString())
                         : new Date().toISOString(),
    };
    if (existingIdx >= 0) {
      list[existingIdx] = entry;
    } else {
      list.push(entry);
    }
    this.byUser.set(args.userId, list);
    this.indexEmail(entry);
    this.persist(args.userId, list);
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
    this.persist(userId, list);
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
      if (removed) this.unindexEmail(removed.email, removed.subscription.endpoint);
      if (list.length === 0) {
        this.byUser.delete(userId);
      }
      this.persist(userId, list);
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

  /** Test helper. Does NOT touch Redis. */
  clear(): void {
    this.byUser.clear();
    this.byEmail.clear();
  }

  private persist(userId: string, list: PushEntry[]): void {
    if (!this.redis) return;
    const op = list.length === 0
      ? this.redis.hdel(REDIS_HASH, userId)
      : this.redis.hset(REDIS_HASH, userId, list);
    op.catch((err) =>
      console.warn(
        `[push-subs] redis write failed for ${userId}:`,
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
