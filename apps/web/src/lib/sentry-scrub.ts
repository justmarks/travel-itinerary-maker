/**
 * Sentry payload scrubbing helpers — used by `beforeSend` /
 * `beforeBreadcrumb` hooks in both `lib/monitoring.ts` (browser) and
 * (mirrored on the server) `services/monitoring.ts`.
 *
 * What we redact:
 *   - **Share-link tokens.** Anywhere a path matches `/shared/{token}`
 *     or `/m/shared/{token}`, the token segment becomes `[REDACTED]`.
 *     Tokens are the entire auth secret for unauthenticated viewers
 *     (see `server/src/utils/share-token.ts`); they MUST NOT land in
 *     Sentry where they could be read by anyone with project access.
 *
 * What we deliberately don't touch:
 *   - Email addresses. Sentry already gates these behind
 *     `sendDefaultPii: false` (the default in Sentry 8+, set
 *     explicitly here for belt-and-suspenders).
 *   - Trip / segment titles, dates, locations. These can be
 *     sensitive (a planned trip says where you'll be), but stripping
 *     them would also strip the breadcrumb trail that makes debugging
 *     possible. Treat the Sentry project itself as a sensitive system
 *     instead.
 */

// Match only the URL-safe base64 alphabet (`A-Za-z0-9_-`). The token
// after `/shared/` is always one of those characters; using
// `[^/?#]+` would greedily eat following words ("/shared/abc failed
// to load" → match runs to "load").
const SHARE_PATH_RE = /(\/(?:m\/)?shared\/)([A-Za-z0-9_-]+)/g;

/** Replace share-token path segments with `[REDACTED]`. Non-mutating. */
export function redactShareTokens(input: string): string {
  return input.replace(SHARE_PATH_RE, "$1[REDACTED]");
}
