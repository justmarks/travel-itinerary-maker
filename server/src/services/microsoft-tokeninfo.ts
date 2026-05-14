/**
 * Reads the granted scopes off a Microsoft v2 access token.
 *
 * Mirrors `google-tokeninfo.ts` so the connections POST route can
 * pre-flight a Microsoft Connect attempt and reject the write when
 * the user un-checked Mail.Read / Calendars.ReadWrite on Microsoft's
 * consent screen — same UX as the Gmail path, instead of letting
 * the stale row sit until the first Graph 401.
 *
 * Microsoft v2 work/school access tokens are JWTs with the granted
 * scopes in the `scp` claim (space-separated string, per
 * https://learn.microsoft.com/en-us/azure/active-directory/develop/
 * access-tokens#payload-claims). We deliberately do NOT verify the
 * signature — we trust that the token came from the Supabase OAuth
 * round we just completed; we only need to read its declared scope.
 *
 * Personal Microsoft Accounts (MSA) issue tokens like `M.R3_BAY.<opaque>`
 * that aren't JWTs — those return `null` ("could not validate") so
 * the caller falls back to permitting the write the same way Google's
 * tokeninfo-unreachable path does.
 */

export const MAIL_READ_SCOPE = "Mail.Read";
export const CALENDARS_RW_SCOPE = "Calendars.ReadWrite";

export function fetchMicrosoftTokenScopes(accessToken: string): string[] | null {
  if (!accessToken) return null;
  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = decodeJwtPayload(parts[1]);
    const scp = (payload as { scp?: unknown }).scp;
    if (typeof scp !== "string") return null;
    return scp.split(/\s+/).filter(Boolean);
  } catch {
    return null;
  }
}

function decodeJwtPayload(segment: string): unknown {
  // JWT segments are base64url; pad before Buffer.from interprets them.
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padding = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const json = Buffer.from(padded + padding, "base64").toString("utf-8");
  return JSON.parse(json) as unknown;
}
