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
  /** True when the day has transit during the lunch window — picnic/takeaway. */
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

/** Lunch window: a transport segment starting in this range overlaps lunch. */
const LUNCH_WINDOW_START = "10:00";
const LUNCH_WINDOW_END = "14:00";

function inLunchWindow(time: string | undefined): boolean {
  if (!time) return false;
  // ISO-style HH:MM lex-compares correctly: "10:00" <= "13:30" < "14:00"
  return time >= LUNCH_WINDOW_START && time < LUNCH_WINDOW_END;
}

function hasMeal(segments: Segment[], type: SegmentType): boolean {
  return segments.some((s) => s.type === type);
}

function transportInLunchWindow(segments: Segment[]): boolean {
  return segments.some(
    (s) => TRANSPORT_TYPES.has(s.type) && inLunchWindow(s.startTime),
  );
}

/** Friendly date label like "Mon, Apr 14" given a TripDay. */
function dayLabel(day: TripDay): string {
  const d = new Date(day.date + "T00:00:00");
  const md = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${day.dayOfWeek}, ${md}`;
}

/**
 * Walk every TripDay and emit a `MealSuggestion` for any missing lunch or
 * dinner. When the day already has a transport segment overlapping the
 * lunch window (10:00–14:00), the lunch suggestion switches to a takeaway
 * variant — a sit-down place won't fit while the user is in transit.
 *
 * Pure: takes the days array, returns a fresh list. Doesn't mutate.
 * Caller is responsible for de-duping against any todos that already
 * exist on the trip (see `dedupeAgainstExistingTodos`).
 */
export function suggestMealTodos(days: TripDay[]): MealSuggestion[] {
  const out: MealSuggestion[] = [];

  for (const day of days) {
    const label = dayLabel(day);
    const cityPart = day.city ? ` in ${day.city}` : "";

    if (!hasMeal(day.segments, LUNCH_TYPE)) {
      const takeaway = transportInLunchWindow(day.segments);
      const text = takeaway
        ? `Pick up takeaway lunch for ${label}${cityPart}`
        : `Plan lunch for ${label}${cityPart}`;
      const details = takeaway
        ? "Transit during lunch — grab something portable."
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

    if (!hasMeal(day.segments, DINNER_TYPE)) {
      out.push({
        key: `dinner-${day.date}`,
        date: day.date,
        meal: "dinner",
        takeaway: false,
        text: `Plan dinner for ${label}${cityPart}`,
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
