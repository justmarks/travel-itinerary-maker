import type { SegmentType } from "./types/trip";

/**
 * Human-readable label for each segment type. Single source of truth for the
 * desktop (`itinerary-day.tsx`) and mobile (`mobile-segment-config.ts`) UIs,
 * the cost panel category map, the markdown export, and anywhere else that
 * needs to render a segment-type as a noun.
 *
 * Adding a new `SegmentType` requires adding a label here (TypeScript
 * enforces the `Record<SegmentType, ...>` shape).
 */
export const SEGMENT_LABELS: Record<SegmentType, string> = {
  flight: "Flight",
  train: "Train",
  car_rental: "Car Rental",
  car_service: "Car Service",
  other_transport: "Transport",
  hotel: "Hotel",
  activity: "Activity",
  show: "Show",
  restaurant_breakfast: "Breakfast",
  restaurant_brunch: "Brunch",
  restaurant_lunch: "Lunch",
  restaurant_dinner: "Dinner",
  tour: "Tour",
  cruise: "Cruise",
};

/**
 * Design-token family for each segment type — maps to the
 * `--seg-{family}-{rail,bg,fg}` CSS variables in `design-tokens.css`.
 * The two `car_*` types collapse to one "car" family because the design
 * system gives them the same visual treatment.
 */
export const SEGMENT_TOKEN_FAMILY: Record<SegmentType, string> = {
  flight: "flight",
  train: "train",
  car_rental: "car",
  car_service: "car",
  other_transport: "transport",
  hotel: "hotel",
  activity: "activity",
  show: "show",
  restaurant_breakfast: "breakfast",
  restaurant_brunch: "brunch",
  restaurant_lunch: "lunch",
  restaurant_dinner: "dinner",
  tour: "tour",
  cruise: "cruise",
};

/**
 * Human-readable label for any cost category. Cost categories share the
 * segment-type taxonomy today (every cost is attached to a segment), so we
 * delegate to `SEGMENT_LABELS`. Unknown keys fall back to a titlecased
 * rendering of the raw snake_case key so a future cost-only category
 * degrades gracefully instead of rendering as `restaurant_breakfast`.
 */
export function costCategoryLabel(category: string): string {
  if (category in SEGMENT_LABELS) {
    return SEGMENT_LABELS[category as SegmentType];
  }
  return category
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
