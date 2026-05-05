/**
 * Server-side mirror of `apps/web/src/lib/sentry-scrub.ts` — same
 * regex, same redaction. Kept duplicated rather than shared via the
 * `packages/shared` package because the shared package already exports
 * helpers that ship to the browser bundle, and this file should never
 * be evaluated in browser-side code paths.
 *
 * Redacts share-link tokens out of any path matching
 * `/shared/{token}` or `/m/shared/{token}`.
 */

// Match only the URL-safe base64 alphabet (`A-Za-z0-9_-`). The token
// after `/shared/` is always one of those characters; using
// `[^/?#]+` would greedily eat following words ("/shared/abc failed
// to load" → match runs to "load").
const SHARE_PATH_RE = /(\/(?:m\/)?shared\/)([A-Za-z0-9_-]+)/g;

export function redactShareTokens(input: string): string {
  return input.replace(SHARE_PATH_RE, "$1[REDACTED]");
}
