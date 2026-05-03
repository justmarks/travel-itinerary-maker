/**
 * Verbose per-step logging for the email-scan pipeline (Gmail fetch,
 * email parsing, dedup, apply). Gated behind `DEBUG_EMAIL_SCAN=1` so
 * production Railway logs stay quiet by default. Set the env var to
 * "1" when actively diagnosing a scan/parse/apply regression.
 *
 * `console.warn` / `console.error` calls are deliberately NOT gated —
 * those flag real anomalies and should always surface.
 */
const DEBUG_EMAIL_SCAN = process.env.DEBUG_EMAIL_SCAN === "1";

export function debugEmailScan(...args: unknown[]): void {
  if (DEBUG_EMAIL_SCAN) {
    console.log(...args);
  }
}
