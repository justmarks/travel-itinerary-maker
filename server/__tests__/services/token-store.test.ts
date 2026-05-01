import { randomBytes } from "crypto";
import { TokenStore, type TokenEntry } from "../../src/services/token-store";
import {
  encryptToken,
  isEncrypted,
} from "../../src/services/token-crypto";
import type { RedisStore } from "../../src/services/redis-store";

// Mock googleapis to avoid real network calls
jest.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: jest.fn(),
        refreshAccessToken: jest.fn().mockResolvedValue({
          credentials: { access_token: "fresh-token-123" },
        }),
      })),
    },
  },
}));

describe("TokenStore", () => {
  let store: TokenStore;

  beforeEach(() => {
    store = new TokenStore();
  });

  it("stores and retrieves a token entry", () => {
    store.set("user-1", "refresh-token-abc", "user@example.com");
    const entry = store.get("user-1");
    expect(entry).toBeDefined();
    expect(entry!.refreshToken).toBe("refresh-token-abc");
    expect(entry!.email).toBe("user@example.com");
  });

  it("returns undefined for unknown users", () => {
    expect(store.get("nonexistent")).toBeUndefined();
  });

  it("removes a token", () => {
    store.set("user-1", "refresh-token-abc", "user@example.com");
    store.remove("user-1");
    expect(store.get("user-1")).toBeUndefined();
  });

  it("clears all tokens", () => {
    store.set("user-1", "token-1", "a@example.com");
    store.set("user-2", "token-2", "b@example.com");
    store.clear();
    expect(store.get("user-1")).toBeUndefined();
    expect(store.get("user-2")).toBeUndefined();
  });

  it("gets a fresh access token via refresh", async () => {
    store.set("user-1", "refresh-token-abc", "user@example.com");
    const accessToken = await store.getAccessToken("user-1");
    expect(accessToken).toBe("fresh-token-123");
  });

  it("returns null for unknown user when getting access token", async () => {
    const accessToken = await store.getAccessToken("nonexistent");
    expect(accessToken).toBeNull();
  });
});

describe("TokenStore — encryption at rest", () => {
  // Fire-and-forget Redis writes need a microtask flush.
  const flushAsync = () => new Promise((r) => setImmediate(r));

  function makeRedis(initial: Record<string, TokenEntry> = {}) {
    const data: Record<string, TokenEntry> = { ...initial };
    const redis: RedisStore & {
      hsetCalls: Array<{ field: string; value: TokenEntry }>;
    } = {
      hsetCalls: [],
      hgetall: async <T>() => data as unknown as Record<string, T>,
      hset: async <T>(_hash: string, field: string, value: T) => {
        const entry = value as unknown as TokenEntry;
        data[field] = entry;
        redis.hsetCalls.push({ field, value: entry });
      },
      hdel: async (_hash: string, field: string) => {
        delete data[field];
      },
    };
    return redis;
  }

  it("encrypts the refresh token before writing to Redis", async () => {
    const key = randomBytes(32);
    const redis = makeRedis();
    const store = new TokenStore(redis, key);

    store.set("user-1", "secret-refresh-token", "user@example.com");
    await flushAsync();

    expect(redis.hsetCalls).toHaveLength(1);
    const written = redis.hsetCalls[0].value;
    expect(written.userId).toBe("user-1");
    expect(written.email).toBe("user@example.com");
    expect(written.refreshToken).not.toBe("secret-refresh-token");
    expect(isEncrypted(written.refreshToken)).toBe(true);

    // In-memory cache holds plaintext for fast access by getAccessToken.
    expect(store.get("user-1")!.refreshToken).toBe("secret-refresh-token");
  });

  it("hydrates encrypted entries by decrypting them", async () => {
    const key = randomBytes(32);
    const redis = makeRedis({
      "user-1": {
        userId: "user-1",
        refreshToken: encryptToken("hidden-token", key),
        email: "u1@example.com",
        updatedAt: "2026-04-30T00:00:00.000Z",
      },
    });
    const store = new TokenStore(redis, key);
    await store.hydrate();

    expect(store.get("user-1")!.refreshToken).toBe("hidden-token");
  });

  it("hydrates legacy plaintext entries unchanged (lazy migration)", async () => {
    const key = randomBytes(32);
    const redis = makeRedis({
      "legacy-user": {
        userId: "legacy-user",
        refreshToken: "plaintext-from-before-encryption",
        email: "legacy@example.com",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const store = new TokenStore(redis, key);
    await store.hydrate();

    // Pre-encryption entries stay readable; they get rewritten as
    // encrypted on the user's next login.
    expect(store.get("legacy-user")!.refreshToken).toBe(
      "plaintext-from-before-encryption",
    );
  });

  it("skips entries it can't decrypt (rotated / mismatched key)", async () => {
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const redis = makeRedis({
      "user-old-key": {
        userId: "user-old-key",
        refreshToken: encryptToken("token", oldKey),
        email: "old@example.com",
        updatedAt: "2026-04-30T00:00:00.000Z",
      },
      "user-good": {
        userId: "user-good",
        refreshToken: encryptToken("token-good", newKey),
        email: "good@example.com",
        updatedAt: "2026-04-30T00:00:00.000Z",
      },
    });
    const store = new TokenStore(redis, newKey);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await store.hydrate();
    warn.mockRestore();

    // The undecryptable entry is dropped; the readable one survives.
    expect(store.get("user-old-key")).toBeUndefined();
    expect(store.get("user-good")!.refreshToken).toBe("token-good");
  });

  it("skips encrypted entries when no key is configured", async () => {
    const key = randomBytes(32);
    const redis = makeRedis({
      "user-1": {
        userId: "user-1",
        refreshToken: encryptToken("token", key),
        email: "u1@example.com",
        updatedAt: "2026-04-30T00:00:00.000Z",
      },
    });
    // Note: no key passed to TokenStore.
    const store = new TokenStore(redis, null);
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    await store.hydrate();
    warn.mockRestore();

    expect(store.get("user-1")).toBeUndefined();
  });

  it("falls through to plaintext writes when no key is configured", async () => {
    const redis = makeRedis();
    const store = new TokenStore(redis, null);

    store.set("user-1", "plain-token", "user@example.com");
    await flushAsync();

    expect(redis.hsetCalls).toHaveLength(1);
    expect(redis.hsetCalls[0].value.refreshToken).toBe("plain-token");
    expect(isEncrypted(redis.hsetCalls[0].value.refreshToken)).toBe(false);
  });
});
