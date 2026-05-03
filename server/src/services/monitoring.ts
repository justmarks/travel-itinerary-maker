import * as Sentry from "@sentry/node";
import { config } from "../config/env";

/**
 * Sentry error tracking for the server.
 *
 * Initialisation is gated on `SENTRY_DSN`: if the env var is unset we skip
 * setup entirely. That keeps local dev and CI silent (no network traffic,
 * no noise from test-time exceptions), and makes staged rollout possible —
 * ship the code, then flip on reporting later by setting the env var.
 *
 * Call `initMonitoring()` exactly once at process start (before `createApp`).
 * Wire `errorHandler` into Express as the *last* middleware; internally it
 * forwards the error to Sentry (when enabled) and then to Express's
 * default handler.
 */

let initialised = false;

export function initMonitoring(): void {
  if (initialised) return;
  if (!config.sentry.dsn) {
    console.log("Sentry: SENTRY_DSN not set — error tracking disabled.");
    return;
  }

  Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.nodeEnv,
    // Capture all transactions while we're still building visibility into
    // the email-parse pipeline. Errors are always captured regardless.
    tracesSampleRate: 1.0,
  });

  initialised = true;
  console.log(`Sentry: initialised (environment=${config.nodeEnv})`);
}

/**
 * Report a thrown error to Sentry. Safe to call whether or not Sentry was
 * initialised — no-op when disabled.
 */
export function reportError(err: unknown, context?: Record<string, unknown>): void {
  if (!initialised) return;
  Sentry.withScope((scope) => {
    if (context) scope.setExtras(context);
    Sentry.captureException(err);
  });
}

/**
 * Report a non-error structured event to Sentry (e.g. a soft parse failure
 * where no exception was thrown but the outcome is interesting). `tags` end
 * up as searchable Sentry tags; `context` becomes free-form extras. No-op
 * when Sentry is disabled.
 */
export function reportMessage(
  message: string,
  options?: {
    level?: "info" | "warning" | "error";
    tags?: Record<string, string>;
    context?: Record<string, unknown>;
  },
): void {
  if (!initialised) return;
  Sentry.withScope((scope) => {
    if (options?.tags) {
      for (const [k, v] of Object.entries(options.tags)) scope.setTag(k, v);
    }
    if (options?.context) scope.setExtras(options.context);
    scope.setLevel(options?.level ?? "warning");
    Sentry.captureMessage(message);
  });
}

/** Whether Sentry has been successfully initialised (mostly for tests). */
export function isMonitoringEnabled(): boolean {
  return initialised;
}

/**
 * For tests: reset the singleton so successive tests can exercise different
 * DSN configurations without leaking state.
 */
export function __resetMonitoringForTests(): void {
  initialised = false;
}
