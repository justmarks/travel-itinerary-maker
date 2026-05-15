/**
 * Verbose per-step logging gated behind environment variables so
 * production Railway logs stay quiet by default. Set the matching
 * env var to "1" when actively diagnosing a specific subsystem:
 *
 *   DEBUG_EMAIL_SCAN=1   — Gmail/Outlook fetch, parse, dedup, apply
 *   DEBUG_CONNECTIONS=1  — `/api/v1/connections` upsert / refresh-
 *                          token preservation tracing
 *   DEBUG_CALENDAR=1     — calendar-list 403 scope-introspection
 *                          (hits Google's tokeninfo endpoint with
 *                          the user's access token to dump what
 *                          scopes the token actually carries)
 *   DEBUG_TIMEZONES=1    — verbose "Resolved <city> → <tz>" lines.
 *                          City strings are user-controlled (may
 *                          contain PII) so the echo is off by
 *                          default; flip on when investigating
 *                          why a specific trip's segment-card
 *                          times look wrong on calendar export.
 *   DEBUG_AUTH=1         — auth middleware coexistence trace. Every
 *                          request whose Supabase JWT validator
 *                          rejects (legitimately, because the token
 *                          is an old Google access token or just a
 *                          stale JWT awaiting client refresh) is
 *                          logged here. Routine in steady state; only
 *                          interesting when triaging "why am I
 *                          getting 401s after sign-in?" reports.
 *
 * `console.warn` / `console.error` calls are deliberately NOT gated
 * by these knobs — those flag real anomalies and should always
 * surface in Railway logs (e.g. "dropping Google-shaped token from
 * a Microsoft row," "Graph rejected the token").
 */
const DEBUG_EMAIL_SCAN = process.env.DEBUG_EMAIL_SCAN === "1";
const DEBUG_CONNECTIONS = process.env.DEBUG_CONNECTIONS === "1";
const DEBUG_CALENDAR = process.env.DEBUG_CALENDAR === "1";
const DEBUG_TIMEZONES = process.env.DEBUG_TIMEZONES === "1";
const DEBUG_AUTH = process.env.DEBUG_AUTH === "1";

export function debugEmailScan(...args: unknown[]): void {
  if (DEBUG_EMAIL_SCAN) {
    console.log(...args);
  }
}

export function debugConnections(...args: unknown[]): void {
  if (DEBUG_CONNECTIONS) {
    console.log(...args);
  }
}

export function debugCalendar(...args: unknown[]): void {
  if (DEBUG_CALENDAR) {
    console.log(...args);
  }
}

export function debugAuth(...args: unknown[]): void {
  if (DEBUG_AUTH) {
    console.log(...args);
  }
}

/**
 * Returns true when DEBUG_CALENDAR is set. Used by the calendar
 * route to gate the `diagnoseScopes` HTTP probe — we don't want
 * to send the user's access token to Google's tokeninfo endpoint
 * on every 403 in prod, only when ops actively asked for the
 * diagnostic.
 */
export function isCalendarDebugEnabled(): boolean {
  return DEBUG_CALENDAR;
}

/**
 * Returns true when DEBUG_CONNECTIONS is set. Used by the
 * `/api/v1/connections` POST route to gate the extra `findByKey`
 * lookup that powers the "did this upsert preserve/overwrite the
 * refresh token?" diagnostic — skipping that DB round-trip in
 * production keeps the hot path lean.
 */
export function isConnectionsDebugEnabled(): boolean {
  return DEBUG_CONNECTIONS;
}

/**
 * Returns true when DEBUG_TIMEZONES is set. Used by
 * `timezone-lookup` to gate the per-city "Resolved <city> → <tz>"
 * log — city strings are user-controlled and may carry PII, so the
 * verbose echo stays off by default.
 */
export function isTimezoneDebugEnabled(): boolean {
  return DEBUG_TIMEZONES;
}
