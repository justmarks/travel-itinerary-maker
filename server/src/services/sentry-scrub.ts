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

/**
 * Headers that carry a credential we never want in a Sentry event.
 *
 * `Sentry.init({ sendDefaultPii: false })` already opts us out of
 * Sentry's automatic header attachment, but `beforeSend` is the right
 * choke point to also strip credentials a future `setContext({ headers })`
 * call (or an SDK upgrade that flips the default) could leak. Compare
 * with `toLowerCase()` because HTTP header names are case-insensitive
 * and Sentry preserves whatever case the request arrived with.
 */
const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "proxy-authorization",
]);

/**
 * Walk a Sentry event and replace any sensitive header value with
 * `[REDACTED]`. Returns the same event object (mutated in place) so
 * the `beforeSend` hook can pass it through.
 */
export function scrubSensitiveHeaders<
  T extends { request?: { headers?: Record<string, unknown> } | undefined },
>(event: T): T {
  const headers = event.request?.headers;
  if (!headers) return event;
  for (const key of Object.keys(headers)) {
    if (SENSITIVE_HEADER_NAMES.has(key.toLowerCase())) {
      headers[key] = "[REDACTED]";
    }
  }
  return event;
}
