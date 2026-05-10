import type { TripSummary } from "@travel-app/shared";

export type TripBucket = "current" | "upcoming" | "past";

export const BUCKET_LABEL: Record<TripBucket, string> = {
  current: "Now",
  upcoming: "Upcoming",
  past: "Past",
};

/**
 * Returns the local-date YYYY-MM-DD string. Compared against the trip's
 * `startDate` / `endDate` (also YYYY-MM-DD) to bucket into now / upcoming /
 * past. Avoids timezone surprises by using the user's local calendar day
 * rather than UTC.
 */
export function todayLocalISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function bucketTrip(trip: TripSummary, today: string): TripBucket {
  if (trip.endDate < today) return "past";
  if (trip.startDate > today) return "upcoming";
  return "current";
}

/**
 * Splits a trips list into the three buckets and applies the standard sort
 * for each: now/upcoming ascending by start date (next first), past
 * descending (most recent first). Shared between desktop and mobile so the
 * two trip-list surfaces stay in lockstep without duplicating the logic.
 */
export function groupTripsByBucket(
  trips: TripSummary[],
  today: string,
): Record<TripBucket, TripSummary[]> {
  const grouped: Record<TripBucket, TripSummary[]> = {
    current: [],
    upcoming: [],
    past: [],
  };
  for (const trip of trips) {
    grouped[bucketTrip(trip, today)].push(trip);
  }
  grouped.current.sort((a, b) => a.startDate.localeCompare(b.startDate));
  grouped.upcoming.sort((a, b) => a.startDate.localeCompare(b.startDate));
  grouped.past.sort((a, b) => b.startDate.localeCompare(a.startDate));
  return grouped;
}
