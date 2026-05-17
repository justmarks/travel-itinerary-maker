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
 * Reference date: **today**. Using today (rather than a fixed
 * mid-winter date like Jan 7) means the conversion picks up the
 * current DST state of the user's zone. The previous fixed-January
 * reference produced wrong stored UTC values whenever the user was in
 * a different DST regime — e.g. a US Pacific user picking 9:15 AM in
 * May (PDT, UTC-7) got 17:15 UTC stored (the PST offset, UTC-8),
 * which surfaces as 10:15 AM on `next_run_at` reads. Anchoring on
 * today fixes that for picks made today.
 *
 * DST drift across transitions remains: a UTC moment saved in March
 * (DST active) renders one hour off after the November fallback
 * because the stored moment doesn't follow the local zone's hop. For
 * a daily / weekly scheduled scan a one-hour twice-a-year drift is
 * acceptable; a true "fire exactly at 09:00 my local time
 * year-round" anchor would need an IANA zone column, which we're
 * punting on until a user asks.
 */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** The Sunday of the current local week, at 00:00:00 local. */
function thisLocalSunday(): Date {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - now.getDay(),
    0,
    0,
    0,
    0,
  );
}

/** The Sunday of the current UTC week, at 00:00:00 UTC. */
function thisUtcSunday(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - now.getUTCDay(),
      0,
      0,
      0,
      0,
    ),
  );
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
 * Convert a local `HH:MM` pick to UTC `HH:MM`. Anchored on today so
 * the conversion uses the user's CURRENT DST offset, not a stale
 * mid-winter one.
 */
export function localTimeToUtcTime(local: string): string {
  const [h, m] = parseHHMM(local);
  const now = new Date();
  const d = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    h,
    m,
    0,
    0,
  );
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

/**
 * Convert a stored UTC `HH:MM` back to the user's local `HH:MM` for
 * editor display. Anchored on today's UTC date so the reverse uses
 * the matching current DST offset.
 */
export function utcTimeToLocalTime(utc: string): string {
  const [h, m] = parseHHMM(utc);
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m, 0, 0),
  );
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Convert a (localDay, localTime) pair to (utcDay, utcTime). Used by
 * the weekly cadence so a Sunday-night pick in UTC-5 (e.g. Sunday
 * 23:00) correctly stores as Monday 04:00 UTC.
 *
 * Anchored on this local week's Sunday so the conversion is done
 * in the current DST regime — same fix as the time-only conversion.
 */
export function localWeeklyToUtc(
  localDay: number,
  localTime: string,
): { dayOfWeek: number; timeOfDay: string } {
  const [h, m] = parseHHMM(localTime);
  const sunday = thisLocalSunday();
  const d = new Date(
    sunday.getFullYear(),
    sunday.getMonth(),
    sunday.getDate() + localDay,
    h,
    m,
    0,
    0,
  );
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
  const sunday = thisUtcSunday();
  const d = new Date(
    Date.UTC(
      sunday.getUTCFullYear(),
      sunday.getUTCMonth(),
      sunday.getUTCDate() + utcDay,
      h,
      m,
      0,
      0,
    ),
  );
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
