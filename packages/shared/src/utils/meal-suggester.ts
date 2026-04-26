import type { Segment, SegmentType, TripDay } from "../types/trip";

/**
 * A todo we'd like to suggest the user add to the trip. Mirrors the
 * fields needed by `createTodoSchema` so the call site can pass it
 * almost directly to `createTodo`.
 */
export interface MealSuggestion {
  /** Stable key for React lists and de-duping client-side. */
  key: string;
  /** Date the suggestion is for, YYYY-MM-DD — used for grouping/display. */
  date: string;
  /** "lunch" or "dinner". The kind of meal we think is missing. */
  meal: "lunch" | "dinner";
  /**
   * True when the day is a departure-from-an-overnight-stop day — the user
   * has slept in town and is leaving by flight/train, so a sit-down meal
   * doesn't fit. Only set on lunch.
   */
  takeaway: boolean;
  /** Final user-facing text saved as the todo's `text`. */
  text: string;
  /** Always `"meals"` today, but kept as a field so consumers don't hardcode it. */
  category: "meals";
  /** Optional notes for the todo's `details` field. Empty when no extra context. */
  details?: string;
}

const TRANSPORT_TYPES = new Set<SegmentType>([
  "flight",
  "train",
  "car_rental",
  "car_service",
  "other_transport",
  "cruise",
]);

const LUNCH_TYPE: SegmentType = "restaurant_lunch";
const DINNER_TYPE: SegmentType = "restaurant_dinner";

/** Meal windows in minutes-from-midnight. End is exclusive. */
const LUNCH_WINDOW = { start: 11 * 60 + 30, end: 14 * 60 }; // 11:30–14:00
const DINNER_WINDOW = { start: 18 * 60, end: 21 * 60 }; //   18:00–21:00

/** Layovers shorter than this don't leave room for a meal. */
const SHORT_LAYOVER_MINUTES = 6 * 60;

/**
 * Default duration for a flight/train segment when only `startTime` is
 * known. Errs long: better to skip a meal we'd otherwise suggest than
 * to recommend lunch while the user is in the air.
 */
const FLIGHT_DEFAULT_DURATION = 8 * 60;
const TRAIN_DEFAULT_DURATION = 4 * 60;
const OTHER_TRANSPORT_DEFAULT_DURATION = 2 * 60;

interface Interval {
  start: number;
  end: number;
}

function toMin(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Assumed [start, end] interval for a transport segment, in minutes. */
function transportInterval(s: Segment): Interval | null {
  if (!s.startTime) return null;
  const start = toMin(s.startTime);
  let end: number;
  if (s.endTime) {
    end = toMin(s.endTime);
  } else if (s.type === "flight") {
    end = start + FLIGHT_DEFAULT_DURATION;
  } else if (s.type === "train") {
    end = start + TRAIN_DEFAULT_DURATION;
  } else {
    end = start + OTHER_TRANSPORT_DEFAULT_DURATION;
  }
  return { start, end };
}

function hasMeal(segments: Segment[], type: SegmentType): boolean {
  return segments.some((s) => s.type === type);
}

function hasTransport(segments: Segment[]): boolean {
  return segments.some((s) => TRANSPORT_TYPES.has(s.type));
}

/**
 * True when any flight or train segment on the day crosses midnight —
 * i.e. departs in the evening and arrives the next morning (`endTime`
 * earlier than `startTime`). The whole day is effectively a transit
 * day: the user is at home, en route to the airport, or in the air for
 * the bulk of it, so neither lunch nor dinner gets a real sit-down.
 */
function hasOvernightTransport(segments: Segment[]): boolean {
  return segments.some((s) => {
    if (s.type !== "flight" && s.type !== "train") return false;
    if (!s.startTime || !s.endTime) return false;
    return toMin(s.endTime) < toMin(s.startTime);
  });
}

/**
 * True when a flight or train segment is in motion during any part of the
 * meal window. Only flights and trains qualify — sitting in a car or bus
 * doesn't preclude grabbing a meal en route the way an enclosed cabin does.
 */
function inFlightOrTrainDuring(
  segments: Segment[],
  window: Interval,
): boolean {
  return segments.some((s) => {
    if (s.type !== "flight" && s.type !== "train") return false;
    const interval = transportInterval(s);
    return interval !== null && intervalsOverlap(interval, window);
  });
}

/**
 * True when the meal window falls inside a layover shorter than 6 hours
 * — i.e. between two flight/train segments with not enough time to leave
 * the airport / station and find food.
 */
function inShortLayoverDuring(
  segments: Segment[],
  window: Interval,
): boolean {
  const flights = segments
    .filter((s) => s.type === "flight" || s.type === "train")
    .map(transportInterval)
    .filter((i): i is Interval => i !== null)
    .sort((a, b) => a.start - b.start);

  for (let i = 0; i < flights.length - 1; i++) {
    const gapStart = flights[i].end;
    const gapEnd = flights[i + 1].start;
    if (gapEnd <= gapStart) continue; // overlapping/back-to-back, skip
    if (gapEnd - gapStart >= SHORT_LAYOVER_MINUTES) continue; // long enough
    if (window.start >= gapStart && window.end <= gapEnd) return true;
  }
  return false;
}

/**
 * True when the day has an outbound flight/train starting at or after
 * `afterMin` — the signal that the user is leaving today and any
 * pre-departure meal needs to be portable.
 */
function hasDepartureAfter(segments: Segment[], afterMin: number): boolean {
  return segments.some((s) => {
    if (s.type !== "flight" && s.type !== "train") return false;
    if (!s.startTime) return false;
    return toMin(s.startTime) >= afterMin;
  });
}

/** Friendly date label like "Mon, Apr 14" given a TripDay. */
function dayLabel(day: TripDay): string {
  const d = new Date(day.date + "T00:00:00");
  const md = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${day.dayOfWeek}, ${md}`;
}

/**
 * Pick the city to use in the meal text. When a day spans two cities
 * (e.g. `"Paris/Rome"` for a transit day), the meal happens in:
 *   - the *origin* city for lunch (before the transit), so use the first segment
 *   - the *destination* city for dinner (after the transit), so use the last
 * Falls back to the original string when there's no slash or no usable
 * segment in the requested position.
 */
function mealCity(city: string, position: "first" | "last"): string {
  const parts = city
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return city;
  return position === "first" ? parts[0] : parts[parts.length - 1];
}

/**
 * Walk every TripDay and emit a `MealSuggestion` for any missing lunch or
 * dinner that the user could realistically eat. Rules applied:
 *
 * - **Overnight flight/train** — if a flight or train on this day crosses
 *   midnight (departs evening, arrives the next morning), skip both
 *   lunch and dinner. The day is effectively a transit day; the user
 *   isn't in the destination city yet and won't be sitting down for a
 *   meal there.
 * - **In transit during the meal** — if a flight or train segment overlaps
 *   the meal window, skip the meal. The user can't eat in the cabin (and
 *   if they can, the airline handles it).
 * - **Short layover (< 6h)** — when the meal window falls between two
 *   flights/trains and the gap is under 6 hours, skip the meal: there's
 *   no time to leave the airport/station and find food.
 * - **Final-day departure** — dinner is skipped on the trip's last day
 *   when that day has a transport segment (typical flight home → user
 *   eats off-itinerary).
 *
 * The takeaway-lunch variant only fires when the user has slept somewhere
 * the night before AND is leaving today — i.e. an outbound flight/train
 * starts at or after lunch ends. Arrival days (first day, or any day
 * where transport ends in the morning and they go to a hotel) get a
 * regular sit-down lunch suggestion instead.
 *
 * Pure: takes the days array, returns a fresh list. Doesn't mutate.
 * Caller is responsible for de-duping against any todos that already
 * exist on the trip (see `dedupeAgainstExistingTodos`).
 */
export function suggestMealTodos(days: TripDay[]): MealSuggestion[] {
  const out: MealSuggestion[] = [];
  const lastDayIdx = days.length - 1;

  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const isFirstDay = i === 0;
    const isLastDay = i === lastDayIdx;
    const label = dayLabel(day);
    const lunchCityPart = day.city ? ` in ${mealCity(day.city, "first")}` : "";
    const dinnerCityPart = day.city ? ` in ${mealCity(day.city, "last")}` : "";
    const overnightTransport = hasOvernightTransport(day.segments);

    // ─ Lunch ──────────────────────────────────────────────
    const lunchSkipped =
      overnightTransport ||
      hasMeal(day.segments, LUNCH_TYPE) ||
      inFlightOrTrainDuring(day.segments, LUNCH_WINDOW) ||
      inShortLayoverDuring(day.segments, LUNCH_WINDOW);

    if (!lunchSkipped) {
      // Takeaway only when user is leaving an overnight stop today —
      // i.e. there's a flight/train AT or AFTER lunch ends, and this
      // isn't the trip's first day (which is treated as the arrival
      // from home — eating in the destination city, not packing).
      const takeaway =
        !isFirstDay && hasDepartureAfter(day.segments, LUNCH_WINDOW.end);

      const text = takeaway
        ? `Pick up takeaway lunch for ${label}${lunchCityPart}`
        : `Plan lunch for ${label}${lunchCityPart}`;
      const details = takeaway
        ? "Heading out today — grab something portable."
        : undefined;

      out.push({
        key: `lunch-${day.date}`,
        date: day.date,
        meal: "lunch",
        takeaway,
        text,
        category: "meals",
        details,
      });
    }

    // ─ Dinner ─────────────────────────────────────────────
    const dinnerSkipped =
      overnightTransport ||
      hasMeal(day.segments, DINNER_TYPE) ||
      (isLastDay && hasTransport(day.segments)) ||
      inFlightOrTrainDuring(day.segments, DINNER_WINDOW) ||
      inShortLayoverDuring(day.segments, DINNER_WINDOW);

    if (!dinnerSkipped) {
      out.push({
        key: `dinner-${day.date}`,
        date: day.date,
        meal: "dinner",
        takeaway: false,
        text: `Plan dinner for ${label}${dinnerCityPart}`,
        category: "meals",
      });
    }
  }

  return out;
}

/**
 * Drop any suggestion whose `text` matches an existing todo on the trip.
 * Match is case-insensitive and trims whitespace so a manually-entered
 * "Plan lunch for Mon, Apr 14 in Tokyo" doesn't get re-suggested.
 */
export function dedupeAgainstExistingTodos<T extends { text: string }>(
  suggestions: T[],
  existingTodoTexts: readonly string[],
): T[] {
  const seen = new Set(existingTodoTexts.map((t) => t.trim().toLowerCase()));
  return suggestions.filter((s) => !seen.has(s.text.trim().toLowerCase()));
}
