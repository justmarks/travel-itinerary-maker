// Set env vars before any imports so config picks them up
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";

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
