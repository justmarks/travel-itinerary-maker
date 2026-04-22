import * as Sentry from "@sentry/browser";

/**
 * Sentry error tracking for the browser.
 *
 * Gated on `NEXT_PUBLIC_SENTRY_DSN` (must be `NEXT_PUBLIC_` so the value is
 * embedded into the static bundle at build time). When unset, `init` is a
 * no-op and `reportError` does nothing — dev and CI stay silent, and the
 * GitHub Pages deployment only starts reporting once the env var is set.
 */

let initialised = false;

export function initMonitoring(): void {
  if (initialised) return;
  if (typeof window === "undefined") return; // SSR / static generation
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "production",
    // Keep trace sampling low until we know baseline volume; errors are
    // always captured regardless.
    tracesSampleRate: 0.05,
  });
  initialised = true;
}

/**
 * Report an error to Sentry. Safe to call regardless of init state.
 */
export function reportError(err: unknown, context?: Record<string, unknown>): void {
  if (!initialised) return;
  Sentry.withScope((scope) => {
    if (context) scope.setExtras(context);
    Sentry.captureException(err);
  });
}
