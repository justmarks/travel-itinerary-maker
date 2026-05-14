/**
 * Probes whether a Microsoft access token actually carries the
 * permission required for a capability. Replaces the previous
 * JWT-payload-parsing approach: Microsoft explicitly documents
 * Graph access tokens as opaque and reserves the right to change
 * their format
 * (https://learn.microsoft.com/en-us/azure/active-directory/develop/
 *  access-tokens#validate-tokens — "do not write code that depends
 *  on the contents of a token"), so we instead ask Graph
 * authoritatively: make a read call that requires the scope we care
 * about and watch what status comes back.
 *
 *   - email    → GET /me/mailFolders?$top=1  (requires Mail.Read)
 *   - calendar → GET /me/calendars?$top=1    (requires Calendars.Read
 *                                              or .ReadWrite)
 *
 * Note on calendar: this can't distinguish Calendars.Read from
 * Calendars.ReadWrite — both let `/me/calendars` succeed. In practice
 * the Connect flow requests Calendars.ReadWrite so a successful
 * grant lights both up; a user who downgraded just the calendar
 * scope on the consent screen still passes the probe but would 401
 * on the first write. That matches the Google branch's
 * "tokeninfo confirmed Gmail.readonly, route still backstops with a
 * 401" failure mode.
 *
 * Returns:
 *   - "granted" → 2xx response, scope is present
 *   - "denied"  → 403 from Graph (scope not granted)
 *   - "unknown" → 401, 5xx, timeout, network error, non-JSON. The
 *                 route falls through to the client-supplied scope
 *                 list with a warn, matching the Google
 *                 "tokeninfo unreachable" behaviour. Downstream Graph
 *                 401s on actual use backstop the access check.
 */

import type { ConnectionCapability } from "./connections-store";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";
const PROBE_TIMEOUT_MS = 5000;

export type ProbeResult = "granted" | "denied" | "unknown";

export const MAIL_READ_SCOPE = "Mail.Read";
export const CALENDARS_RW_SCOPE = "Calendars.ReadWrite";

export async function probeMicrosoftScope(
  accessToken: string,
  capability: Extract<ConnectionCapability, "email" | "calendar">,
): Promise<ProbeResult> {
  if (!accessToken) return "unknown";
  const path = capability === "email" ? "/me/mailFolders?$top=1" : "/me/calendars?$top=1";
  try {
    const res = await fetch(`${GRAPH_BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (res.ok) return "granted";
    if (res.status === 403) return "denied";
    // 401 → token format-rejected or expired (not a scope problem
    // we can act on here; treat as unknown so the existing
    // re-link UX kicks in downstream). 5xx → transient Graph
    // outage; same. Anything else → don't make a confident call.
    return "unknown";
  } catch {
    // Network error, AbortSignal timeout, DNS, etc.
    return "unknown";
  }
}
