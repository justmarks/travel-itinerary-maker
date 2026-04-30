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
 * Flow:
 *   1. User clicks "Sign in" → `startGoogleSignIn(returnTo)`
 *   2. We stash a CSRF state and the post-login `returnTo` in
 *      sessionStorage, then full-page-redirect to Google.
 *   3. Google bounces back to `/auth/callback?code=...&state=...`
 *   4. The callback page validates state, calls our `login()` (which
 *      POSTs the code to the backend), and routes the user to `returnTo`.
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

const STATE_KEY = "oauth_state";
const RETURN_TO_KEY = "oauth_return_to";

export function getRedirectUri(): string {
  return `${window.location.origin}/auth/callback`;
}

export function startGoogleSignIn(returnTo: string): void {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set — cannot start sign-in.",
    );
  }
  const state = crypto.randomUUID();
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(RETURN_TO_KEY, returnTo);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
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
  expectedState: string | null;
  returnTo: string;
}

export function consumeOAuthState(): ConsumedOAuthState {
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const returnTo = sessionStorage.getItem(RETURN_TO_KEY) ?? "/";
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(RETURN_TO_KEY);
  return { expectedState, returnTo };
}
