/**
 * Supabase JWT validation. Phase 3 of the Drive→Supabase migration.
 *
 * Supabase Auth issues JWTs signed with the project's signing key
 * (asymmetric by default on projects created after late 2024; HS256
 * on older projects). The signing key is exposed via a JWKS endpoint
 * at `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`, and `jose`'s
 * `createRemoteJWKSet` caches it locally so per-request validation
 * doesn't round-trip to Supabase.
 *
 * Coexistence: the new `requireAuth` middleware tries this validator
 * first and falls back to the legacy Google access-token path (which
 * calls Google's userinfo endpoint) when the token isn't a Supabase
 * JWT. That lets old clients keep working until phase 5 migrates
 * them.
 *
 * The validator returns the minimum set of claims the rest of the
 * app cares about — `sub` (Supabase user UUID) and `email` (verified
 * email when the provider supplied one). Everything else on the JWT
 * (provider, role, app_metadata) stays opaque to the server; if a
 * route needs it later, add it here.
 */

import { jwtVerify, createRemoteJWKSet, type JWTPayload } from "jose";

export interface SupabaseClaims {
  /** Supabase user UUID. Becomes `req.userId` on authed requests. */
  sub: string;
  /** Verified email at the originating provider, when present. */
  email?: string;
  /** Which OAuth provider issued the token (e.g. "google", "azure"). */
  provider?: string;
}

export interface SupabaseAuthOptions {
  /**
   * Project URL. Used to derive the JWKS endpoint. Example:
   * `https://abc123xyz.supabase.co`.
   */
  supabaseUrl: string;
  /**
   * Expected `iss` claim. Defaults to `<supabaseUrl>/auth/v1`.
   * Supabase uses this exact form regardless of project age.
   */
  issuer?: string;
  /**
   * Expected `aud` claim. Supabase issues `aud=authenticated` for
   * signed-in user tokens; override only for testing.
   */
  audience?: string;
}

/**
 * Returned by `createSupabaseAuth`. Single validator function that
 * checks signature, issuer, audience, and expiry, then returns the
 * claims the app uses.
 */
export type SupabaseJwtValidator = (token: string) => Promise<SupabaseClaims>;

export function createSupabaseAuth(
  options: SupabaseAuthOptions,
): SupabaseJwtValidator {
  const { supabaseUrl, issuer, audience = "authenticated" } = options;
  if (!supabaseUrl) {
    throw new Error("createSupabaseAuth: supabaseUrl is required");
  }

  // Trailing slash on the URL would double up in the JWKS path.
  const baseUrl = supabaseUrl.replace(/\/+$/, "");
  const jwksUrl = `${baseUrl}/auth/v1/.well-known/jwks.json`;
  const expectedIssuer = issuer ?? `${baseUrl}/auth/v1`;

  // Caches the JWKS in-process; `jose` re-fetches on key-id miss
  // (which is what happens after a Supabase key rotation).
  const jwks = createRemoteJWKSet(new URL(jwksUrl));

  return async function validate(token: string): Promise<SupabaseClaims> {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: expectedIssuer,
      audience,
    });
    return extractClaims(payload);
  };
}

/**
 * Test seam: validate against an in-memory JWKS instead of a remote
 * fetch. Tests construct a key, sign a token, pass the JWK Set here.
 */
export function createSupabaseAuthFromJwks(opts: {
  jwks: ReturnType<typeof createRemoteJWKSet>;
  issuer: string;
  audience?: string;
}): SupabaseJwtValidator {
  const { jwks, issuer, audience = "authenticated" } = opts;
  return async function validate(token: string): Promise<SupabaseClaims> {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience,
    });
    return extractClaims(payload);
  };
}

function extractClaims(payload: JWTPayload): SupabaseClaims {
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("Supabase JWT missing `sub` claim");
  }
  const email = typeof payload.email === "string" ? payload.email : undefined;
  // Supabase stores the originating provider in `app_metadata.provider`.
  // Defensive against malformed app_metadata.
  const appMetadata = (payload as { app_metadata?: unknown }).app_metadata;
  let provider: string | undefined;
  if (appMetadata && typeof appMetadata === "object") {
    const candidate = (appMetadata as { provider?: unknown }).provider;
    if (typeof candidate === "string") provider = candidate;
  }
  return { sub: payload.sub, email, provider };
}

/**
 * Cheap sniff: "is this token shaped like a Supabase JWT (versus the
 * opaque Google access token the legacy path expects)?" Used by
 * `requireAuth` to pick which validator to run before paying the cost
 * of a full JWT-verify failure.
 *
 * Detection: real JWTs have exactly two dots and base64url-encoded
 * segments. Google's `ya29.*` access tokens have one dot and a totally
 * different prefix. This is fast and good enough for routing — actual
 * validity is decided by `jwtVerify` downstream.
 */
export function looksLikeJwt(token: string): boolean {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  // Each part must be non-empty base64url.
  return parts.every((p) => p.length > 0 && /^[A-Za-z0-9_-]+$/.test(p));
}
