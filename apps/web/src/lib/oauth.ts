/**
 * Manual Google OAuth redirect flow.
 *
 * We don't use `@react-oauth/google`'s popup auth-code flow because
 * Google Identity Services' `initCodeClient` doesn't honor
 * `prompt=consent` / `access_type=offline`. Without `prompt=consent`,
 * Google omits a refresh token on every sign-in *after* the first one,
 * which leaves returning users without a stored refresh token if their
 * original one is ever lost (Redis wipe, external revoke, etc.). Rolling
 * our own URL is the only way to set those params, so that's what we do.
 *
 * Flow (production / localhost):
 *   1. User clicks "Sign in" → `startGoogleSignIn(returnTo)`
 *   2. We stash a CSRF token + the post-login `returnTo` in
 *      sessionStorage, encode `{ csrf, origin }` into the OAuth `state`
 *      param, and full-page-redirect to Google.
 *   3. Google bounces back to `/auth/callback?code=...&state=...`
 *   4. The callback page validates state.csrf against sessionStorage,
 *      calls our `login()` (which POSTs the code to the backend), and
 *      routes the user to `returnTo`.
 *
 * Flow (Vercel preview deployments):
 *   Google won't accept per-deploy preview URLs as redirect URIs (no
 *   wildcards), so previews relay through production:
 *   1. Preview's `startGoogleSignIn` sets `redirect_uri` to PROD's
 *      `/auth/callback` (the only registered URI). The `state` carries
 *      the *preview's* origin so prod knows where to bounce back to.
 *   2. Google → PROD's `/auth/callback?code=...&state=...`.
 *   3. Prod's callback sees `state.origin !== window.location.origin`,
 *      validates the origin against `NEXT_PUBLIC_PREVIEW_ORIGIN_PATTERN`,
 *      and 302s to `<preview-origin>/auth/callback?code=...&state=...`.
 *   4. Preview's callback runs the normal flow, sending the *prod*
 *      redirect URI to the backend (it must match what Google saw).
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

/**
 * Scopes requested at first sign-in. Kept minimal so most users see the
 * shortest possible Google consent screen — Drive is the only Google API
 * the app needs to function (trips live in the user's Drive). Gmail and
 * Calendar are added on demand via `requestAdditionalScopes` when the
 * user opts into a feature that needs them.
 */
export const INITIAL_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.file",
];

/** Scope required to scan Gmail for travel confirmations. */
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

/** Scope required to push trip events to Google Calendar. */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

/** Parses Google's space-separated `scope` response into an array. */
export function parseScopeString(scope: string | null | undefined): string[] {
  if (!scope) return [];
  return scope.split(/\s+/).filter(Boolean);
}

const CSRF_KEY = "oauth_csrf";
const RETURN_TO_KEY = "oauth_return_to";

interface OAuthState {
  csrf: string;
  origin: string;
}

function encodeState(state: OAuthState): string {
  const json = JSON.stringify(state);
  // base64url — URL-safe, no padding, fine for OAuth `state`.
  const b64 = btoa(json);
  return b64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function decodeState(raw: string): OAuthState | null {
  try {
    const b64 = raw.replaceAll("-", "+").replaceAll("_", "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = atob(padded);
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "csrf" in parsed &&
      "origin" in parsed &&
      typeof (parsed as Record<string, unknown>).csrf === "string" &&
      typeof (parsed as Record<string, unknown>).origin === "string"
    ) {
      return parsed as OAuthState;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Strips trailing slashes from an origin URL. The Vercel "Add Env
 * Variable" UI is happy to accept `https://example.com/` (with slash)
 * and `window.location.origin` never has one — without normalization,
 * the equality check below would treat prod-as-itself as "I'm not the
 * intended target, relay" (infinite bounce), and `${prodOrigin}/auth/callback`
 * would render with a double slash that Google rejects with
 * `redirect_uri_mismatch`. Cheap, defensive, and removes a footgun.
 */
function normalizeOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/\/+$/, "");
}

/**
 * Returns the redirect URI to send to Google for *this* sign-in.
 * On Vercel previews, this points at production's callback (the only
 * URI registered with Google). Locally and in production, it's just
 * `<self>/auth/callback`.
 */
export function getOAuthRedirectUri(): string {
  const prodOrigin = normalizeOrigin(process.env.NEXT_PUBLIC_PROD_ORIGIN);
  const currentOrigin = window.location.origin;
  const isLocalhost =
    currentOrigin.startsWith("http://localhost") ||
    currentOrigin.startsWith("http://127.0.0.1");
  if (isLocalhost || !prodOrigin || currentOrigin === prodOrigin) {
    return `${currentOrigin}/auth/callback`;
  }
  return `${prodOrigin}/auth/callback`;
}

/**
 * Validates that an origin from a relay request looks like one of our
 * own preview deployments. Drives the "where should I bounce back to"
 * decision on production's callback page — keeps it from becoming an
 * open redirect that leaks OAuth codes.
 *
 * Mirrors the server's `CORS_ORIGIN_PATTERN`: a string regex (anchored
 * to `^...$` by the caller) that matches the full origin URL.
 */
export function isAllowlistedRelayOrigin(origin: string): boolean {
  const prodOrigin = normalizeOrigin(process.env.NEXT_PUBLIC_PROD_ORIGIN);
  if (prodOrigin && origin === prodOrigin) return true;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (parsed.pathname !== "/" && parsed.pathname !== "") return false;
  if (parsed.search !== "" || parsed.hash !== "") return false;

  const pattern = process.env.NEXT_PUBLIC_PREVIEW_ORIGIN_PATTERN;
  if (!pattern) return false;
  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    return false;
  }
  return regex.test(origin);
}

function buildAuthUrl(scopes: string[], returnTo: string): string {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set — cannot start sign-in.",
    );
  }
  const csrf = crypto.randomUUID();
  sessionStorage.setItem(CSRF_KEY, csrf);
  sessionStorage.setItem(RETURN_TO_KEY, returnTo);

  const state = encodeState({ csrf, origin: window.location.origin });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getOAuthRedirectUri(),
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export function startGoogleSignIn(returnTo: string): void {
  window.location.href = buildAuthUrl(INITIAL_SCOPES, returnTo);
}

/**
 * Re-runs the OAuth redirect to add scopes to an already-signed-in user.
 *
 * Pairs with `include_granted_scopes=true`: Google's consent screen only
 * prompts for the *new* scopes, and the resulting access token covers
 * everything the user has granted across all flows. After the callback,
 * `login()` overwrites the stored auth state with the cumulative scope
 * set returned in the token response.
 *
 * Pass the additional scopes (e.g. `[GMAIL_SCOPE]`) — the initial set is
 * always included so we don't accidentally drop them.
 */
export function requestAdditionalScopes(
  additionalScopes: string[],
  returnTo: string,
): void {
  const merged = Array.from(new Set([...INITIAL_SCOPES, ...additionalScopes]));
  window.location.href = buildAuthUrl(merged, returnTo);
}

export interface ConsumedOAuthState {
  expectedCsrf: string | null;
  returnTo: string;
}

export function consumeOAuthState(): ConsumedOAuthState {
  const expectedCsrf = sessionStorage.getItem(CSRF_KEY);
  const returnTo = sessionStorage.getItem(RETURN_TO_KEY) ?? "/";
  sessionStorage.removeItem(CSRF_KEY);
  sessionStorage.removeItem(RETURN_TO_KEY);
  return { expectedCsrf, returnTo };
}
