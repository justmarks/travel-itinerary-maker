/**
 * Tests for `getActiveAccessToken` — the bridge between the
 * `connections` store and the OAuth refresh helpers. Mocks both
 * `oauth-refresh` (so we don't need env vars) and the store (so we
 * don't need a real Postgres) to focus on the cache / refresh / persist
 * decisions this module owns.
 */

import { OAuthRefreshError } from "../../src/services/oauth-refresh";

// Mock oauth-refresh to control what the refresh calls return without
// caring about env vars or the network.
jest.mock("../../src/services/oauth-refresh", () => {
  const actual = jest.requireActual("../../src/services/oauth-refresh");
  return {
    ...actual,
    refreshGoogleToken: jest.fn(),
    refreshMicrosoftToken: jest.fn(),
  };
});

import {
  refreshGoogleToken,
  refreshMicrosoftToken,
} from "../../src/services/oauth-refresh";
import { getActiveAccessToken } from "../../src/services/connections-token";
import type {
  Connection,
  ConnectionsStore,
} from "../../src/services/connections-store";

const mockRefreshGoogle = refreshGoogleToken as jest.MockedFunction<
  typeof refreshGoogleToken
>;
const mockRefreshMicrosoft = refreshMicrosoftToken as jest.MockedFunction<
  typeof refreshMicrosoftToken
>;

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "conn-1",
    userId: "user-1",
    provider: "google",
    capability: "calendar",
    accountEmail: "user@example.com",
    refreshToken: "rt-1",
    accessToken: "at-cached",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    scopes: ["openid", "https://www.googleapis.com/auth/calendar"],
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function mockStore(initial: Connection[]): jest.Mocked<ConnectionsStore> {
  // Pass through whatever the test sets up. The resolver has its
  // own `status === "active"` filter (defense-in-depth on top of
  // the production store's filter), and the "skips revoked
  // connections" test relies on that filter actually doing work.
  const list = jest.fn().mockResolvedValue(initial);
  const upsert = jest.fn().mockImplementation((input) =>
    Promise.resolve({
      ...initial[0],
      ...input,
      updatedAt: new Date(),
    } as Connection),
  );
  // Cast — only listForUser + upsert are exercised here; other methods
  // get jest.fn() stubs that throw on accidental use.
  return {
    listForUser: list,
    upsert,
    findByKey: jest.fn(),
    getById: jest.fn(),
    markRevoked: jest.fn().mockResolvedValue(true),
    hardDeleteForUser: jest.fn(),
  } as unknown as jest.Mocked<ConnectionsStore>;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("getActiveAccessToken", () => {
  it("returns null when no matching connection exists", async () => {
    const store = mockStore([]);
    const result = await getActiveAccessToken(
      { store },
      "user-1",
      "google",
      "calendar",
    );
    expect(result).toBeNull();
    expect(mockRefreshGoogle).not.toHaveBeenCalled();
  });

  it("returns the cached access token when not near expiry", async () => {
    const store = mockStore([makeConnection()]);

    const result = await getActiveAccessToken(
      { store },
      "user-1",
      "google",
      "calendar",
    );
    expect(result?.accessToken).toBe("at-cached");
    expect(mockRefreshGoogle).not.toHaveBeenCalled();
  });

  it("refreshes when the cached token is past its expiry", async () => {
    const store = mockStore([
      makeConnection({
        expiresAt: new Date(Date.now() - 60 * 1000), // already expired
      }),
    ]);
    mockRefreshGoogle.mockResolvedValueOnce({
      accessToken: "at-fresh",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      refreshToken: "rt-rotated",
    });

    const result = await getActiveAccessToken(
      { store },
      "user-1",
      "google",
      "calendar",
    );

    expect(result?.accessToken).toBe("at-fresh");
    expect(mockRefreshGoogle).toHaveBeenCalledWith("rt-1", "primary");
    // Calendar refreshes against the primary Google client.
    expect(store.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: "at-fresh",
        refreshToken: "rt-rotated",
      }),
    );
  });

  it("refreshes when access token is missing entirely", async () => {
    const store = mockStore([
      makeConnection({
        accessToken: undefined,
        expiresAt: undefined,
      }),
    ]);
    mockRefreshGoogle.mockResolvedValueOnce({
      accessToken: "at-new",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const result = await getActiveAccessToken(
      { store },
      "user-1",
      "google",
      "calendar",
    );
    expect(result?.accessToken).toBe("at-new");
    expect(mockRefreshGoogle).toHaveBeenCalled();
  });

  it("uses the Gmail client when capability is email + provider is google", async () => {
    const store = mockStore([
      makeConnection({
        capability: "email",
        accessToken: undefined,
      }),
    ]);
    mockRefreshGoogle.mockResolvedValueOnce({
      accessToken: "at-gmail",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    await getActiveAccessToken({ store }, "user-1", "google", "email");

    expect(mockRefreshGoogle).toHaveBeenCalledWith("rt-1", "gmail");
  });

  it("uses the Microsoft refresh helper when provider is microsoft", async () => {
    const store = mockStore([
      makeConnection({
        provider: "microsoft",
        capability: "email",
        accessToken: undefined,
        scopes: ["openid", "Mail.Read", "offline_access"],
      }),
    ]);
    mockRefreshMicrosoft.mockResolvedValueOnce({
      accessToken: "at-ms",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    await getActiveAccessToken({ store }, "user-1", "microsoft", "email");

    expect(mockRefreshMicrosoft).toHaveBeenCalledWith("rt-1", [
      "openid",
      "Mail.Read",
      "offline_access",
    ]);
  });

  it("returns null when refresh fails", async () => {
    const store = mockStore([
      makeConnection({
        expiresAt: new Date(Date.now() - 60 * 1000),
      }),
    ]);
    mockRefreshGoogle.mockRejectedValueOnce(
      new OAuthRefreshError("google", 400, "invalid_grant", "revoked"),
    );

    const result = await getActiveAccessToken(
      { store },
      "user-1",
      "google",
      "calendar",
    );
    expect(result).toBeNull();
    expect(store.upsert).not.toHaveBeenCalled();
  });

  it("marks the connection revoked on a permanent refresh failure", async () => {
    const store = mockStore([
      makeConnection({
        expiresAt: new Date(Date.now() - 60 * 1000),
      }),
    ]);
    mockRefreshGoogle.mockRejectedValueOnce(
      new OAuthRefreshError(
        "google",
        400,
        "invalid_grant",
        "Token has been revoked.",
      ),
    );

    await getActiveAccessToken({ store }, "user-1", "google", "calendar");

    expect(store.markRevoked).toHaveBeenCalledWith("conn-1", "user-1");
  });

  it("does NOT mark revoked on transient failures (5xx)", async () => {
    const store = mockStore([
      makeConnection({
        expiresAt: new Date(Date.now() - 60 * 1000),
      }),
    ]);
    mockRefreshGoogle.mockRejectedValueOnce(
      new OAuthRefreshError("google", 503, "service_unavailable", "Try again"),
    );

    await getActiveAccessToken({ store }, "user-1", "google", "calendar");

    expect(store.markRevoked).not.toHaveBeenCalled();
  });

  it("does NOT mark revoked on network errors (not OAuthRefreshError)", async () => {
    const store = mockStore([
      makeConnection({
        expiresAt: new Date(Date.now() - 60 * 1000),
      }),
    ]);
    mockRefreshGoogle.mockRejectedValueOnce(new Error("network exploded"));

    await getActiveAccessToken({ store }, "user-1", "google", "calendar");

    expect(store.markRevoked).not.toHaveBeenCalled();
  });

  it("returns null when expired with no refresh token", async () => {
    const store = mockStore([
      makeConnection({
        expiresAt: new Date(Date.now() - 60 * 1000),
        refreshToken: undefined,
      }),
    ]);

    const result = await getActiveAccessToken(
      { store },
      "user-1",
      "google",
      "calendar",
    );
    expect(result).toBeNull();
    expect(mockRefreshGoogle).not.toHaveBeenCalled();
  });

  it("picks the most-recently-updated connection when multiple exist", async () => {
    const older = makeConnection({
      id: "conn-old",
      accountEmail: "old@example.com",
      accessToken: "at-old",
      updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });
    const newer = makeConnection({
      id: "conn-new",
      accountEmail: "new@example.com",
      accessToken: "at-new",
      updatedAt: new Date(),
    });
    const store = mockStore([older, newer]);

    const result = await getActiveAccessToken(
      { store },
      "user-1",
      "google",
      "calendar",
    );
    expect(result?.connection.id).toBe("conn-new");
    expect(result?.accessToken).toBe("at-new");
  });

  it("skips revoked connections", async () => {
    const store = mockStore([
      makeConnection({ status: "revoked" }),
    ]);
    const result = await getActiveAccessToken(
      { store },
      "user-1",
      "google",
      "calendar",
    );
    expect(result).toBeNull();
  });
});
