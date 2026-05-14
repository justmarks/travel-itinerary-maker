/**
 * Validates the Supabase JWT helper against keys generated in-test —
 * no network, no live JWKS. The remote-JWKS path is exercised by the
 * production code; here we use `createLocalJWKSet` so we can sign
 * tokens with a known key and assert the validator handles signed,
 * expired, mis-issued, mis-audienced, and tampered tokens correctly.
 */
import {
  exportJWK,
  generateKeyPair,
  SignJWT,
  createLocalJWKSet,
  type JWK,
  type KeyLike,
} from "jose";
import {
  createSupabaseAuthFromJwks,
  looksLikeJwt,
  type SupabaseJwtValidator,
} from "../../src/services/supabase-auth";

const ISSUER = "https://test.supabase.co/auth/v1";
const AUDIENCE = "authenticated";

interface KeyMaterial {
  privateKey: KeyLike;
  jwk: JWK & { kid: string };
}

async function makeKey(kid = "test-key-1"): Promise<KeyMaterial> {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const publicJwk = await exportJWK(publicKey);
  return {
    privateKey,
    jwk: { ...publicJwk, kid, alg: "ES256", use: "sig" },
  };
}

async function makeValidator(jwk: JWK): Promise<SupabaseJwtValidator> {
  const jwks = createLocalJWKSet({ keys: [jwk] });
  return createSupabaseAuthFromJwks({
    jwks: jwks as unknown as ReturnType<
      typeof import("jose").createRemoteJWKSet
    >,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

async function signToken(
  privateKey: KeyLike,
  kid: string,
  claims: Record<string, unknown>,
  opts: { iss?: string; aud?: string; exp?: number; iat?: number } = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const builder = new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "ES256", kid })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? AUDIENCE)
    .setIssuedAt(opts.iat ?? now)
    .setExpirationTime(opts.exp ?? now + 60);
  return builder.sign(privateKey);
}

describe("Supabase JWT validator", () => {
  describe("happy path", () => {
    it("accepts a valid signed token and returns sub / email / provider", async () => {
      const key = await makeKey();
      const validator = await makeValidator(key.jwk);
      const token = await signToken(key.privateKey, key.jwk.kid, {
        sub: "user-uuid-1",
        email: "alice@example.com",
        app_metadata: { provider: "google" },
      });

      const claims = await validator(token);
      expect(claims).toEqual({
        sub: "user-uuid-1",
        email: "alice@example.com",
        provider: "google",
      });
    });

    it("treats missing email as undefined (not all providers supply it)", async () => {
      const key = await makeKey();
      const validator = await makeValidator(key.jwk);
      const token = await signToken(key.privateKey, key.jwk.kid, {
        sub: "user-uuid-1",
      });

      const claims = await validator(token);
      expect(claims).toEqual({
        sub: "user-uuid-1",
        email: undefined,
        provider: undefined,
      });
    });

    it("ignores malformed app_metadata rather than throwing", async () => {
      const key = await makeKey();
      const validator = await makeValidator(key.jwk);
      const token = await signToken(key.privateKey, key.jwk.kid, {
        sub: "user-uuid-1",
        app_metadata: "not-an-object",
      });

      const claims = await validator(token);
      expect(claims.provider).toBeUndefined();
    });
  });

  describe("rejections", () => {
    it("rejects an expired token", async () => {
      const key = await makeKey();
      const validator = await makeValidator(key.jwk);
      const now = Math.floor(Date.now() / 1000);
      const token = await signToken(
        key.privateKey,
        key.jwk.kid,
        { sub: "user-uuid-1" },
        { iat: now - 7200, exp: now - 3600 },
      );

      await expect(validator(token)).rejects.toThrow();
    });

    it("rejects a token with a wrong issuer", async () => {
      const key = await makeKey();
      const validator = await makeValidator(key.jwk);
      const token = await signToken(
        key.privateKey,
        key.jwk.kid,
        { sub: "user-uuid-1" },
        { iss: "https://other.supabase.co/auth/v1" },
      );

      await expect(validator(token)).rejects.toThrow();
    });

    it("rejects a token with a wrong audience", async () => {
      const key = await makeKey();
      const validator = await makeValidator(key.jwk);
      const token = await signToken(
        key.privateKey,
        key.jwk.kid,
        { sub: "user-uuid-1" },
        { aud: "service_role" },
      );

      await expect(validator(token)).rejects.toThrow();
    });

    it("rejects a token signed with a different key", async () => {
      const trustedKey = await makeKey("trusted-key");
      const validator = await makeValidator(trustedKey.jwk);
      const attackerKey = await makeKey("attacker-key");
      // Use trusted-key's kid in the header to confuse the validator;
      // the signature still won't match.
      const token = await signToken(
        attackerKey.privateKey,
        "trusted-key",
        { sub: "user-uuid-1" },
      );

      await expect(validator(token)).rejects.toThrow();
    });

    it("rejects garbage / non-JWT input", async () => {
      const key = await makeKey();
      const validator = await makeValidator(key.jwk);
      await expect(validator("not-a-jwt")).rejects.toThrow();
      await expect(validator("a.b.c")).rejects.toThrow();
    });

    it("rejects a token with no `sub` claim", async () => {
      const key = await makeKey();
      const validator = await makeValidator(key.jwk);
      const token = await signToken(key.privateKey, key.jwk.kid, {
        email: "alice@example.com",
      });

      await expect(validator(token)).rejects.toThrow(/sub/);
    });
  });
});

describe("looksLikeJwt", () => {
  it("returns true for shape `a.b.c` with base64url segments", () => {
    expect(
      looksLikeJwt(
        "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.signature-base64url-here",
      ),
    ).toBe(true);
  });

  it("returns false for Google-style opaque tokens", () => {
    // `ya29.*` is the standard Google access token prefix.
    expect(looksLikeJwt("ya29.A0AfH6SMAAAAA")).toBe(false);
  });

  it("returns false for tokens missing segments", () => {
    expect(looksLikeJwt("a.b")).toBe(false);
    expect(looksLikeJwt("solo")).toBe(false);
    expect(looksLikeJwt("a.b.c.d")).toBe(false);
  });

  it("returns false for tokens with non-base64url characters", () => {
    expect(looksLikeJwt("a.b.c$d")).toBe(false);
    expect(looksLikeJwt("a.b/c.d")).toBe(false);
  });
});
