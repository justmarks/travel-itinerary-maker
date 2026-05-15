import type { Segment, SegmentType, TripDay } from "@itinly/shared";

// ── Category helpers ──────────────────────────────────────────

export type TimelineCategory = "transport" | "hotel" | "activity" | "dining";

const TRANSPORT_TYPES = new Set<SegmentType>([
  "flight",
  "train",
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
 * Cruises and car rentals share the lane with hotels because all three
 * are multi-day commitments where what matters on the timeline is the
 * span (embark → disembark, pickup → dropoff), not a per-day pill in
 * Activities / Transport that loses the duration. Per-bar cosmetics
 * (icon + label + unit) still differ so a rental reads as a rental,
 * not as a hotel.
 */
const LODGING_TYPES = new Set<SegmentType>(["hotel", "cruise", "car_rental"]);

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
export function extractHotels(days: readonly TripDay[]): HotelBar[] {
  const bars: HotelBar[] = [];
  days.forEach((day, dayIdx) => {
    day.segments
      .filter((s) => LODGING_TYPES.has(s.type))
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
