/**
 * Pure helpers for the auto email-scan scheduler's cadence math.
 *
 * The scheduler treats `nextRunAt` as the only trigger field — the
 * cron-tick endpoint selects schedules where `enabled = true AND
 * nextRunAt <= now()`, executes them, then computes a new
 * `nextRunAt` via `computeNextRunAt(frequency, runStartedAt)`.
 *
 * Anchoring the new `nextRunAt` on the run's START time (rather than
 * its finish) keeps the cadence honest even if a run takes minutes:
 * a "daily" schedule fires at roughly the same wall-clock time every
 * day regardless of execution duration.
 */

import type { EmailScanFrequency } from "@itinly/shared";

/**
 * Returns the ISO datetime when a schedule with the given frequency
 * should next fire, anchored on the supplied reference time. The
 * reference defaults to "now" so the API create handler can use it
 * without thinking about the anchor.
 */
export function computeNextRunAt(
  frequency: EmailScanFrequency,
  reference: Date = new Date(),
): string {
  const next = new Date(reference.getTime());
  switch (frequency) {
    case "daily":
      next.setUTCDate(next.getUTCDate() + 1);
      break;
    case "weekly":
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case "monthly":
      // Calendar-month bump — `setUTCMonth` rolls over correctly across
      // year boundaries and handles short months (Jan 31 + 1 month →
      // Mar 3 in JS, which is fine for our purposes).
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
  }
  return next.toISOString();
}
