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
    expect(entry!.scopes).toEqual([]);
  });

  it("persists granted scopes when provided", () => {
    store.set("user-1", "refresh-token-abc", "user@example.com", [
      "openid",
      "https://www.googleapis.com/auth/drive.file",
    ]);
    expect(store.get("user-1")!.scopes).toEqual([
      "openid",
      "https://www.googleapis.com/auth/drive.file",
    ]);
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

describe("TokenStore — Gmail link", () => {
  let store: TokenStore;

  beforeEach(() => {
    store = new TokenStore();
  });

  it("setGmail attaches gmail fields to an existing primary entry", () => {
    store.set("user-1", "primary-refresh", "user@example.com", [
      "openid",
      "https://www.googleapis.com/auth/drive.file",
    ]);

    const ok = store.setGmail("user-1", "gmail-refresh", [
      "openid",
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);

    expect(ok).toBe(true);
    const entry = store.get("user-1")!;
    expect(entry.refreshToken).toBe("primary-refresh");
    expect(entry.gmailRefreshToken).toBe("gmail-refresh");
    expect(entry.gmailScopes).toEqual([
      "openid",
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);
    expect(entry.gmailUpdatedAt).toEqual(expect.any(String));
    // Primary scopes should be untouched.
    expect(entry.scopes).toEqual([
      "openid",
      "https://www.googleapis.com/auth/drive.file",
    ]);
  });

  it("setGmail returns false when there's no primary entry", () => {
    expect(store.setGmail("ghost-user", "any-token", [])).toBe(false);
    expect(store.get("ghost-user")).toBeUndefined();
  });

  it("set() preserves existing gmail link when re-storing the primary", () => {
    store.set("user-1", "primary-v1", "user@example.com", ["openid"]);
    store.setGmail("user-1", "gmail-refresh", [
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);
    // Simulate the user re-running primary OAuth (e.g. they refreshed
    // tokens or re-consented to Calendar). The gmail half must survive.
    store.set("user-1", "primary-v2", "user@example.com", [
      "openid",
      "https://www.googleapis.com/auth/calendar",
    ]);

    const entry = store.get("user-1")!;
    expect(entry.refreshToken).toBe("primary-v2");
    expect(entry.scopes).toEqual([
      "openid",
      "https://www.googleapis.com/auth/calendar",
    ]);
    expect(entry.gmailRefreshToken).toBe("gmail-refresh");
    expect(entry.gmailScopes).toEqual([
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);
  });

  it("clearGmail drops gmail fields and leaves the primary intact", () => {
    store.set("user-1", "primary-refresh", "user@example.com", ["openid"]);
    store.setGmail("user-1", "gmail-refresh", [
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);

    store.clearGmail("user-1");

    const entry = store.get("user-1")!;
    expect(entry.refreshToken).toBe("primary-refresh");
    expect(entry.scopes).toEqual(["openid"]);
    expect(entry.gmailRefreshToken).toBeUndefined();
    expect(entry.gmailScopes).toBeUndefined();
    expect(entry.gmailUpdatedAt).toBeUndefined();
  });

  it("clearGmail is a no-op when the user has no gmail link", () => {
    store.set("user-1", "primary-refresh", "user@example.com", ["openid"]);
    expect(() => store.clearGmail("user-1")).not.toThrow();
    expect(store.get("user-1")!.refreshToken).toBe("primary-refresh");
  });

  it("getGmailAccessToken returns 'not-configured' when env vars are unset", async () => {
    // No GOOGLE_GMAIL_CLIENT_* set in this file → config.googleGmail
    // resolves to empty strings. Even with a stored gmail link, the
    // store should refuse to mint a token when the OAuth client isn't
    // wired up.
    delete process.env.GOOGLE_GMAIL_CLIENT_ID;
    delete process.env.GOOGLE_GMAIL_CLIENT_SECRET;
    await jest.isolateModulesAsync(async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { TokenStore: FreshStore } = require("../../src/services/token-store");
      const fresh = new FreshStore() as TokenStore;
      fresh.set("user-1", "primary-refresh", "user@example.com", []);
      fresh.setGmail("user-1", "gmail-refresh", []);
      const result = await fresh.getGmailAccessToken("user-1");
      expect(result).toEqual({ error: "not-configured" });
    });
  });

  it("getGmailAccessToken returns 'not-linked' when the user has no gmail half", async () => {
    process.env.GOOGLE_GMAIL_CLIENT_ID = "gmail-id";
    process.env.GOOGLE_GMAIL_CLIENT_SECRET = "gmail-secret";
    try {
      await jest.isolateModulesAsync(async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { TokenStore: FreshStore } = require("../../src/services/token-store");
        const fresh = new FreshStore() as TokenStore;
        fresh.set("user-1", "primary-refresh", "user@example.com", []);
        const result = await fresh.getGmailAccessToken("user-1");
        expect(result).toEqual({ error: "not-linked" });
      });
    } finally {
      delete process.env.GOOGLE_GMAIL_CLIENT_ID;
      delete process.env.GOOGLE_GMAIL_CLIENT_SECRET;
    }
  });

  it("getGmailAccessToken mints a fresh access token when configured + linked", async () => {
    process.env.GOOGLE_GMAIL_CLIENT_ID = "gmail-id";
    process.env.GOOGLE_GMAIL_CLIENT_SECRET = "gmail-secret";
    try {
      await jest.isolateModulesAsync(async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { TokenStore: FreshStore } = require("../../src/services/token-store");
        const fresh = new FreshStore() as TokenStore;
        fresh.set("user-1", "primary-refresh", "user@example.com", []);
        fresh.setGmail("user-1", "gmail-refresh", []);
        const result = await fresh.getGmailAccessToken("user-1");
        // The googleapis mock at the top of this file resolves
        // refreshAccessToken with a fixed access_token.
        expect(result).toEqual({ accessToken: "fresh-token-123" });
      });
    } finally {
      delete process.env.GOOGLE_GMAIL_CLIENT_ID;
      delete process.env.GOOGLE_GMAIL_CLIENT_SECRET;
    }
  });
});

describe("TokenStore — Gmail encryption at rest", () => {
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

  it("encrypts the gmail refresh token before writing to Redis", async () => {
    const key = randomBytes(32);
    const redis = makeRedis();
    const store = new TokenStore(redis, key);

    store.set("user-1", "primary-refresh", "user@example.com");
    await flushAsync();
    store.setGmail("user-1", "secret-gmail-token", [
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);
    await flushAsync();

    const lastWrite = redis.hsetCalls[redis.hsetCalls.length - 1].value;
    expect(lastWrite.gmailRefreshToken).toBeDefined();
    expect(lastWrite.gmailRefreshToken).not.toBe("secret-gmail-token");
    expect(isEncrypted(lastWrite.gmailRefreshToken!)).toBe(true);
    // In-memory cache stays plaintext for fast access.
    expect(store.get("user-1")!.gmailRefreshToken).toBe("secret-gmail-token");
  });

  it("hydrates encrypted gmail refresh tokens by decrypting them", async () => {
    const key = randomBytes(32);
    const redis = makeRedis({
      "user-1": {
        userId: "user-1",
        refreshToken: encryptToken("primary-hidden", key),
        email: "u1@example.com",
        updatedAt: "2026-04-30T00:00:00.000Z",
        scopes: ["openid"],
        gmailRefreshToken: encryptToken("gmail-hidden", key),
        gmailScopes: [
          "https://www.googleapis.com/auth/gmail.readonly",
        ],
        gmailUpdatedAt: "2026-04-30T00:00:00.000Z",
      },
    });
    const store = new TokenStore(redis, key);
    await store.hydrate();

    const entry = store.get("user-1")!;
    expect(entry.refreshToken).toBe("primary-hidden");
    expect(entry.gmailRefreshToken).toBe("gmail-hidden");
    expect(entry.gmailScopes).toEqual([
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);
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
        scopes: [],
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
      } as TokenEntry,
    });
    const store = new TokenStore(redis, key);
    await store.hydrate();

    // Pre-encryption entries stay readable; they get rewritten as
    // encrypted on the user's next login.
    const loaded = store.get("legacy-user")!;
    expect(loaded.refreshToken).toBe("plaintext-from-before-encryption");
    // Pre-scope-tracking entries get coerced to an empty scope list so
    // downstream feature gates can rely on `scopes` always being an array.
    expect(loaded.scopes).toEqual([]);
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
        scopes: [],
      },
      "user-good": {
        userId: "user-good",
        refreshToken: encryptToken("token-good", newKey),
        email: "good@example.com",
        updatedAt: "2026-04-30T00:00:00.000Z",
        scopes: [],
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
        scopes: [],
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
