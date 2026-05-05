import { redactShareTokens } from "../../src/services/sentry-scrub";

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
