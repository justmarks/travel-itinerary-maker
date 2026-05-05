import * as Sentry from "@sentry/browser";
import { redactShareTokens } from "./sentry-scrub";

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
    // Don't auto-attach IPs, user agents, cookies, or headers. Sentry 8+
    // defaults this to false; set it explicitly so a future SDK upgrade
    // can't silently flip it.
    sendDefaultPii: false,
    // Strip share-link tokens out of every event URL / request before
    // it leaves the browser. See `lib/sentry-scrub.ts` for what's
    // redacted and why.
    beforeSend(event) {
      if (event.request?.url) {
        event.request.url = redactShareTokens(event.request.url);
      }
      if (event.transaction) {
        event.transaction = redactShareTokens(event.transaction);
      }
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      if (typeof breadcrumb.data?.url === "string") {
        breadcrumb.data.url = redactShareTokens(breadcrumb.data.url);
      }
      if (typeof breadcrumb.data?.from === "string") {
        breadcrumb.data.from = redactShareTokens(breadcrumb.data.from);
      }
      if (typeof breadcrumb.data?.to === "string") {
        breadcrumb.data.to = redactShareTokens(breadcrumb.data.to);
      }
      return breadcrumb;
    },
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
