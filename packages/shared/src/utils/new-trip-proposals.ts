import type { ParsedSegment } from "../types/trip";

/**
 * Maximum days between consecutive segments before we treat them as
 * separate trips. Two weeks lumps tight back-to-back outings together
 * (a Friday-night domestic flight followed by a Sunday return is one
 * trip even if the second leg is 2 days later) without bundling
 * unrelated trips months apart.
 */
const TRIP_GROUPING_GAP_DAYS = 14;

const MS_PER_DAY = 86_400_000;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Sentinel prefix marking a "create-this-trip-on-apply" id rather
 * than a real trip id (which always starts with `trip-…`). The mobile
 * scan sheet uses these as the picker's value for unassigned segments
 * and swaps them for real ids after `useCreateTrip` resolves.
 */
export const NEW_TRIP_PREFIX = "__new__";

export interface NewTripProposal {
  /** Sentinel id — `${NEW_TRIP_PREFIX}${index}`. */
  id: string;
  /** Default trip title — user can rename later. */
  title: string;
  /** Earliest segment date in the cluster. */
  startDate: string;
  /** Latest day touched by any segment in the cluster (incl. endDate). */
  endDate: string;
  /** Caller-provided keys (e.g. ParsedSegment indices) bound to this proposal. */
  segmentKeys: string[];
}

interface InputSegment {
  /** Stable key used to thread the proposal back to the source item. */
  key: string;
  segment: ParsedSegment;
}

/**
 * Cluster a list of unassigned parsed segments into proposed new
 * trips. Sorts by date, walks in order, starts a new cluster when
 * the gap from the previous segment's last day exceeds
 * `TRIP_GROUPING_GAP_DAYS`. Each cluster gets a default name from
 * the most-common destination city plus the earliest segment's
 * month / year ("Maui April 2026"), and a date range spanning every
 * segment in the cluster (using `endDate` for multi-day items like
 * hotels and cruises).
 *
 * Caller threads the proposal back to source items via `key` —
 * typically the index in the parent array.
 */
export function proposeNewTrips(
  inputs: readonly InputSegment[],
): NewTripProposal[] {
  if (inputs.length === 0) return [];

  // Sort by start date, then by end date so a hotel covering several
  // days lands in the cluster around its check-in even when other
  // segments share the same start date.
  const sorted = [...inputs].sort((a, b) => {
    const cmp = a.segment.date.localeCompare(b.segment.date);
    if (cmp !== 0) return cmp;
    const aEnd = a.segment.endDate ?? a.segment.date;
    const bEnd = b.segment.endDate ?? b.segment.date;
    return aEnd.localeCompare(bEnd);
  });

  type Cluster = {
    keys: string[];
    segments: ParsedSegment[];
    lastEnd: string;
  };

  const clusters: Cluster[] = [];
  for (const item of sorted) {
    const last = clusters[clusters.length - 1];
    const segEnd = item.segment.endDate ?? item.segment.date;
    if (!last) {
      clusters.push({
        keys: [item.key],
        segments: [item.segment],
        lastEnd: segEnd,
      });
      continue;
    }
    const gap = daysBetween(last.lastEnd, item.segment.date);
    if (gap > TRIP_GROUPING_GAP_DAYS) {
      clusters.push({
        keys: [item.key],
        segments: [item.segment],
        lastEnd: segEnd,
      });
    } else {
      last.keys.push(item.key);
      last.segments.push(item.segment);
      if (segEnd > last.lastEnd) last.lastEnd = segEnd;
    }
  }

  return clusters.map((cluster, idx) => {
    const segments = cluster.segments;
    const startDate = segments
      .map((s) => s.date)
      .reduce((a, b) => (a < b ? a : b));
    const endDate = cluster.lastEnd;
    return {
      id: `${NEW_TRIP_PREFIX}${idx}`,
      title: proposalTitle(segments, startDate),
      startDate,
      endDate,
      segmentKeys: cluster.keys,
    };
  });
}

/**
 * Picks the destination city for a cluster's proposed title.
 *
 * Priority:
 *  1. **Non-transport segments** (hotels, activities, restaurants):
 *     count their `city` directly. A hotel is a strong destination
 *     signal — you don't stay AT a layover.
 *  2. **Transport-only fallback**: pick the *last* arrival city that
 *     isn't the same as the first segment's departure city (treated
 *     as "home"). Handles round-trips like `MIA → LAX → SEA → MIA`
 *     where the simple "most frequent arrival" tied at 1 and the
 *     first-inserted (layover) won — see the fix in #303 for the
 *     mirror-image bug on `TripDay.city` derivation.
 *
 * When nothing usable is found the title degrades to "Trip <Month>
 * <Year>" so the user still sees a sensible default to rename later.
 */
function proposalTitle(
  segments: readonly ParsedSegment[],
  startDate: string,
): string {
  const top = proposalDestination(segments);

  const date = new Date(startDate + "T00:00:00");
  const monthYear = isNaN(date.getTime())
    ? ""
    : `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;

  if (!top) return monthYear ? `Trip ${monthYear}` : "New trip";
  return monthYear ? `${top} ${monthYear}` : top;
}

const TRANSPORT_TYPES = new Set<ParsedSegment["type"]>([
  "flight",
  "train",
  "car_rental",
  "car_service",
  "other_transport",
  "cruise",
]);

function isTransport(seg: ParsedSegment): boolean {
  return TRANSPORT_TYPES.has(seg.type);
}

function proposalDestination(
  segments: readonly ParsedSegment[],
): string | undefined {
  // Hotels / activities / restaurants pin you to a city — a Maui
  // dinner is way more informative for the trip title than a flight
  // arrival into Honolulu en route. Count these by frequency.
  const nonTransportCounts = new Map<string, number>();
  for (const seg of segments) {
    if (isTransport(seg)) continue;
    const city = seg.city?.trim();
    if (city) {
      nonTransportCounts.set(city, (nonTransportCounts.get(city) ?? 0) + 1);
    }
  }
  if (nonTransportCounts.size > 0) {
    return [...nonTransportCounts.entries()].sort(
      (a, b) => b[1] - a[1],
    )[0][0];
  }

  // Transport-only cluster — pick the last non-home arrival in
  // chronological order. The first segment's `departureCity` is the
  // assumed "home" / starting point; on a round-trip its return leg
  // arrives back home, which we ignore.
  const transports = [...segments]
    .filter(isTransport)
    .sort((a, b) => {
      const cmp = a.date.localeCompare(b.date);
      if (cmp !== 0) return cmp;
      const aStart = a.startTime ?? "00:00";
      const bStart = b.startTime ?? "00:00";
      return aStart.localeCompare(bStart);
    });
  if (transports.length === 0) return undefined;

  const home = transports[0].departureCity?.trim() || undefined;
  let lastNonHome: string | undefined;
  for (const t of transports) {
    const arrival = t.arrivalCity?.trim();
    if (!arrival) continue;
    if (arrival === home) continue;
    lastNonHome = arrival;
  }
  if (lastNonHome) return lastNonHome;

  // Pure single-leg / no-home-derivable case — fall back to the last
  // arrival regardless, then to departure city, then nothing. Mirrors
  // the prior `destinationCity` order.
  for (let i = transports.length - 1; i >= 0; i--) {
    const seg = transports[i];
    if (seg.arrivalCity?.trim()) return seg.arrivalCity.trim();
    if (seg.city?.trim()) return seg.city.trim();
    if (seg.departureCity?.trim()) return seg.departureCity.trim();
  }
  return undefined;
}

function daysBetween(earlier: string, later: string): number {
  const a = new Date(earlier + "T00:00:00").getTime();
  const b = new Date(later + "T00:00:00").getTime();
  return Math.floor((b - a) / MS_PER_DAY);
}
