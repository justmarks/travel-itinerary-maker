import {
  redactShareTokens,
  scrubSensitiveHeaders,
} from "../../src/services/sentry-scrub";

describe("redactShareTokens", () => {
  it("redacts a desktop share-link token", () => {
    expect(redactShareTokens("/shared/abc123")).toBe("/shared/[REDACTED]");
  });

  it("redacts a mobile share-link token", () => {
    expect(redactShareTokens("/m/shared/abc123")).toBe("/m/shared/[REDACTED]");
  });

  it("redacts in the middle of a longer URL", () => {
    expect(
      redactShareTokens("https://itinly.app/shared/xY9-_abc?ref=cal"),
    ).toBe("https://itinly.app/shared/[REDACTED]?ref=cal");
  });

  it("redacts both desktop and mobile tokens in one string", () => {
    const input =
      "GET /shared/AAA failed; redirect to /m/shared/BBB also failed";
    expect(redactShareTokens(input)).toBe(
      "GET /shared/[REDACTED] failed; redirect to /m/shared/[REDACTED] also failed",
    );
  });

  it("redacts tokens that contain hyphens or underscores (base64url alphabet)", () => {
    expect(redactShareTokens("/shared/aB-_cD12-34")).toBe(
      "/shared/[REDACTED]",
    );
  });

  it("does not match unrelated paths", () => {
    expect(redactShareTokens("/shared")).toBe("/shared");
    expect(redactShareTokens("/m/shared")).toBe("/m/shared");
    expect(redactShareTokens("/share/abc123")).toBe("/share/abc123");
  });

  it("preserves query strings and fragments after the token", () => {
    expect(
      redactShareTokens("/shared/abc123?utm=email#segments"),
    ).toBe("/shared/[REDACTED]?utm=email#segments");
  });
});

describe("scrubSensitiveHeaders", () => {
  it("redacts a lowercase Authorization header value", () => {
    const event = {
      request: { headers: { authorization: "Bearer ya29.secret-access-token" } },
    };
    scrubSensitiveHeaders(event);
    expect(event.request.headers.authorization).toBe("[REDACTED]");
  });

  it("redacts case-variant Authorization (HTTP headers are case-insensitive)", () => {
    const event = {
      request: { headers: { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.x.y" } },
    };
    scrubSensitiveHeaders(event);
    expect(event.request.headers.Authorization).toBe("[REDACTED]");
  });

  it("redacts Cookie + X-Api-Key + Proxy-Authorization", () => {
    const event = {
      request: {
        headers: {
          Cookie: "session=abc; oauth_csrf=def",
          "x-api-key": "sk_live_secret",
          "Proxy-Authorization": "Basic dXNlcjpwYXNz",
        },
      },
    };
    scrubSensitiveHeaders(event);
    expect(event.request.headers.Cookie).toBe("[REDACTED]");
    expect(event.request.headers["x-api-key"]).toBe("[REDACTED]");
    expect(event.request.headers["Proxy-Authorization"]).toBe("[REDACTED]");
  });

  it("leaves non-sensitive headers alone", () => {
    const event = {
      request: {
        headers: {
          Authorization: "Bearer secret",
          "User-Agent": "Mozilla/5.0",
          "X-Request-Id": "req-123",
        },
      },
    };
    scrubSensitiveHeaders(event);
    expect(event.request.headers.Authorization).toBe("[REDACTED]");
    expect(event.request.headers["User-Agent"]).toBe("Mozilla/5.0");
    expect(event.request.headers["X-Request-Id"]).toBe("req-123");
  });

  it("is a no-op when there are no headers on the event", () => {
    const event = { request: { url: "https://example.com/foo" } };
    expect(() => scrubSensitiveHeaders(event)).not.toThrow();
  });

  it("returns the same event reference (mutates in place)", () => {
    const event = {
      request: { headers: { Authorization: "Bearer x" } },
    };
    expect(scrubSensitiveHeaders(event)).toBe(event);
  });
});
