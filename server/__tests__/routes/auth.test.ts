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

    const res = await request(makeApp()).post("/auth/google").send({ code: "valid-code" });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBe("access-abc");
    expect(res.body.refreshToken).toBe("refresh-xyz");
    expect(res.body.user.email).toBe("user@test.com");
    expect(res.body.user.name).toBe("Test User");
  });

  it("stores refresh token in TokenStore when provided", async () => {
    const tokenStore = new TokenStore();
    mockGetToken.mockResolvedValueOnce({
      tokens: { access_token: "acc", refresh_token: "ref-token", expiry_date: 0 },
    });
    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "u2", email: "u2@test.com", name: "User 2", picture: null },
    });

    await request(makeApp(tokenStore)).post("/auth/google").send({ code: "code-abc" });

    const stored = tokenStore.get("u2");
    expect(stored?.refreshToken).toBe("ref-token");
  });

  it("does not crash when no tokenStore is provided", async () => {
    mockGetToken.mockResolvedValueOnce({
      tokens: { access_token: "acc", refresh_token: "ref", expiry_date: 0 },
    });
    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "u3", email: "u3@test.com", name: "User 3", picture: null },
    });

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
