const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Get short day-of-week name from an ISO date string */
export function getDayOfWeek(isoDate: string): string {
  const date = new Date(isoDate + "T00:00:00");
  return DAY_NAMES[date.getUTCDay()];
}

/** Generate an array of ISO date strings between start and end (inclusive) */
export function generateDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");

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
