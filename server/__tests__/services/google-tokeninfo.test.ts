import {
  fetchGoogleTokenScopes,
  GMAIL_READ_SCOPE,
} from "../../src/services/google-tokeninfo";

describe("fetchGoogleTokenScopes", () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns the space-split scope list on 200", async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          scope: `openid email profile ${GMAIL_READ_SCOPE}`,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const scopes = await fetchGoogleTokenScopes("ya29.test_token");

    expect(scopes).toEqual([
      "openid",
      "email",
      "profile",
      GMAIL_READ_SCOPE,
    ]);
    // Tokeninfo URL is built with the access token as a query param.
    const url = fetchSpy.mock.calls[0][0] as string;
    expect(url).toMatch(/^https:\/\/oauth2\.googleapis\.com\/tokeninfo\?/);
    expect(url).toContain("access_token=ya29.test_token");
  });

  it("returns null on non-2xx (e.g. revoked / invalid token)", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_token" }), {
        status: 400,
      }),
    );
    expect(await fetchGoogleTokenScopes("bad")).toBeNull();
  });

  it("returns null when the response body has no scope field", async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ aud: "client-id" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(await fetchGoogleTokenScopes("ya29.token")).toBeNull();
  });

  it("returns null on network error (caller treats null as 'unverified')", async () => {
    fetchSpy.mockRejectedValue(new Error("network down"));
    expect(await fetchGoogleTokenScopes("ya29.token")).toBeNull();
  });
});
