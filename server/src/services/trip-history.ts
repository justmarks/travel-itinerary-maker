import type { Request } from "express";
import {
  generateId,
  TRIP_HISTORY_MAX_ENTRIES,
  type Segment,
  type SegmentType,
  type Trip,
  type TripHistoryEntry,
  type TripHistoryKind,
} from "@travel-app/shared";

export interface RecordHistoryOptions {
  details?: string;
  entityId?: string;
}

/**
 * Append an audit entry to a trip's history list, mutating in place.
 *
 * Pulls the actor email from `req.userEmail` (set by `requireAuth`). If the
 * caller somehow lacks userEmail — shouldn't happen on protected routes,
 * but defensive — the entry still records with "unknown" so we don't drop
 * an audit row silently.
 *
 * Trims the oldest entries off the front when the list grows past
 * `TRIP_HISTORY_MAX_ENTRIES` so a long-lived trip can't grow unbounded.
 */
export function recordHistory(
  trip: Trip,
  req: Request,
  kind: TripHistoryKind,
  summary: string,
  options: RecordHistoryOptions = {},
): void {
  if (!Array.isArray(trip.history)) trip.history = [];
  const entry: TripHistoryEntry = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    actor: { email: req.userEmail ?? "unknown" },
    kind,
    summary,
    ...(options.details ? { details: options.details } : {}),
    ...(options.entityId ? { entityId: options.entityId } : {}),
  };
  trip.history.push(entry);
  if (trip.history.length > TRIP_HISTORY_MAX_ENTRIES) {
    trip.history.splice(0, trip.history.length - TRIP_HISTORY_MAX_ENTRIES);
  }
}

// ─── Summary helpers ──────────────────────────────────────────────────────

const SEGMENT_TYPE_LABELS: Record<SegmentType, string> = {
  flight: "flight",
  train: "train",
  car_rental: "car rental",
  car_service: "car service",
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

export function segmentTypeLabel(type: SegmentType): string {
  return SEGMENT_TYPE_LABELS[type] ?? type;
}

export function segmentLabel(seg: Pick<Segment, "type" | "title">): string {
  return `${segmentTypeLabel(seg.type)} "${seg.title}"`;
}

/**
 * Fields that meaningfully describe a segment for history purposes. Internal
 * bookkeeping (id, source, sortOrder, calendarEventId, needsReview) is
 * deliberately excluded — they change as side-effects of other actions and
 * would be noise in the audit log.
 */
const SEGMENT_DIFF_FIELDS = [
  "title",
  "startTime",
  "endTime",
  "venueName",
  "address",
  "city",
  "url",
  "confirmationCode",
  "provider",
  "departureCity",
  "arrivalCity",
  "departureAirport",
  "arrivalAirport",
  "carrier",
  "routeCode",
  "coach",
  "partySize",
  "creditCardHold",
  "cancellationDeadline",
  "phone",
  "endDate",
  "breakfastIncluded",
  "seatNumber",
  "cabinClass",
  "baggageInfo",
  "contactName",
  "cost",
  "portsOfCall",
] as const;

/**
 * Compare two segment snapshots and return a comma-separated list of changed
 * field names suitable for the `details` line on a `segment.update` entry.
 * Returns `undefined` when nothing meaningful changed (e.g. the only change
 * was a sortOrder bump or a no-op rewrite).
 */
export function summariseSegmentChanges(
  before: Segment,
  after: Segment,
): string | undefined {
  const changed: string[] = [];
  for (const field of SEGMENT_DIFF_FIELDS) {
    if (!shallowEqual(before[field], after[field])) {
      changed.push(field);
    }
  }
  if (before.needsReview && !after.needsReview) changed.push("confirmed");
  if (changed.length === 0) return undefined;
  return `Changed ${changed.join(", ")}`;
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}
