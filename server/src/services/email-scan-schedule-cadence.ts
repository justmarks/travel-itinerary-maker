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
 *
 * Optional `timeOfDay` + `dayOfWeek` anchor the firing wall-clock:
 *   daily  + timeOfDay        → today at HH:MM UTC, or tomorrow if
 *                                that's already past `reference`.
 *   weekly + timeOfDay + dow  → next occurrence of `dow` at HH:MM
 *                                strictly after `reference`.
 *   weekly + dow without time → midnight UTC on that day.
 *   monthly                   → calendar-month bump (no clock anchor;
 *                                the cadence is too coarse for a
 *                                wall-clock alignment to feel
 *                                meaningful, and the editor doesn't
 *                                expose the picker for it).
 *
 * Unspecified anchors fall back to the legacy flat-bump semantics so
 * schedules persisted before the columns existed keep working.
 */

import type { EmailScanFrequency } from "@itinly/shared";

export interface NextRunAtOptions {
  /** UTC `HH:MM` 24h. Used by `daily` and `weekly`. */
  timeOfDay?: string;
  /** UTC day-of-week (0 = Sunday, …, 6 = Saturday). Used by `weekly`. */
  dayOfWeek?: number;
}

/**
 * Parses an `HH:MM` string into `[hour, minute]`. Returns null when
 * the input is malformed so callers can fall back rather than firing
 * at an undefined hour. The validator (`scheduleTimeOfDayRegex`)
 * rejects malformed input at the API boundary; this is a defence in
 * depth for storage rows that pre-date the column or were edited
 * directly in SQL.
 */
function parseTimeOfDay(s: string | undefined): [number, number] | null {
  if (!s) return null;
  const m = s.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10)];
}

/**
 * Returns the ISO datetime when a schedule with the given frequency
 * should next fire, anchored on the supplied reference time. The
 * reference defaults to "now" so the API create handler can use it
 * without thinking about the anchor.
 */
export function computeNextRunAt(
  frequency: EmailScanFrequency,
  reference: Date = new Date(),
  options: NextRunAtOptions = {},
): string {
  const next = new Date(reference.getTime());
  const time = parseTimeOfDay(options.timeOfDay);

  switch (frequency) {
    case "daily": {
      if (time) {
        next.setUTCHours(time[0], time[1], 0, 0);
        // If the anchor time today is already past the reference, the
        // schedule has already fired today — slide to tomorrow at the
        // same clock time.
        if (next.getTime() <= reference.getTime()) {
          next.setUTCDate(next.getUTCDate() + 1);
        }
      } else {
        next.setUTCDate(next.getUTCDate() + 1);
      }
      break;
    }
    case "weekly": {
      const dow = options.dayOfWeek;
      const hasDow = typeof dow === "number" && dow >= 0 && dow <= 6;
      if (hasDow) {
        next.setUTCHours(time ? time[0] : 0, time ? time[1] : 0, 0, 0);
        const current = next.getUTCDay();
        let daysAhead = (dow - current + 7) % 7;
        // Today is the target day but the clock time has passed → push
        // out a full week to keep the cadence weekly.
        if (daysAhead === 0 && next.getTime() <= reference.getTime()) {
          daysAhead = 7;
        }
        next.setUTCDate(next.getUTCDate() + daysAhead);
      } else if (time) {
        // No day-of-week anchor but a clock anchor — fire at that clock
        // time, 7 days out. Anchoring on `reference` first then
        // adjusting the hour preserves whatever weekday the user picked
        // at create time.
        next.setUTCDate(next.getUTCDate() + 7);
        next.setUTCHours(time[0], time[1], 0, 0);
      } else {
        next.setUTCDate(next.getUTCDate() + 7);
      }
      break;
    }
    case "monthly":
      // Calendar-month bump — `setUTCMonth` rolls over correctly across
      // year boundaries and handles short months (Jan 31 + 1 month →
      // Mar 3 in JS, which is fine for our purposes).
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
  }
  return next.toISOString();
}
