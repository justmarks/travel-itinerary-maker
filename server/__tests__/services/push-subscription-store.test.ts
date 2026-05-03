import { PushSubscriptionStore } from "../../src/services/push-subscription-store";
import type { RedisStore } from "../../src/services/redis-store";

const sub = (endpoint: string) => ({
  endpoint,
  keys: { p256dh: `p256-${endpoint}`, auth: `auth-${endpoint}` },
});

describe("PushSubscriptionStore", () => {
  let store: PushSubscriptionStore;

  beforeEach(() => {
    store = new PushSubscriptionStore();
  });

  it("upserts and lists by user", () => {
    store.upsert({
      userId: "user-1",
      email: "alice@example.com",
      subscription: sub("https://push.example/abc"),
    });
    const list = store.listForUser("user-1");
    expect(list).toHaveLength(1);
    expect(list[0]!.subscription.endpoint).toBe("https://push.example/abc");
    expect(list[0]!.email).toBe("alice@example.com");
  });

  it("normalises emails on storage and lookup", () => {
    store.upsert({
      userId: "user-1",
      email: "Alice@Example.COM",
      subscription: sub("https://push.example/abc"),
    });
    const list = store.listForEmail("ALICE@example.com");
    expect(list).toHaveLength(1);
    expect(list[0]!.email).toBe("alice@example.com");
  });

  it("deduplicates by endpoint when the same browser re-subscribes", () => {
    store.upsert({
      userId: "user-1",
      email: "alice@example.com",
      subscription: sub("https://push.example/abc"),
      userAgent: "browser-v1",
    });
    store.upsert({
      userId: "user-1",
      email: "alice@example.com",
      subscription: sub("https://push.example/abc"),
      userAgent: "browser-v2",
    });
    const list = store.listForUser("user-1");
    expect(list).toHaveLength(1);
    expect(list[0]!.userAgent).toBe("browser-v2");
  });

  it("supports multiple distinct endpoints per user (multi-device)", () => {
    store.upsert({
      userId: "user-1",
      email: "alice@example.com",
      subscription: sub("https://push.example/laptop"),
    });
    store.upsert({
      userId: "user-1",
      email: "alice@example.com",
      subscription: sub("https://push.example/phone"),
    });
    expect(store.listForUser("user-1")).toHaveLength(2);
    expect(store.listForEmail("alice@example.com")).toHaveLength(2);
  });

  it("findsForEmail returns empty when no one with that email subscribed", () => {
    store.upsert({
      userId: "user-1",
      email: "alice@example.com",
      subscription: sub("https://push.example/abc"),
    });
    expect(store.listForEmail("bob@example.com")).toEqual([]);
  });

  it("removes a single subscription by endpoint", () => {
    store.upsert({
      userId: "user-1",
      email: "alice@example.com",
      subscription: sub("https://push.example/laptop"),
    });
    store.upsert({
      userId: "user-1",
      email: "alice@example.com",
      subscription: sub("https://push.example/phone"),
    });
    expect(store.remove("user-1", "https://push.example/laptop")).toBe(true);
    const remaining = store.listForUser("user-1");
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.subscription.endpoint).toBe("https://push.example/phone");
  });

  it("returns false when removing a non-existent endpoint", () => {
    expect(store.remove("user-1", "https://push.example/missing")).toBe(false);
  });

  it("removeByEndpoint sweeps regardless of owning user", () => {
    store.upsert({
      userId: "user-1",
      email: "alice@example.com",
      subscription: sub("https://push.example/dead"),
    });
    store.removeByEndpoint("https://push.example/dead");
    expect(store.listForUser("user-1")).toEqual([]);
    expect(store.listForEmail("alice@example.com")).toEqual([]);
  });

  it("clears all entries on clear()", () => {
    store.upsert({
      userId: "user-1",
      email: "alice@example.com",
      subscription: sub("https://push.example/abc"),
    });
    store.clear();
    expect(store.listForUser("user-1")).toEqual([]);
    expect(store.listForEmail("alice@example.com")).toEqual([]);
  });

  describe("Redis persistence", () => {
    let redis: RedisStore;
    let hash: Record<string, unknown>;

    beforeEach(() => {
      hash = {};
      redis = {
        hgetall: async () => hash as Record<string, never>,
        hset: async (_h: string, field: string, value: unknown) => {
          hash[field] = value;
        },
        hdel: async (_h: string, field: string) => {
          delete hash[field];
        },
      };
    });

    it("writes upserts through to redis", async () => {
      const persistent = new PushSubscriptionStore(redis);
      persistent.upsert({
        userId: "user-1",
        email: "alice@example.com",
        subscription: sub("https://push.example/abc"),
      });
      // hset is async; let it flush.
      await new Promise((r) => setImmediate(r));
      expect(hash["user-1"]).toBeDefined();
      const stored = hash["user-1"] as Array<{ subscription: { endpoint: string } }>;
      expect(stored[0]!.subscription.endpoint).toBe("https://push.example/abc");
    });

    it("hydrates from redis on startup", async () => {
      hash["user-1"] = [
        {
          userId: "user-1",
          email: "alice@example.com",
          subscription: sub("https://push.example/abc"),
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ];
      const persistent = new PushSubscriptionStore(redis);
      await persistent.hydrate();
      expect(persistent.listForUser("user-1")).toHaveLength(1);
      expect(persistent.listForEmail("alice@example.com")).toHaveLength(1);
    });

    it("deletes the redis entry when a user's last subscription is removed", async () => {
      const persistent = new PushSubscriptionStore(redis);
      persistent.upsert({
        userId: "user-1",
        email: "alice@example.com",
        subscription: sub("https://push.example/abc"),
      });
      await new Promise((r) => setImmediate(r));
      persistent.remove("user-1", "https://push.example/abc");
      await new Promise((r) => setImmediate(r));
      expect(hash["user-1"]).toBeUndefined();
    });
  });
});
