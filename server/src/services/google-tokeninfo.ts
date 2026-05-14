/**
 * Thin wrapper around Google's `tokeninfo` endpoint — used to figure
 * out the *actually-granted* OAuth scopes for an access token, as
 * opposed to the *requested* scopes the client claimed it asked for.
 *
 * Lives here because the Supabase Connect-Gmail flow (auth-callback
 * page → `POST /api/v1/connections`) has no access to the Google
 * `oauth2Client` instance the legacy `/auth/google/gmail` route uses
 * with `fetchTokenScopes`. A raw HTTP fetch is enough.
 *
 * Returns `null` on any failure (network, non-200, missing/empty
 * `scope` field). Callers must treat `null` as "could not validate"
 * and fall back to whatever degraded-but-safe behaviour they have,
 * NOT as "no scopes granted" — the difference matters for the
 * connections route's reject-or-allow decision.
 */

const TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";

export const GMAIL_READ_SCOPE =
  "https://www.googleapis.com/auth/gmail.readonly";

export async function fetchGoogleTokenScopes(
  accessToken: string,
): Promise<string[] | null> {
  try {
    const url = new URL(TOKENINFO_URL);
    url.searchParams.set("access_token", accessToken);
    // 5s timeout — tokeninfo is on the hot Connect-Gmail path and a
    // slow Google response would otherwise stall the route handler.
    // The caller treats `null` as "could not validate" and proceeds
    // with the client-supplied scopes, so a timeout degrades to the
    // same fallback as a 5xx.
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { scope?: unknown };
    if (typeof data.scope !== "string") return null;
    const scopes = data.scope.split(/\s+/).filter(Boolean);
    return scopes;
  } catch {
    return null;
  }
}
