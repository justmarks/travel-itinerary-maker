import { TokenStore } from "../../src/services/token-store";

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
