/**
 * Tests for the OAuth refresh helpers. Mocks `global.fetch` and
 * inspects the outgoing request body to assert that we're sending
 * the right grant + credentials + scopes to each provider's token
 * endpoint.
 *
 * Env vars get set BEFORE the import below so `config/env.ts`
 * captures them when it evaluates. This mirrors the pattern used by
 * `__tests__/routes/emails.test.ts` for the same reason.
 */

process.env.GOOGLE_CLIENT_ID = "primary-id";
process.env.GOOGLE_CLIENT_SECRET = "primary-secret";
process.env.GOOGLE_GMAIL_CLIENT_ID = "gmail-id";
process.env.GOOGLE_GMAIL_CLIENT_SECRET = "gmail-secret";
process.env.MICROSOFT_CLIENT_ID = "ms-client";
process.env.MICROSOFT_CLIENT_SECRET = "ms-secret";
process.env.MICROSOFT_TENANT_ID = "common";

import {
  refreshGoogleToken,
  refreshMicrosoftToken,
  OAuthRefreshError,
} from "../../src/services/oauth-refresh";

type FetchMock = jest.Mock<Promise<Response>, [string | URL, RequestInit?]>;

function makeJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseFormBody(init: RequestInit | undefined): URLSearchParams {
  const body = init?.body;
  // The refresh helpers pass a `URLSearchParams` to fetch; Node's
  // fetch passes the instance straight through into `init.body`
  // rather than serialising to a string.
  if (body instanceof URLSearchParams) return body;
  if (typeof body === "string") return new URLSearchParams(body);
  return new URLSearchParams("");
}

describe("refreshGoogleToken", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = jest.fn() as FetchMock;
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("hits the Google token endpoint with grant_type=refresh_token + primary creds", async () => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse(200, {
        access_token: "new-access-1",
        expires_in: 3600,
        token_type: "Bearer",
      }),
    );

    const result = await refreshGoogleToken("rt-primary", "primary");

    expect(result.accessToken).toBe("new-access-1");
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url.toString()).toBe("https://oauth2.googleapis.com/token");
    expect(init?.method).toBe("POST");
    const form = parseFormBody(init);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("rt-primary");
    expect(form.get("client_id")).toBe("primary-id");
    expect(form.get("client_secret")).toBe("primary-secret");
  });

  it("returns a rotated refresh_token when the response includes one", async () => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse(200, {
        access_token: "new-access-2",
        expires_in: 3600,
        refresh_token: "rt-rotated",
      }),
    );

    const result = await refreshGoogleToken("rt-old", "primary");
    expect(result.refreshToken).toBe("rt-rotated");
  });

  it("throws OAuthRefreshError on Google 401 with the error code", async () => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse(401, {
        error: "invalid_grant",
        error_description: "Token has been expired or revoked.",
      }),
    );

    let caught: unknown;
    try {
      await refreshGoogleToken("rt-revoked", "primary");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OAuthRefreshError);
    const e = caught as OAuthRefreshError;
    expect(e.status).toBe(401);
    expect(e.code).toBe("invalid_grant");
    expect(e.provider).toBe("google");
  });
});

describe("refreshGoogleToken — Gmail client", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = jest.fn() as FetchMock;
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("uses the Gmail client credentials when client=gmail", async () => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse(200, {
        access_token: "new-gmail-access",
        expires_in: 3600,
      }),
    );

    await refreshGoogleToken("rt-gmail", "gmail");

    const form = parseFormBody(fetchMock.mock.calls[0][1]);
    expect(form.get("client_id")).toBe("gmail-id");
    expect(form.get("client_secret")).toBe("gmail-secret");
  });
});

describe("refreshMicrosoftToken", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = jest.fn() as FetchMock;
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("hits the v2 token endpoint with the tenant id in the URL", async () => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse(200, {
        access_token: "ms-access-1",
        expires_in: 3600,
        refresh_token: "ms-rt-rotated",
        token_type: "Bearer",
      }),
    );

    const result = await refreshMicrosoftToken("ms-rt", [
      "openid",
      "Mail.Read",
    ]);

    expect(result.accessToken).toBe("ms-access-1");
    expect(result.refreshToken).toBe("ms-rt-rotated");

    const [url] = fetchMock.mock.calls[0];
    expect(url.toString()).toContain(
      "login.microsoftonline.com/common/oauth2/v2.0/token",
    );
  });

  it("ensures offline_access is included in the scope even when omitted by the caller", async () => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse(200, {
        access_token: "ms-access-x",
        expires_in: 3600,
      }),
    );

    await refreshMicrosoftToken("ms-rt", ["Mail.Read"]);

    const form = parseFormBody(fetchMock.mock.calls[0][1]);
    expect(form.get("scope")?.split(" ")).toEqual(
      expect.arrayContaining(["Mail.Read", "offline_access"]),
    );
  });

  it("preserves caller-provided offline_access without duplicating", async () => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse(200, {
        access_token: "ms-access-x",
        expires_in: 3600,
      }),
    );

    await refreshMicrosoftToken("ms-rt", [
      "openid",
      "offline_access",
      "Mail.Read",
    ]);

    const form = parseFormBody(fetchMock.mock.calls[0][1]);
    const scopes = form.get("scope")?.split(" ") ?? [];
    expect(scopes.filter((s) => s === "offline_access")).toHaveLength(1);
  });

  it("throws OAuthRefreshError on Microsoft AADSTS error", async () => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse(400, {
        error: "invalid_grant",
        error_description:
          "AADSTS70008: The refresh token has expired due to inactivity.",
      }),
    );

    let caught: unknown;
    try {
      await refreshMicrosoftToken("ms-rt-stale", ["Mail.Read"]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OAuthRefreshError);
    const e = caught as OAuthRefreshError;
    expect(e.provider).toBe("microsoft");
    expect(e.status).toBe(400);
    expect(e.code).toBe("invalid_grant");
    expect(e.message).toContain("AADSTS70008");
  });
});
