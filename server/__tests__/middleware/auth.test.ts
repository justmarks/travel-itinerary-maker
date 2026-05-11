// Set env vars before any imports so config picks them up. Without
// these, requireGmailAuth would always return GMAIL_CLIENT_NOT_CONFIGURED
// and the "happy path" tests below couldn't exercise the refresh path.
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.GOOGLE_GMAIL_CLIENT_ID = "test-gmail-id";
process.env.GOOGLE_GMAIL_CLIENT_SECRET = "test-gmail-secret";

import type { Request, Response, NextFunction } from "express";

const mockUserinfoGet = jest.fn();
const mockSetCredentials = jest.fn();
const mockRefreshAccessToken = jest.fn();

jest.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: mockSetCredentials,
        refreshAccessToken: mockRefreshAccessToken,
      })),
    },
    oauth2: jest.fn().mockReturnValue({
      userinfo: {
        get: mockUserinfoGet,
      },
    }),
  },
}));

import { requireAuth, requireGmailAuth } from "../../src/middleware/auth";
import { TokenStore } from "../../src/services/token-store";

function makeReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function makeRes() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res as unknown as Response;
}

describe("requireAuth middleware", () => {
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    next = jest.fn();
  });

  it("rejects request with no Authorization header", async () => {
    const req = makeReq();
    const res = makeRes();
    await requireAuth(req, res, next as unknown as NextFunction);
    expect((res.status as jest.Mock).mock.calls[0][0]).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects Authorization header that is not Bearer scheme", async () => {
    const req = makeReq({ authorization: "Basic dXNlcjpwYXNz" });
    const res = makeRes();
    await requireAuth(req, res, next as unknown as NextFunction);
    expect((res.status as jest.Mock).mock.calls[0][0]).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches user info and calls next for a valid token", async () => {
    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "user-123", email: "test@example.com" },
    });
    const req = makeReq({ authorization: "Bearer valid-token" }) as Request & {
      userId?: string;
      userEmail?: string;
      accessToken?: string;
    };
    const res = makeRes();
    await requireAuth(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalled();
    expect(req.userId).toBe("user-123");
    expect(req.userEmail).toBe("test@example.com");
    expect(req.accessToken).toBe("valid-token");
  });

  it("strips 'Bearer ' prefix before storing access token", async () => {
    mockUserinfoGet.mockResolvedValueOnce({
      data: { id: "u1", email: "u1@example.com" },
    });
    const req = makeReq({ authorization: "Bearer my-token-xyz" }) as Request & {
      accessToken?: string;
    };
    const res = makeRes();
    await requireAuth(req, res, next as unknown as NextFunction);
    expect(req.accessToken).toBe("my-token-xyz");
  });

  it("returns 401 when Google token validation throws", async () => {
    mockUserinfoGet.mockRejectedValueOnce(new Error("Invalid Credentials"));
    const req = makeReq({ authorization: "Bearer bad-token" });
    const res = makeRes();
    await requireAuth(req, res, next as unknown as NextFunction);
    expect((res.status as jest.Mock).mock.calls[0][0]).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 error message for expired token", async () => {
    mockUserinfoGet.mockRejectedValueOnce(new Error("Token has been expired or revoked"));
    const req = makeReq({ authorization: "Bearer expired-token" });
    const res = makeRes();
    await requireAuth(req, res, next as unknown as NextFunction);
    expect((res.json as jest.Mock).mock.calls[0][0]).toHaveProperty("error");
    expect(next).not.toHaveBeenCalled();
  });

  it("does not log when Google rejects token with 401 (expected failure)", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const googleErr = Object.assign(new Error("Invalid Credentials"), {
      response: { status: 401 },
    });
    mockUserinfoGet.mockRejectedValueOnce(googleErr);
    const req = makeReq({ authorization: "Bearer expired-token" });
    const res = makeRes();
    await requireAuth(req, res, next as unknown as NextFunction);
    expect((res.status as jest.Mock).mock.calls[0][0]).toBe(401);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("logs when Google fails with non-401 (unexpected failure)", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const networkErr = Object.assign(new Error("ETIMEDOUT"), {
      response: { status: 503 },
    });
    mockUserinfoGet.mockRejectedValueOnce(networkErr);
    const req = makeReq({ authorization: "Bearer some-token" });
    const res = makeRes();
    await requireAuth(req, res, next as unknown as NextFunction);
    expect((res.status as jest.Mock).mock.calls[0][0]).toBe(401);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

describe("requireAuth — Supabase JWT path (phase 3)", () => {
  // Lazy import to avoid affecting the module-mock setup at the top
  // of the file. The configure/reset helpers let each test set the
  // validator the middleware should call.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { configureAuth, _resetAuthForTests } = require("../../src/middleware/auth");

  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    next = jest.fn();
    _resetAuthForTests();
  });

  afterAll(() => {
    _resetAuthForTests();
  });

  // A minimal JWT-shaped token. Doesn't need to be cryptographically
  // valid — the mock validator decides accept/reject.
  const jwtShaped =
    "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.signature-here-as-base64url";

  it("validates via Supabase when configured + token is JWT-shaped", async () => {
    const validator = jest.fn().mockResolvedValue({
      sub: "supabase-uuid-1",
      email: "alice@example.com",
      provider: "google",
    });
    configureAuth({ supabaseValidator: validator });

    const req = makeReq({ authorization: `Bearer ${jwtShaped}` });
    const res = makeRes();
    await requireAuth(req, res, next as unknown as NextFunction);

    expect(validator).toHaveBeenCalledWith(jwtShaped);
    expect(req.userId).toBe("supabase-uuid-1");
    expect(req.userEmail).toBe("alice@example.com");
    expect((req as Request & { authSource?: string }).authSource).toBe(
      "supabase",
    );
    // Supabase path doesn't set accessToken — provider tokens come
    // from connections, not the request.
    expect(req.accessToken).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it("does NOT call the validator for non-JWT-shaped tokens (Google opaque)", async () => {
    const validator = jest.fn();
    configureAuth({ supabaseValidator: validator });
    mockUserinfoGet.mockResolvedValue({
      data: { id: "google-sub", email: "alice@example.com" },
    });

    const req = makeReq({ authorization: "Bearer ya29.A0AfH6SMAAAAA" });
    const res = makeRes();
    await requireAuth(req, res, next as unknown as NextFunction);

    expect(validator).not.toHaveBeenCalled();
    expect(req.userId).toBe("google-sub");
    expect((req as Request & { authSource?: string }).authSource).toBe(
      "google-legacy",
    );
  });

  it("falls back to Google when Supabase validation throws", async () => {
    const validator = jest.fn().mockRejectedValue(new Error("expired"));
    configureAuth({ supabaseValidator: validator });
    mockUserinfoGet.mockResolvedValue({
      data: { id: "google-sub", email: "alice@example.com" },
    });
    const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();

    const req = makeReq({ authorization: `Bearer ${jwtShaped}` });
    const res = makeRes();
    await requireAuth(req, res, next as unknown as NextFunction);

    expect(validator).toHaveBeenCalled();
    expect(req.userId).toBe("google-sub");
    expect((req as Request & { authSource?: string }).authSource).toBe(
      "google-legacy",
    );
    consoleWarnSpy.mockRestore();
  });

  it("returns 401 when both Supabase and Google reject", async () => {
    const validator = jest.fn().mockRejectedValue(new Error("expired"));
    configureAuth({ supabaseValidator: validator });
    mockUserinfoGet.mockRejectedValue({ response: { status: 401 } });
    const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();

    const req = makeReq({ authorization: `Bearer ${jwtShaped}` });
    const res = makeRes();
    await requireAuth(req, res, next as unknown as NextFunction);

    expect((res.status as jest.Mock).mock.calls[0][0]).toBe(401);
    expect(next).not.toHaveBeenCalled();
    consoleWarnSpy.mockRestore();
  });

  it("when no validator is configured, JWT-shaped tokens go straight to Google", async () => {
    configureAuth({ supabaseValidator: undefined });
    mockUserinfoGet.mockResolvedValue({
      data: { id: "google-sub", email: "alice@example.com" },
    });

    const req = makeReq({ authorization: `Bearer ${jwtShaped}` });
    const res = makeRes();
    await requireAuth(req, res, next as unknown as NextFunction);

    expect(req.userId).toBe("google-sub");
    expect((req as Request & { authSource?: string }).authSource).toBe(
      "google-legacy",
    );
  });
});

describe("requireGmailAuth middleware", () => {
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    next = jest.fn();
  });

  function makeReqWithUser(userId: string | undefined): Request {
    return { headers: {}, userId } as unknown as Request;
  }

  it("returns 500 when requireAuth hasn't run first (no userId on req)", async () => {
    const store = new TokenStore();
    const middleware = requireGmailAuth(store);
    const req = makeReqWithUser(undefined);
    const res = makeRes();
    await middleware(req, res, next as unknown as NextFunction);
    expect((res.status as jest.Mock).mock.calls[0][0]).toBe(500);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 503 GMAIL_CLIENT_NOT_CONFIGURED when env vars are unset", async () => {
    const savedId = process.env.GOOGLE_GMAIL_CLIENT_ID;
    const savedSecret = process.env.GOOGLE_GMAIL_CLIENT_SECRET;
    delete process.env.GOOGLE_GMAIL_CLIENT_ID;
    delete process.env.GOOGLE_GMAIL_CLIENT_SECRET;

    try {
      await jest.isolateModulesAsync(async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { requireGmailAuth: freshMiddleware } = require("../../src/middleware/auth");
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { TokenStore: FreshStore } = require("../../src/services/token-store");
        const store = new FreshStore() as TokenStore;
        store.set("u-1", "primary-refresh", "u-1@test.com");

        const middleware = freshMiddleware(store);
        const req = makeReqWithUser("u-1");
        const res = makeRes();
        await middleware(req, res, next as unknown as NextFunction);

        expect((res.status as jest.Mock).mock.calls[0][0]).toBe(503);
        expect((res.json as jest.Mock).mock.calls[0][0]).toMatchObject({
          code: "GMAIL_CLIENT_NOT_CONFIGURED",
        });
        expect(next).not.toHaveBeenCalled();
      });
    } finally {
      if (savedId) process.env.GOOGLE_GMAIL_CLIENT_ID = savedId;
      if (savedSecret) process.env.GOOGLE_GMAIL_CLIENT_SECRET = savedSecret;
    }
  });

  it("returns 403 GMAIL_SCOPE_REQUIRED when the user has no gmail link", async () => {
    const store = new TokenStore();
    store.set("u-1", "primary-refresh", "u-1@test.com");
    // No setGmail call.

    const middleware = requireGmailAuth(store);
    const req = makeReqWithUser("u-1");
    const res = makeRes();
    await middleware(req, res, next as unknown as NextFunction);

    expect((res.status as jest.Mock).mock.calls[0][0]).toBe(403);
    expect((res.json as jest.Mock).mock.calls[0][0]).toMatchObject({
      code: "GMAIL_SCOPE_REQUIRED",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 GMAIL_SCOPE_REQUIRED when the gmail refresh token fails (revoked / network)", async () => {
    const store = new TokenStore();
    store.set("u-1", "primary-refresh", "u-1@test.com");
    store.setGmail("u-1", "gmail-refresh", [
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);
    mockRefreshAccessToken.mockRejectedValueOnce(new Error("Token has been revoked"));

    const middleware = requireGmailAuth(store);
    const req = makeReqWithUser("u-1");
    const res = makeRes();
    await middleware(req, res, next as unknown as NextFunction);

    expect((res.status as jest.Mock).mock.calls[0][0]).toBe(403);
    expect((res.json as jest.Mock).mock.calls[0][0]).toMatchObject({
      code: "GMAIL_SCOPE_REQUIRED",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches a fresh gmail access token to req and calls next", async () => {
    const store = new TokenStore();
    store.set("u-1", "primary-refresh", "u-1@test.com");
    store.setGmail("u-1", "gmail-refresh", [
      "https://www.googleapis.com/auth/gmail.readonly",
    ]);
    mockRefreshAccessToken.mockResolvedValueOnce({
      credentials: { access_token: "fresh-gmail-access-token" },
    });

    const middleware = requireGmailAuth(store);
    const req = makeReqWithUser("u-1") as Request & {
      gmailAccessToken?: string;
    };
    const res = makeRes();
    await middleware(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalled();
    expect(req.gmailAccessToken).toBe("fresh-gmail-access-token");
  });
});
