const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

// Anchor every YYYY-MM-DD → Date parse at UTC midnight (`T00:00:00Z`)
// rather than naked `T00:00:00` (local time). The previous form
// parsed at local-time midnight then read `getUTCDay/Date`, which
// only happened to be correct on UTC-zone servers — on UTC+N hosts
// every "Y-M-D" was a day BEHIND UTC, so `getDayOfWeek("2026-05-14")`
// returned Wed instead of Thu and `addDays(..., 1)` returned the
// original date. Railway and Vercel default to UTC so prod never
// hit it, but dev on a non-UTC host (or a future timezone-shifted
// deployment) would have.
function parseIsoDateUtc(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

/** Get short day-of-week name from an ISO date string */
export function getDayOfWeek(isoDate: string): string {
  const date = parseIsoDateUtc(isoDate);
  return DAY_NAMES[date.getUTCDay()];
}

/**
 * Add `days` (may be negative) to an ISO date string and return an ISO date
 * string. Invalid / empty inputs return the original value unchanged so
 * callers can pass through user-typed values safely.
 */
export function addDays(isoDate: string, days: number): string {
  if (!isoDate) return isoDate;
  const d = parseIsoDateUtc(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

/** Generate an array of ISO date strings between start and end (inclusive) */
export function generateDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = parseIsoDateUtc(startDate);
  const end = parseIsoDateUtc(endDate);

  while (current <= end) {
    dates.push(current.toISOString().split("T")[0]);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

/** Check if a date falls within a range (inclusive) */
export function isDateInRange(
  date: string,
  startDate: string,
  endDate: string,
): boolean {
  return date >= startDate && date <= endDate;
}

export interface DateRange {
  startDate: string;
  endDate: string;
}

/** Check if two date ranges overlap (inclusive boundaries) */
export function dateRangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

/**
 * Find all trips whose date ranges overlap with the given range.
 * Optionally exclude a trip by ID (useful when updating an existing trip).
 */
export function findOverlappingTrips<T extends DateRange & { id: string; title: string }>(
  trips: T[],
  range: DateRange,
  excludeTripId?: string,
): T[] {
  return trips.filter(
    (trip) =>
      trip.id !== excludeTripId && dateRangesOverlap(trip, range),
  );
}

/**
 * Render a trip's date range as a compact, human-readable string —
 * "Apr 10 – Apr 16" for same-year trips or "Dec 28, 2025 – Jan 3, 2026"
 * for trips that cross a year boundary. Used by push notification
 * bodies and other places where the trip needs a one-line label.
 *
 * en-US locale is hardcoded because the server (which has no user
 * locale) is one of the consumers — keeping format stable means the
 * recipient sees the same string regardless of which side rendered it.
 * Dates are interpreted as UTC midnights so the YYYY-MM-DD storage
 * format never drifts a day either side of UTC.
 */
export function formatTripDateRange(startDate: string, endDate: string): string {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${startDate} – ${endDate}`;
  }
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const baseOpts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  };
  const startStr = start.toLocaleDateString("en-US", {
    ...baseOpts,
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const endStr = end.toLocaleDateString("en-US", {
    ...baseOpts,
    year: "numeric",
  });
  return `${startStr} – ${endStr}`;
}
