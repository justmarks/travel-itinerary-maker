import {
  fetchMicrosoftTokenScopes,
  MAIL_READ_SCOPE,
  CALENDARS_RW_SCOPE,
} from "../../src/services/microsoft-tokeninfo";

/**
 * Build a fake unsigned JWT with the given payload so we can exercise
 * the scope extraction without standing up an OIDC fixture. The
 * implementation under test deliberately doesn't verify the signature
 * — we trust that the token came from the Supabase OAuth round.
 */
function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (obj: unknown): string =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(payload)}.fake-signature`;
}

describe("fetchMicrosoftTokenScopes", () => {
  it("returns the space-split scp claim from a Microsoft v2 access token", () => {
    const token = makeJwt({
      scp: `openid email profile ${MAIL_READ_SCOPE}`,
      aud: "https://graph.microsoft.com",
    });
    expect(fetchMicrosoftTokenScopes(token)).toEqual([
      "openid",
      "email",
      "profile",
      MAIL_READ_SCOPE,
    ]);
  });

  it("recognises Calendars.ReadWrite for the calendar capability path", () => {
    const token = makeJwt({ scp: CALENDARS_RW_SCOPE });
    expect(fetchMicrosoftTokenScopes(token)).toEqual([CALENDARS_RW_SCOPE]);
  });

  it("returns null when the token has no scp claim", () => {
    const token = makeJwt({ aud: "https://graph.microsoft.com" });
    expect(fetchMicrosoftTokenScopes(token)).toBeNull();
  });

  it("returns null for MSA-shaped opaque tokens (not a JWT)", () => {
    // Personal Microsoft Accounts issue tokens like `M.R3_BAY.<opaque>`
    // that aren't JWTs — the route must fall through with a warn, not
    // reject every MSA Connect attempt.
    expect(fetchMicrosoftTokenScopes("M.R3_BAY.opaque-blob")).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(fetchMicrosoftTokenScopes("")).toBeNull();
    expect(fetchMicrosoftTokenScopes("not.a.jwt")).toBeNull();
  });
});
