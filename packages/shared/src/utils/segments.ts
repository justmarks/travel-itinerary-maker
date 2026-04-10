import type { Segment } from "../types/trip";

/**
 * Combine `carrier` and `routeCode` into a display label like
 * "Delta 359". Returns an empty string when neither is set.
 */
export function formatFlightLabel(
  segment: Pick<Segment, "carrier" | "routeCode">,
): string {
  return [segment.carrier, segment.routeCode].filter(Boolean).join(" ");
}
