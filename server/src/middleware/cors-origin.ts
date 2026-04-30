/**
 * CORS origin-check builder.
 *
 * Combines a literal allowlist (`CORS_ORIGIN`, comma-separated) with an
 * optional regex (`CORS_ORIGIN_PATTERN`, used for Vercel preview URLs
 * whose hash changes per-deployment). A request's `Origin` is allowed
 * when:
 *
 *   - the header is absent (server-to-server / health probes), OR
 *   - the value matches any literal in the allowlist, OR
 *   - the value matches the pattern (when configured).
 *
 * Returns the function shape that `cors({ origin })` expects.
 */

export type CorsOriginCheck = (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
) => void;

export function buildCorsOriginCheck(
  literals: string[],
  pattern: RegExp | null,
): CorsOriginCheck {
  return (origin, callback) => {
    if (!origin) return callback(null, true);
    if (literals.includes(origin)) return callback(null, true);
    if (pattern && pattern.test(origin)) return callback(null, true);
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  };
}
