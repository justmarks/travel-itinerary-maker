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
 *   2. We stash a CSRF token + the post-login `returnTo` in a short-
 *      lived `SameSite=Lax; Secure` cookie (with a sessionStorage dual-
 *      write as a fallback for in-flight sign-ins from the previous
 *      deploy), encode `{ csrf, origin }` into the OAuth `state` param,
 *      and full-page-redirect to Google.
 *   3. Google bounces back to `/auth/callback?code=...&state=...`
 *   4. The callback page validates state.csrf against the cookie (or
 *      sessionStorage if the cookie is missing), calls our `login()`
 *      (which POSTs the code to the backend), and routes the user to
 *      `returnTo`.
 *
 * Why cookies and not sessionStorage alone: on Android, the OAuth round-
 * trip frequently crosses surfaces — e.g. sign-in starts in the installed
 * PWA, Google's consent screen opens in a Chrome Custom Tab, and the
 * redirect back lands in either the PWA or main Chrome. sessionStorage
 * is per-tab/per-process, so the CSRF written on the start surface is
 * invisible on the callback surface and every Android sign-in fails with
 * "state mismatch". Cookies share a jar across PWA + Chrome on Android
 * (and across tabs everywhere else), so the round-trip works regardless
 * of which surface the callback lands in. Desktop never crossed surfaces
 * in the first place — that's why this only manifested on mobile.
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
 * Scopes requested at first sign-in against the *primary* OAuth client.
 * Kept minimal so most users see the shortest possible Google consent
 * screen — Drive is the only Google API the app needs to function
 * (trips live in the user's Drive). Calendar is added on demand via
 * `requestAdditionalScopes` when the user opts into calendar sync.
 *
 * `gmail.readonly` is NOT in this list — Gmail uses a separate OAuth
 * client (see `startGmailLink`) so the primary client doesn't have to
 * carry the restricted scope and trigger Google's CASA assessment.
 */
export const INITIAL_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.file",
];

/**
 * Scopes requested when the user opts into email scanning. Granted by
 * the *Gmail* OAuth client (a separate Google Cloud Console project
 * client from the primary one), so the primary stays off the
 * restricted-scope path.
 */
export const GMAIL_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
];

/** Scope required to scan Gmail for travel confirmations. */
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

/** Scope required to push trip events to Google Calendar. */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

/**
 * Per-file Drive scope. The app's storage layer reads/writes trips into
 * a hidden app folder in the user's Drive; without this the user can
 * sign in but every owner-side trip operation fails. We request it as
 * part of the initial consent screen, but Google lets users untick
 * individual scopes — a user who unticks Drive lands "signed-in-but-
 * broken", which the dashboard detects via `hasScope(DRIVE_SCOPE)` and
 * recovers from by calling `requestAdditionalScopes([DRIVE_SCOPE], …)`.
 */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** Parses Google's space-separated `scope` response into an array. */
export function parseScopeString(scope: string | null | undefined): string[] {
  if (!scope) return [];
  return scope.split(/\s+/).filter(Boolean);
}

const CSRF_KEY = "oauth_csrf";
const RETURN_TO_KEY = "oauth_return_to";

/**
 * Cookies are scoped Path=/ so they're readable from `/login` (where the
 * sign-in starts) AND `/auth/callback` (where it ends). Path=/auth/callback
 * would be tighter, but the bytes don't matter and a uniform path makes
 * the clear-cookie call symmetric. Max-Age=600 (10 min) covers a slow
 * sign-in without leaving stale CSRF tokens around if the user abandons.
 */
const COOKIE_MAX_AGE_SECONDS = 10 * 60;

function setStateCookie(name: string, value: string): void {
  const isHttps = window.location.protocol === "https:";
  // `Secure` is required by browsers when SameSite=Lax cookies are set
  // from JS in many contexts; on http://localhost we have to skip it
  // (Secure cookies can't be set on insecure origins) so dev still works.
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
  ];
  if (isHttps) parts.push("Secure");
  document.cookie = parts.join("; ");
}

function readStateCookie(name: string): string | null {
  // Match `name=...` at the start of the cookie string OR after a `; `.
  // The value runs until the next `;` or end-of-string.
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${escaped}=([^;]*)`),
  );
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function clearStateCookie(name: string): void {
  // Path must match the one used at creation, otherwise the browser
  // treats it as a different cookie and the original survives.
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/**
 * Tags an OAuth round-trip with which client/flow it belongs to so the
 * callback knows which exchange endpoint to hit. Defaults to "primary"
 * when absent (so older state blobs in flight during a deploy don't
 * break the callback). "gmail" routes through the Gmail OAuth client.
 */
export type OAuthFlow = "primary" | "gmail";

interface OAuthState {
  csrf: string;
  origin: string;
  flow?: OAuthFlow;
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

interface BuildAuthUrlOptions {
  clientId: string;
  scopes: string[];
  returnTo: string;
  flow: OAuthFlow;
  /**
   * Whether to ask Google to extend the access token with previously
   * granted scopes. We set this for the *primary* client (so an
   * incremental Calendar grant doesn't drop the original Drive grant)
   * but NOT for the Gmail client — the Gmail flow stands alone, has no
   * prior grants on the same client, and `include_granted_scopes` only
   * unions within a single client anyway.
   */
  includeGrantedScopes: boolean;
}

function buildAuthUrl(opts: BuildAuthUrlOptions): string {
  const csrf = crypto.randomUUID();
  // Cookies are the source of truth (they cross the PWA / Chrome
  // Custom Tab boundary on Android — see the file-level comment).
  // sessionStorage is dual-written so any sign-in started against the
  // previous deploy still completes through this build's callback.
  setStateCookie(CSRF_KEY, csrf);
  setStateCookie(RETURN_TO_KEY, opts.returnTo);
  sessionStorage.setItem(CSRF_KEY, csrf);
  sessionStorage.setItem(RETURN_TO_KEY, opts.returnTo);

  const state = encodeState({
    csrf,
    origin: window.location.origin,
    flow: opts.flow,
  });

  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: getOAuthRedirectUri(),
    response_type: "code",
    scope: opts.scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  if (opts.includeGrantedScopes) {
    params.set("include_granted_scopes", "true");
  }

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

function getPrimaryClientId(): string {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set — cannot start sign-in.",
    );
  }
  return clientId;
}

function getGmailClientId(): string {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID_GMAIL;
  if (!clientId) {
    throw new Error(
      "NEXT_PUBLIC_GOOGLE_CLIENT_ID_GMAIL is not set — cannot link Gmail. Configure the Gmail OAuth client in Google Cloud Console and set this env var.",
    );
  }
  return clientId;
}

/**
 * Returns whether the Gmail OAuth client is configured for this build.
 * Lets the UI gate the "Connect Gmail" CTA on the env var being set,
 * so misconfigured deploys show a config error instead of throwing
 * inside the click handler. The check is build-time — `NEXT_PUBLIC_*`
 * env vars are inlined into the static bundle.
 */
export function isGmailLinkConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID_GMAIL;
}

export function startGoogleSignIn(returnTo: string): void {
  window.location.href = buildAuthUrl({
    clientId: getPrimaryClientId(),
    scopes: INITIAL_SCOPES,
    returnTo,
    flow: "primary",
    includeGrantedScopes: true,
  });
}

/**
 * Re-runs the OAuth redirect to add scopes to the user's *primary*
 * client grant. Used for Calendar — the user's already signed in with
 * Drive, then opts into Calendar sync, and we ask Google for the extra
 * scope on the same client.
 *
 * Pairs with `include_granted_scopes=true`: Google's consent screen
 * only prompts for the *new* scopes, and the resulting access token
 * covers everything the user has granted on this client. After the
 * callback, `login()` overwrites the stored auth state with the
 * cumulative scope set returned in the token response.
 *
 * **Do not pass `gmail.readonly`** — Gmail lives on a separate client.
 * Use `startGmailLink` for that.
 */
export function requestAdditionalScopes(
  additionalScopes: string[],
  returnTo: string,
): void {
  if (additionalScopes.includes(GMAIL_SCOPE)) {
    throw new Error(
      "gmail.readonly cannot be requested on the primary client — use startGmailLink instead.",
    );
  }
  const merged = Array.from(new Set([...INITIAL_SCOPES, ...additionalScopes]));
  window.location.href = buildAuthUrl({
    clientId: getPrimaryClientId(),
    scopes: merged,
    returnTo,
    flow: "primary",
    includeGrantedScopes: true,
  });
}

/**
 * Kicks off the *Gmail* OAuth dance — a separate consent screen against
 * a separate Google Cloud Console client that holds only the restricted
 * `gmail.readonly` scope. Splitting this off from the primary client is
 * what keeps the primary client off the CASA-required path.
 *
 * The user must already be signed in with the primary client before
 * calling this — the backend exchange endpoint requires primary auth
 * and verifies the Gmail consent returned the same Google account ID.
 */
export function startGmailLink(returnTo: string): void {
  window.location.href = buildAuthUrl({
    clientId: getGmailClientId(),
    scopes: GMAIL_SCOPES,
    returnTo,
    flow: "gmail",
    includeGrantedScopes: false,
  });
}

export interface ConsumedOAuthState {
  expectedCsrf: string | null;
  returnTo: string;
}

export function consumeOAuthState(): ConsumedOAuthState {
  // Cookie wins (it survives the PWA / Custom Tab handoff on Android);
  // sessionStorage is a fallback for any sign-in started against the
  // previous deploy that didn't write a cookie. Either source proves
  // the round-trip started in this browser, which is all CSRF needs.
  const expectedCsrf =
    readStateCookie(CSRF_KEY) ?? sessionStorage.getItem(CSRF_KEY);
  const returnTo =
    readStateCookie(RETURN_TO_KEY) ??
    sessionStorage.getItem(RETURN_TO_KEY) ??
    "/";
  clearStateCookie(CSRF_KEY);
  clearStateCookie(RETURN_TO_KEY);
  sessionStorage.removeItem(CSRF_KEY);
  sessionStorage.removeItem(RETURN_TO_KEY);
  return { expectedCsrf, returnTo };
}
