// Set env vars before any imports so config picks them up
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.GOOGLE_GMAIL_CLIENT_ID = "test-gmail-client-id";
process.env.GOOGLE_GMAIL_CLIENT_SECRET = "test-gmail-client-secret";

import request from "supertest";
import express from "express";
import { createAuthRoutes } from "../../src/routes/auth";
import { TokenStore } from "../../src/services/token-store";

const mockGetToken = jest.fn();
const mockRefreshAccessToken = jest.fn();
const mockUserinfoGet = jest.fn();
const mockTokeninfo = jest.fn();
const mockSetCredentials = jest.fn();

jest.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: mockSetCredentials,
        getToken: mockGetToken,
        refreshAccessToken: mockRefreshAccessToken,
      })),
    },
    oauth2: jest.fn().mockImplementation(() => ({
      userinfo: { get: (...args: unknown[]) => mockUserinfoGet(...args) },
      tokeninfo: (...args: unknown[]) => mockTokeninfo(...args),
    })),
  },
}));

function makeApp(tokenStore?: TokenStore) {
  const app = express();
  app.use(express.json());
  app.use("/auth", createAuthRoutes({ tokenStore }));
  return app;
}

describe("POST /auth/google", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 400 when code is missing", async () => {
    const res = await request(makeApp()).post("/auth/google").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Authorization code/i);
  });

  it("returns tokens and user info on success", async () => {
    mockGetToken.mockResolvedValueOnce({
      tokens: {
        access_token: "access-abc",
        refresh_token: "refresh-xyz",
        expiry_date: 9_999_999_999_999,
        scope:
          "openid email profile https://www.googleapis.com/auth/drive.file",
      },
    });
    mockUserinfoGet.mockResolvedValueOnce({
      data: {
        id: "u1",
        email: "user@test.com",
        name: "Test User",
        picture: "https://example.com/pic.jpg",
      },
    });
    mockTokeninfo.mockResolvedValueOnce({
      data: {
        scope:
          "openid email profile https://www.googleapis.com/auth/drive.file",
      },
    });

    const res = await request(makeApp()).post("/auth/google").send({ code: "valid-code" });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe("access-abc");
    expect(res.body.refreshToken).toBe("refresh-xyz");
    expect(res.body.user.email).toBe("user@test.com");
    expect(res.body.user.name).toBe("Test User");
    expect(res.body.scopes).toEqual([
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/drive.file",
    ]);
  });

  it("falls back to tokens.scope when tokeninfo introspection fails", async () => {
    mockGetToken.mockResolvedValueOnce({
      tokens: {
        access_token: "acc",
        refresh_token: "ref",
        expiry_date: 0,
        scope: "openid https://www.googleapis.com/auth/drive.file",
      },
    });
    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "u-fb", email: "fb@test.com", name: "F", picture: null },
    });
    mockTokeninfo.mockRejectedValueOnce(new Error("rate limited"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const res = await request(makeApp()).post("/auth/google").send({ code: "x" });
    expect(res.status).toBe(200);
    expect(res.body.scopes).toEqual([
      "openid",
      "https://www.googleapis.com/auth/drive.file",
    ]);
    warn.mockRestore();
  });

  it("returns an empty scope list when both tokeninfo and tokens.scope are empty", async () => {
    mockGetToken.mockResolvedValueOnce({
      tokens: {
        access_token: "acc",
        refresh_token: "ref",
        expiry_date: 0,
      },
    });
    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "u-noscope", email: "n@test.com", name: "N", picture: null },
    });
    mockTokeninfo.mockResolvedValueOnce({ data: {} });

    const res = await request(makeApp()).post("/auth/google").send({ code: "x" });
    expect(res.status).toBe(200);
    expect(res.body.scopes).toEqual([]);
  });

  it("stores refresh token and granted scopes in TokenStore when provided", async () => {
    const tokenStore = new TokenStore();
    mockGetToken.mockResolvedValueOnce({
      tokens: {
        access_token: "acc",
        refresh_token: "ref-token",
        expiry_date: 0,
        scope:
          "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.readonly",
      },
    });
    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "u2", email: "u2@test.com", name: "User 2", picture: null },
    });
    mockTokeninfo.mockResolvedValueOnce({
      data: {
        scope:
          "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.readonly",
      },
    });

    await request(makeApp(tokenStore)).post("/auth/google").send({ code: "code-abc" });

    const stored = tokenStore.get("u2");
    expect(stored?.refreshToken).toBe("ref-token");
    expect(stored?.scopes).toEqual([
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);
  });

  it("drops stale scopes when the user revoked them in Google Account (revoke-and-resign)", async () => {
    // Pre-seed a user who previously granted Drive + Calendar, then
    // went into Google Account → "Apps with access" and revoked the
    // app entirely. Google forgot all their consents.
    const tokenStore = new TokenStore();
    tokenStore.set("u-revoke", "old-refresh", "u-revoke@test.com", [
      "openid",
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/calendar",
    ]);

    // User signs in fresh — primary client requests only INITIAL_SCOPES
    // (drive + identity, not calendar). tokeninfo returns just those.
    mockGetToken.mockResolvedValueOnce({
      tokens: {
        access_token: "acc-fresh",
        refresh_token: "ref-fresh",
        expiry_date: 0,
        scope:
          "openid email profile https://www.googleapis.com/auth/drive.file",
      },
    });
    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "u-revoke", email: "u-revoke@test.com", name: "R", picture: null },
    });
    mockTokeninfo.mockResolvedValueOnce({
      data: {
        scope:
          "openid email profile https://www.googleapis.com/auth/drive.file",
      },
    });

    const res = await request(makeApp(tokenStore)).post("/auth/google").send({
      code: "fresh-after-revoke",
    });

    // The stale `calendar` scope must be dropped — otherwise the UI
    // would gate the Calendar feature on a phantom permission.
    expect(res.status).toBe(200);
    expect(res.body.scopes).toEqual([
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/drive.file",
    ]);
    expect(res.body.scopes).not.toContain(
      "https://www.googleapis.com/auth/calendar",
    );
    expect(tokenStore.get("u-revoke")?.scopes).toEqual(res.body.scopes);
  });

  it("preserves previously stored scopes when tokeninfo fails (fallback path)", async () => {
    // The union-with-previous safety net is only meaningful when
    // tokeninfo can't be reached — without it, an incremental grant
    // would shrink the stored set down to just the new scope.
    const tokenStore = new TokenStore();
    tokenStore.set("u-fb", "old-refresh", "u-fb@test.com", [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/drive.file",
    ]);

    mockGetToken.mockResolvedValueOnce({
      tokens: {
        access_token: "acc-incr",
        refresh_token: "ref-incr",
        expiry_date: 0,
        // Code-exchange response reports only the just-granted scope.
        scope: "https://www.googleapis.com/auth/calendar",
      },
    });
    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "u-fb", email: "u-fb@test.com", name: "F", picture: null },
    });
    // tokeninfo throws → fall back to tokens.scope.
    mockTokeninfo.mockRejectedValueOnce(new Error("rate limited"));
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const res = await request(makeApp(tokenStore)).post("/auth/google").send({
      code: "incr-fallback",
    });
    warn.mockRestore();

    expect(res.status).toBe(200);
    expect(new Set(res.body.scopes)).toEqual(
      new Set([
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/drive.file",
        "https://www.googleapis.com/auth/calendar",
      ]),
    );
  });

  it("unions newly-granted scopes with previously stored ones (incremental flow)", async () => {
    // Pre-seed a user who already granted the initial sign-in scopes.
    const tokenStore = new TokenStore();
    tokenStore.set("u-incr", "old-refresh", "u-incr@test.com", [
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/drive.file",
    ]);

    // Now they incrementally grant gmail.readonly. Google's code-exchange
    // response reports only the *new* scope — that's why we use tokeninfo
    // to introspect the access token, which DOES list the cumulative set.
    mockGetToken.mockResolvedValueOnce({
      tokens: {
        access_token: "acc-new",
        refresh_token: "ref-new",
        expiry_date: 0,
        scope: "https://www.googleapis.com/auth/gmail.readonly",
      },
    });
    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "u-incr", email: "u-incr@test.com", name: "U", picture: null },
    });
    mockTokeninfo.mockResolvedValueOnce({
      data: {
        scope:
          "openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.readonly",
      },
    });

    const res = await request(makeApp(tokenStore)).post("/auth/google").send({
      code: "incremental-code",
    });

    expect(res.status).toBe(200);
    expect(res.body.scopes).toEqual([
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);
    expect(tokenStore.get("u-incr")?.scopes).toEqual(res.body.scopes);
  });

  it("does not crash when no tokenStore is provided", async () => {
    mockGetToken.mockResolvedValueOnce({
      tokens: { access_token: "acc", refresh_token: "ref", expiry_date: 0 },
    });
    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "u3", email: "u3@test.com", name: "User 3", picture: null },
    });
    mockTokeninfo.mockResolvedValueOnce({ data: { scope: "openid" } });

    const res = await request(makeApp()).post("/auth/google").send({ code: "code-xyz" });
    expect(res.status).toBe(200);
  });

  it("returns 401 when Google rejects the auth code", async () => {
    mockGetToken.mockRejectedValueOnce(new Error("Invalid authorization code"));

    const res = await request(makeApp()).post("/auth/google").send({ code: "bad-code" });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("Invalid authorization code");
  });
});

describe("GET /auth/scopes", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 without a Bearer token", async () => {
    const res = await request(makeApp()).get("/auth/scopes");
    expect(res.status).toBe(401);
  });

  it("returns scopes introspected via tokeninfo for a valid token", async () => {
    // requireAuth middleware validates the token via userinfo.get(),
    // then the handler introspects via tokeninfo.
    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "u-existing", email: "e@test.com" },
    });
    mockTokeninfo.mockResolvedValueOnce({
      data: {
        scope:
          "openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.readonly",
      },
    });

    const res = await request(makeApp())
      .get("/auth/scopes")
      .set("Authorization", "Bearer some-access-token");

    expect(res.status).toBe(200);
    expect(res.body.scopes).toEqual([
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);
  });

  it("merges discovered scopes into the TokenStore", async () => {
    const tokenStore = new TokenStore();
    // User logged in before scope tracking shipped — empty scope list.
    tokenStore.set("u-legacy", "old-refresh", "legacy@test.com", []);

    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "u-legacy", email: "legacy@test.com" },
    });
    mockTokeninfo.mockResolvedValueOnce({
      data: {
        scope:
          "openid https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar",
      },
    });

    const res = await request(makeApp(tokenStore))
      .get("/auth/scopes")
      .set("Authorization", "Bearer access-token");

    expect(res.status).toBe(200);
    expect(tokenStore.get("u-legacy")?.scopes).toEqual([
      "openid",
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/calendar",
    ]);
  });
});

describe("POST /auth/refresh", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 400 when refreshToken is missing", async () => {
    const res = await request(makeApp()).post("/auth/refresh").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Refresh token/i);
  });

  it("returns new access token and expiry on success", async () => {
    mockRefreshAccessToken.mockResolvedValueOnce({
      credentials: { access_token: "new-access-token", expiry_date: 9_999_999 },
    });

    const res = await request(makeApp())
      .post("/auth/refresh")
      .send({ refreshToken: "valid-refresh-token" });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe("new-access-token");
    expect(res.body.expiresAt).toBe(9_999_999);
  });

  it("returns 401 when the refresh token is revoked or invalid", async () => {
    mockRefreshAccessToken.mockRejectedValueOnce(new Error("Token has been revoked"));

    const res = await request(makeApp())
      .post("/auth/refresh")
      .send({ refreshToken: "bad-refresh" });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain("Token has been revoked");
  });
});

describe("POST /auth/google response — gmail block", () => {
  beforeEach(() => jest.clearAllMocks());

  it("includes gmail: null when the user has never linked", async () => {
    const tokenStore = new TokenStore();
    mockGetToken.mockResolvedValueOnce({
      tokens: { access_token: "acc", refresh_token: "ref", expiry_date: 0 },
    });
    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "u-fresh", email: "fresh@test.com", name: "F", picture: null },
    });
    mockTokeninfo.mockResolvedValueOnce({
      data: { scope: "openid https://www.googleapis.com/auth/drive.file" },
    });

    const res = await request(makeApp(tokenStore)).post("/auth/google").send({
      code: "x",
    });
    expect(res.status).toBe(200);
    expect(res.body.gmail).toBeNull();
  });

  it("includes gmail.scopes + linkedAt when the user has a link", async () => {
    const tokenStore = new TokenStore();
    // Pre-seed a user who's already linked Gmail.
    tokenStore.set("u-linked", "primary-refresh", "linked@test.com", ["openid"]);
    tokenStore.setGmail("u-linked", "gmail-refresh", [
      "openid",
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);

    mockGetToken.mockResolvedValueOnce({
      tokens: { access_token: "acc", refresh_token: "ref", expiry_date: 0 },
    });
    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "u-linked", email: "linked@test.com", name: "L", picture: null },
    });
    mockTokeninfo.mockResolvedValueOnce({
      data: { scope: "openid https://www.googleapis.com/auth/drive.file" },
    });

    const res = await request(makeApp(tokenStore)).post("/auth/google").send({
      code: "x",
    });
    expect(res.status).toBe(200);
    expect(res.body.gmail).toEqual({
      scopes: [
        "openid",
        "https://www.googleapis.com/auth/gmail.readonly",
      ],
      linkedAt: expect.any(String),
    });
  });
});

describe("POST /auth/google/gmail", () => {
  beforeEach(() => jest.clearAllMocks());

  function seedPrimary(tokenStore: TokenStore, userId = "u-primary") {
    tokenStore.set(userId, "primary-refresh", `${userId}@test.com`, [
      "openid",
      "https://www.googleapis.com/auth/drive.file",
    ]);
    return userId;
  }

  it("returns 401 without a Bearer token (requireAuth gates the route)", async () => {
    const res = await request(makeApp(new TokenStore()))
      .post("/auth/google/gmail")
      .send({ code: "any" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when code is missing", async () => {
    const tokenStore = new TokenStore();
    seedPrimary(tokenStore);
    // requireAuth runs first and validates via userinfo.get().
    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "u-primary", email: "u-primary@test.com" },
    });

    const res = await request(makeApp(tokenStore))
      .post("/auth/google/gmail")
      .set("Authorization", "Bearer primary-access")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Authorization code/i);
  });

  it("attaches gmail link when account IDs match", async () => {
    const tokenStore = new TokenStore();
    seedPrimary(tokenStore, "u-1");

    // requireAuth: validates the primary bearer token.
    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "u-1", email: "u-1@test.com" },
    });
    // Gmail code-exchange:
    mockGetToken.mockResolvedValueOnce({
      tokens: {
        access_token: "gmail-acc",
        refresh_token: "gmail-ref",
        expiry_date: 0,
        scope: "https://www.googleapis.com/auth/gmail.readonly",
      },
    });
    // Gmail userinfo from the new client:
    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "u-1", email: "u-1@test.com" },
    });
    // tokeninfo introspection of the gmail access token:
    mockTokeninfo.mockResolvedValueOnce({
      data: {
        scope:
          "openid email profile https://www.googleapis.com/auth/gmail.readonly",
      },
    });

    const res = await request(makeApp(tokenStore))
      .post("/auth/google/gmail")
      .set("Authorization", "Bearer primary-access")
      .send({ code: "gmail-code" });

    expect(res.status).toBe(200);
    expect(res.body.scopes).toEqual([
      "openid",
      "email",
      "profile",
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);
    expect(res.body.linkedAt).toEqual(expect.any(String));

    const stored = tokenStore.get("u-1")!;
    expect(stored.refreshToken).toBe("primary-refresh");
    expect(stored.gmailRefreshToken).toBe("gmail-ref");
    expect(stored.gmailScopes).toContain(
      "https://www.googleapis.com/auth/gmail.readonly",
    );
  });

  it("rejects with 400 GMAIL_ACCOUNT_MISMATCH when the gmail consent returned a different Google account", async () => {
    const tokenStore = new TokenStore();
    seedPrimary(tokenStore, "u-primary");

    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "u-primary", email: "u-primary@test.com" },
    });
    mockGetToken.mockResolvedValueOnce({
      tokens: {
        access_token: "gmail-acc",
        refresh_token: "gmail-ref",
        expiry_date: 0,
        scope: "https://www.googleapis.com/auth/gmail.readonly",
      },
    });
    // Gmail consent screen authorized a different account.
    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "u-other", email: "other@test.com" },
    });

    const res = await request(makeApp(tokenStore))
      .post("/auth/google/gmail")
      .set("Authorization", "Bearer primary-access")
      .send({ code: "gmail-code" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("GMAIL_ACCOUNT_MISMATCH");
    // Must not have linked anything to either account.
    expect(tokenStore.get("u-primary")?.gmailRefreshToken).toBeUndefined();
    expect(tokenStore.get("u-other")).toBeUndefined();
  });

  it("rejects with 400 GMAIL_REFRESH_TOKEN_MISSING when Google omits the refresh token", async () => {
    const tokenStore = new TokenStore();
    seedPrimary(tokenStore, "u-1");

    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "u-1", email: "u-1@test.com" },
    });
    mockGetToken.mockResolvedValueOnce({
      tokens: {
        access_token: "gmail-acc",
        // No refresh_token — Google does this when the user has an
        // existing grant and the request didn't force consent.
        expiry_date: 0,
        scope: "https://www.googleapis.com/auth/gmail.readonly",
      },
    });
    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "u-1", email: "u-1@test.com" },
    });

    const res = await request(makeApp(tokenStore))
      .post("/auth/google/gmail")
      .set("Authorization", "Bearer primary-access")
      .send({ code: "gmail-code" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("GMAIL_REFRESH_TOKEN_MISSING");
  });

  it("returns 503 GMAIL_CLIENT_NOT_CONFIGURED when env vars are unset", async () => {
    delete process.env.GOOGLE_GMAIL_CLIENT_ID;
    delete process.env.GOOGLE_GMAIL_CLIENT_SECRET;
    try {
      await jest.isolateModulesAsync(async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { createAuthRoutes: freshRoutes } = require("../../src/routes/auth");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { TokenStore: FreshStore } = require("../../src/services/token-store");
        const store = new FreshStore() as TokenStore;
        store.set("u-1", "primary-refresh", "u-1@test.com", []);

        const app = express();
        app.use(express.json());
        app.use("/auth", freshRoutes({ tokenStore: store }));

        mockUserinfoGet.mockResolvedValueOnce({
          data: { id: "u-1", email: "u-1@test.com" },
        });

        const res = await request(app)
          .post("/auth/google/gmail")
          .set("Authorization", "Bearer primary-access")
          .send({ code: "gmail-code" });

        expect(res.status).toBe(503);
        expect(res.body.code).toBe("GMAIL_CLIENT_NOT_CONFIGURED");
      });
    } finally {
      process.env.GOOGLE_GMAIL_CLIENT_ID = "test-gmail-client-id";
      process.env.GOOGLE_GMAIL_CLIENT_SECRET = "test-gmail-client-secret";
    }
  });
});

describe("DELETE /auth/google/gmail", () => {
  beforeEach(() => jest.clearAllMocks());

  it("clears the gmail half and leaves the primary intact", async () => {
    const tokenStore = new TokenStore();
    tokenStore.set("u-1", "primary-refresh", "u-1@test.com", ["openid"]);
    tokenStore.setGmail("u-1", "gmail-refresh", [
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);

    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "u-1", email: "u-1@test.com" },
    });

    const res = await request(makeApp(tokenStore))
      .delete("/auth/google/gmail")
      .set("Authorization", "Bearer primary-access");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const stored = tokenStore.get("u-1")!;
    expect(stored.refreshToken).toBe("primary-refresh");
    expect(stored.gmailRefreshToken).toBeUndefined();
  });

  it("is idempotent for users who never linked", async () => {
    const tokenStore = new TokenStore();
    tokenStore.set("u-1", "primary-refresh", "u-1@test.com", []);

    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "u-1", email: "u-1@test.com" },
    });

    const res = await request(makeApp(tokenStore))
      .delete("/auth/google/gmail")
      .set("Authorization", "Bearer primary-access");

    expect(res.status).toBe(200);
  });
});

describe("GET /auth/google/gmail", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns linked: false for users with no gmail half", async () => {
    const tokenStore = new TokenStore();
    tokenStore.set("u-1", "primary-refresh", "u-1@test.com", []);

    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "u-1", email: "u-1@test.com" },
    });

    const res = await request(makeApp(tokenStore))
      .get("/auth/google/gmail")
      .set("Authorization", "Bearer primary-access");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ linked: false });
  });

  it("returns linked: true plus scopes + timestamp when linked", async () => {
    const tokenStore = new TokenStore();
    tokenStore.set("u-1", "primary-refresh", "u-1@test.com", []);
    tokenStore.setGmail("u-1", "gmail-refresh", [
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);

    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "u-1", email: "u-1@test.com" },
    });

    const res = await request(makeApp(tokenStore))
      .get("/auth/google/gmail")
      .set("Authorization", "Bearer primary-access");

    expect(res.status).toBe(200);
    expect(res.body.linked).toBe(true);
    expect(res.body.scopes).toEqual([
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);
    expect(res.body.linkedAt).toEqual(expect.any(String));
  });
});
