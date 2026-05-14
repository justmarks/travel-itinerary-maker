/**
 * Provider-agnostic OAuth refresh helpers. Given a refresh token,
 * exchanges it for a fresh access token + expiry against the
 * appropriate provider's token endpoint.
 *
 * Phase 4b-2: this layer powers `getActiveAccessToken` (in
 * `connections-token.ts`) which the resolver calls to mint per-
 * request tokens for Supabase-authed users from their `connections`
 * rows. Legacy users keep their existing `TokenStore` refresh path
 * (which mostly handles Gmail refresh today).
 *
 * Each provider has its own token endpoint, scope handling, and
 * error envelope. The functions below intentionally don't share a
 * generic OAuth client — the few extra lines of duplication buy
 * provider-specific error mapping and avoid an awkward abstraction.
 */

import { config } from "../config/env";

// Hard cap on every upstream OAuth round-trip. A slow / hung
// Google or Microsoft token endpoint would otherwise hold the
// Express worker indefinitely (and on cold start cascade into
// the entire request queue stalling). 10s is well above the
// real-world refresh latency (~300ms) but tight enough that a
// hung endpoint surfaces as `OAuthRefreshError` instead of a
// silently-piling request backlog.
const REFRESH_TIMEOUT_MS = 10_000;

export interface RefreshResult {
  accessToken: string;
  /**
   * UTC milliseconds at which the new access token expires. Callers
   * persist this back to the `connections` row so subsequent
   * lookups can return the cached token until just before expiry
   * rather than refreshing on every call.
   */
  expiresAt: Date;
  /**
   * Some providers rotate the refresh token on every refresh
   * (Microsoft does this for Azure AD when the new token is issued
   * with a different scope set; Google rotates infrequently).
   * Callers should persist the new refresh token alongside the
   * access token when present. Falls back to the input refresh
   * token if the response didn't include a new one.
   */
  refreshToken?: string;
}

export class OAuthRefreshError extends Error {
  constructor(
    public readonly provider: "google" | "microsoft",
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "OAuthRefreshError";
  }
}

/**
 * Refreshes a Google OAuth access token. The `client` argument
 * picks which OAuth client config to use — `primary` for sign-in /
 * Drive / Calendar; `gmail` for the separate Gmail-only client
 * (CASA isolation). Both call the same endpoint
 * (`https://oauth2.googleapis.com/token`) with different
 * credentials.
 */
export async function refreshGoogleToken(
  refreshToken: string,
  client: "primary" | "gmail",
): Promise<RefreshResult> {
  const creds =
    client === "primary"
      ? { id: config.google.clientId, secret: config.google.clientSecret }
      : { id: config.googleGmail.clientId, secret: config.googleGmail.clientSecret };
  if (!creds.id || !creds.secret) {
    throw new OAuthRefreshError(
      "google",
      0,
      "MISSING_CLIENT_CONFIG",
      `Google ${client} OAuth client is not configured`,
    );
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: creds.id,
    client_secret: creds.secret,
  });

  const res = await fetchWithTimeout(
    "https://oauth2.googleapis.com/token",
    "google",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );

  const text = await res.text();
  let parsed: {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new OAuthRefreshError(
      "google",
      res.status,
      "NON_JSON_RESPONSE",
      `Google returned non-JSON: ${text.slice(0, 200)}`,
    );
  }

  if (!res.ok || !parsed.access_token) {
    throw new OAuthRefreshError(
      "google",
      res.status,
      parsed.error,
      parsed.error_description ?? parsed.error ?? `Google refresh failed (${res.status})`,
    );
  }

  const expiresInSec = parsed.expires_in ?? 3600;
  return {
    accessToken: parsed.access_token,
    expiresAt: new Date(Date.now() + expiresInSec * 1000),
    refreshToken: parsed.refresh_token,
  };
}

/**
 * Refreshes a Microsoft OAuth access token against the v2 token
 * endpoint. Microsoft requires the original `scope` set to be
 * present on the refresh request — otherwise the returned token
 * may downgrade. Callers pass the scopes recorded on the
 * `connections` row at link time.
 */
export async function refreshMicrosoftToken(
  refreshToken: string,
  scopes: string[],
): Promise<RefreshResult> {
  const { clientId, clientSecret, tenantId } = config.microsoft;
  if (!clientId || !clientSecret) {
    throw new OAuthRefreshError(
      "microsoft",
      0,
      "MISSING_CLIENT_CONFIG",
      "Microsoft OAuth client is not configured",
    );
  }

  const params: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  };
  // Only include the `scope` param when we have meaningful resource
  // scopes to pass — empty or identity-only scope sets cause
  // Microsoft to reject the refresh with `invalid_scope`. Omitting
  // the param entirely tells Microsoft to use whatever scopes the
  // refresh_token was originally issued with (the OAuth 2 RFC 6749
  // default). This recovers gracefully when older connections rows
  // were written without scope info; the row's refresh_token still
  // carries the consent state.
  //
  // When we DO have resource scopes, ensure `offline_access` is in
  // the set — otherwise Microsoft returns a one-shot access token
  // with no rotated refresh token, and the next refresh would fail
  // with `invalid_grant`.
  const resourceScopes = scopes.filter(
    (s) =>
      s !== "openid" &&
      s !== "email" &&
      s !== "profile" &&
      s !== "offline_access",
  );
  if (resourceScopes.length > 0) {
    params.scope = scopes.includes("offline_access")
      ? scopes.join(" ")
      : [...scopes, "offline_access"].join(" ");
  }
  const body = new URLSearchParams(params);

  const url = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const res = await fetchWithTimeout(url, "microsoft", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const text = await res.text();
  let parsed: {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new OAuthRefreshError(
      "microsoft",
      res.status,
      "NON_JSON_RESPONSE",
      `Microsoft returned non-JSON: ${text.slice(0, 200)}`,
    );
  }

  if (!res.ok || !parsed.access_token) {
    throw new OAuthRefreshError(
      "microsoft",
      res.status,
      parsed.error,
      parsed.error_description ?? parsed.error ?? `Microsoft refresh failed (${res.status})`,
    );
  }

  const expiresInSec = parsed.expires_in ?? 3600;
  return {
    accessToken: parsed.access_token,
    expiresAt: new Date(Date.now() + expiresInSec * 1000),
    refreshToken: parsed.refresh_token,
  };
}

/**
 * `fetch` with a hard timeout that throws a typed `OAuthRefreshError`
 * (status 0, code TIMEOUT) when the upstream doesn't respond in time
 * — same error envelope callers already handle for "MISSING_CLIENT_
 * CONFIG", so existing branches (transient vs permanent) keep working.
 */
async function fetchWithTimeout(
  url: string,
  provider: "google" | "microsoft",
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new OAuthRefreshError(
        provider,
        0,
        "TIMEOUT",
        `${provider} token endpoint timed out after ${REFRESH_TIMEOUT_MS}ms`,
      );
    }
    throw err;
  }
}
