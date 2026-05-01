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

const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar",
].join(" ");

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
 * Returns the redirect URI to send to Google for *this* sign-in.
 * On Vercel previews, this points at production's callback (the only
 * URI registered with Google). Locally and in production, it's just
 * `<self>/auth/callback`.
 */
export function getOAuthRedirectUri(): string {
  const prodOrigin = process.env.NEXT_PUBLIC_PROD_ORIGIN;
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
  const prodOrigin = process.env.NEXT_PUBLIC_PROD_ORIGIN;
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

export function startGoogleSignIn(returnTo: string): void {
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
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });

  window.location.href = `${GOOGLE_AUTH_URL}?${params.toString()}`;
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
