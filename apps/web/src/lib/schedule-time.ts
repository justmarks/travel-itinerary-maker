/**
 * Local-clock ↔ UTC conversion for the email-scan schedule editor.
 *
 * The server stores `timeOfDay` ("HH:MM" 24h UTC) and `dayOfWeek`
 * (0 = Sunday, …, 6 = Saturday UTC) so the cron tick — which runs in
 * UTC — has an unambiguous wall-clock anchor. The picker in the
 * editor talks to the user in their browser-local time zone instead,
 * so we convert both fields together: a late-evening local pick can
 * cross midnight UTC and bump the day.
 *
 * DST caveat: a user who picks "09:00 local" in March (DST active)
 * will see "08:00 local" the same calendar moment in November (DST
 * off) because the stored UTC moment is fixed. For a daily scheduled
 * scan a one-hour twice-a-year drift is acceptable; a real "fire
 * exactly at 09:00 my local time year-round" anchor would need an
 * IANA zone column, which we're punting on until a user asks.
 *
 * The reference date used for the conversion is 2024-01-07 — that
 * happened to be a Sunday in both UTC and every IANA zone (DST shifts
 * are several months either side), so day-of-week arithmetic doesn't
 * accidentally cross a year/month boundary mid-conversion.
 */

const REF_YEAR = 2024;
const REF_MONTH = 0; // January
const REF_SUNDAY = 7; // Sunday 7 Jan 2024 in BOTH local + UTC zones.

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Returns the user's current browser-local clock as `HH:MM` (24h).
 * Used as the default when the editor opens for a new schedule so
 * the user doesn't have to type anything to accept "now".
 */
export function localNowAsHHMM(): string {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Convert a local `HH:MM` pick to UTC `HH:MM`. Uses the reference
 * date to avoid DST shifts at the edges of the year.
 */
export function localTimeToUtcTime(local: string): string {
  const [h, m] = parseHHMM(local);
  const d = new Date(REF_YEAR, REF_MONTH, REF_SUNDAY, h, m, 0, 0);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/**
 * Convert a stored UTC `HH:MM` back to the user's local `HH:MM` for
 * editor display.
 */
export function utcTimeToLocalTime(utc: string): string {
  const [h, m] = parseHHMM(utc);
  const d = new Date(Date.UTC(REF_YEAR, REF_MONTH, REF_SUNDAY, h, m, 0, 0));
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Convert a (localDay, localTime) pair to (utcDay, utcTime). Used by
 * the weekly cadence so a Sunday-night pick in UTC-5 (e.g. Sunday
 * 23:00) correctly stores as Monday 04:00 UTC.
 */
export function localWeeklyToUtc(
  localDay: number,
  localTime: string,
): { dayOfWeek: number; timeOfDay: string } {
  const [h, m] = parseHHMM(localTime);
  const d = new Date(REF_YEAR, REF_MONTH, REF_SUNDAY + localDay, h, m, 0, 0);
  return {
    dayOfWeek: d.getUTCDay(),
    timeOfDay: `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`,
  };
}

/**
 * Reverse of `localWeeklyToUtc`. Used to seed the editor when the
 * user reopens an existing weekly schedule.
 */
export function utcWeeklyToLocal(
  utcDay: number,
  utcTime: string,
): { dayOfWeek: number; timeOfDay: string } {
  const [h, m] = parseHHMM(utcTime);
  const d = new Date(Date.UTC(REF_YEAR, REF_MONTH, REF_SUNDAY + utcDay, h, m, 0, 0));
  return {
    dayOfWeek: d.getDay(),
    timeOfDay: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
  };
}

function parseHHMM(s: string): [number, number] {
  // Defensive — the validator rejects malformed input at the API
  // boundary, but the helper is also fed by browser inputs and stored
  // rows. A bogus value falls back to midnight so the editor doesn't
  // crash on a row created by SQL outside the app.
  const m = s.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return [0, 0];
  return [parseInt(m[1], 10), parseInt(m[2], 10)];
}

export const DAY_OF_WEEK_LABELS: readonly string[] = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
