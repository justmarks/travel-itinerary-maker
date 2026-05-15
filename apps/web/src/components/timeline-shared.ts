import type { Segment, SegmentType, TripDay } from "@itinly/shared";

// ── Category helpers ──────────────────────────────────────────

export type TimelineCategory = "transport" | "hotel" | "activity" | "dining";

const TRANSPORT_TYPES = new Set<SegmentType>([
  "flight",
  "train",
  "car_rental",
  "car_service",
  "other_transport",
]);
const ACTIVITY_TYPES = new Set<SegmentType>([
  "activity",
  "tour",
  "show",
]);
const DINING_TYPES = new Set<SegmentType>([
  "restaurant_breakfast",
  "restaurant_brunch",
  "restaurant_lunch",
  "restaurant_dinner",
]);

/**
 * Segment types that render as multi-day BANDS on the Lodging swimlane.
 * Cruises share the lane with hotels because the ship is the user's
 * lodging from embark through disembark. Car rentals are NOT here —
 * they belong to the Transport lane (per user UX); see
 * `TRANSPORT_BAND_TYPES`.
 */
const LODGING_TYPES = new Set<SegmentType>(["hotel", "cruise"]);

/**
 * Segment types that render as multi-day BANDS on the Transport
 * swimlane (instead of per-day pills). Car rentals are the only one
 * today — they're transport but the user wants to see the duration
 * of the rental at a glance, not a single-day pickup pill.
 */
const TRANSPORT_BAND_TYPES = new Set<SegmentType>(["car_rental"]);

/**
 * Every segment type that renders as a multi-day band on its lane.
 * Used by TypeRow to filter band types OUT of the per-day pill row so
 * a rental doesn't double-render as both a band AND a pill in the
 * same Transport lane.
 */
export const BAND_TYPES = new Set<SegmentType>([
  ...LODGING_TYPES,
  ...TRANSPORT_BAND_TYPES,
]);

export function getTimelineCategory(type: SegmentType): TimelineCategory {
  if (TRANSPORT_TYPES.has(type)) return "transport";
  if (LODGING_TYPES.has(type)) return "hotel";
  if (ACTIVITY_TYPES.has(type)) return "activity";
  if (DINING_TYPES.has(type)) return "dining";
  return "activity";
}

/**
 * The Timeline `Category` type uses the legacy key `hotel`; the design
 * tokens use `lodging`. Map at the boundary so callers can use one
 * helper without juggling the alias.
 */
export const CATEGORY_TOKEN: Record<TimelineCategory, string> = {
  transport: "transport",
  hotel: "lodging",
  activity: "activity",
  dining: "dining",
};

// ── Sort + hotel-bar helpers ──────────────────────────────────

/**
 * Stable sort by start time, falling back to the segment's saved
 * `sortOrder`. Segments without a startTime sink to the bottom.
 */
export function sortByTime(segs: readonly Segment[]): Segment[] {
  return [...segs].sort((a, b) => {
    if (a.startTime && b.startTime) {
      return a.startTime.localeCompare(b.startTime);
    }
    if (a.startTime) return -1;
    if (b.startTime) return 1;
    return a.sortOrder - b.sortOrder;
  });
}

export interface HotelBar {
  segment: Segment;
  startDayIdx: number;
  endDayIdx: number;
}

/**
 * Walks the trip and collects every lodging-lane segment (hotels +
 * cruises + car rentals) as multi-day bars (start day index → end
 * day index).
 *
 * End-date semantics differ by type:
 *   - hotel       → `endDate` is the check-OUT day (user has already
 *                   left that morning). Last covered cell =
 *                   endDate index − 1.
 *   - cruise      → `endDate` is the disembark day (user is still on
 *                   the ship that day). Last covered cell =
 *                   endDate index itself.
 *   - car_rental  → `endDate` is the dropoff day (user still has the
 *                   car that day). Last covered cell = endDate index
 *                   itself. Same inclusive convention as cruise.
 *
 * Out-of-range end dates fall back to a one-day bar so a stray
 * endDate can't overlap and scramble the grid below.
 */
function extractBars(
  days: readonly TripDay[],
  filter: ReadonlySet<SegmentType>,
): HotelBar[] {
  const bars: HotelBar[] = [];
  days.forEach((day, dayIdx) => {
    day.segments
      .filter((s) => filter.has(s.type))
      .forEach((s) => {
        let endDayIdx = dayIdx;
        if (s.endDate) {
          const found = days.findIndex((d) => d.date === s.endDate);
          if (found > 0) {
            // Hotels use exclusive end (checkout morning); cruises +
            // car rentals are inclusive (you ARE on the ship / have
            // the car that day).
            endDayIdx = s.type === "hotel" ? found - 1 : found;
          }
        }
        bars.push({ segment: s, startDayIdx: dayIdx, endDayIdx });
      });
  });
  return bars;
}

/** Lodging-lane bands: hotels + cruises. */
export function extractHotels(days: readonly TripDay[]): HotelBar[] {
  return extractBars(days, LODGING_TYPES);
}

/** Transport-lane bands: car rentals. */
export function extractRentals(days: readonly TripDay[]): HotelBar[] {
  return extractBars(days, TRANSPORT_BAND_TYPES);
}

/**
 * Greedily packs lodging bars into the smallest number of
 * non-overlapping tracks. The single-row HotelRow assumed bars never
 * overlap — when only hotels rode the lane that mostly held, but
 * cruises and car rentals frequently overlap each other AND any hotel
 * the user was sleeping at on the embarkation / pickup day. Without
 * packing, the later bar (sorted by startDayIdx) gets clamped to
 * `span <= 0` and silently vanishes from the timeline.
 *
 * Algorithm: sort by `startDayIdx`. For each bar, walk the existing
 * tracks looking for one whose last bar ended strictly before this
 * bar starts; if found, append. Otherwise open a new track. Result
 * length is therefore equal to the maximum number of overlapping
 * bars at any single day — i.e. the minimum number of rows the
 * Lodging lane must render to show every bar in full.
 */
export function packIntoTracks(bars: readonly HotelBar[]): HotelBar[][] {
  const tracks: HotelBar[][] = [];
  const sorted = [...bars].sort(
    (a, b) =>
      a.startDayIdx - b.startDayIdx ||
      // Tie-break: longer bars first so a short overlap doesn't push
      // a long one onto its own track unnecessarily.
      b.endDayIdx - a.endDayIdx,
  );
  for (const bar of sorted) {
    let placed = false;
    for (const track of tracks) {
      const last = track[track.length - 1];
      if (last.endDayIdx < bar.startDayIdx) {
        track.push(bar);
        placed = true;
        break;
      }
    }
    if (!placed) tracks.push([bar]);
  }
  return tracks;
}
