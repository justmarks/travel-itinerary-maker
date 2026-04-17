export type TripStatus = "planning" | "active" | "completed" | "cancelled";

export type SegmentType =
  | "flight"
  | "train"
  | "car_rental"
  | "car_service"
  | "other_transport"
  | "hotel"
  | "activity"
  | "show"
  | "restaurant_breakfast"
  | "restaurant_brunch"
  | "restaurant_lunch"
  | "restaurant_dinner"
  | "tour"
  | "cruise";

export type SegmentSource = "manual" | "email_auto" | "email_confirmed";

export type TodoCategory = "meals" | "activities" | "research" | "logistics";

export type SharePermission = "view" | "edit";

export interface SegmentCost {
  amount: number;
  currency: string; // USD, EUR, GBP, or "points"
  details?: string; // Room type, class, seat#, check-in/out, breakfast, etc.
}

/**
 * A single port of call on a cruise itinerary. Used by cruise segments to
 * describe which port the ship visits each day. "At sea" days can be
 * represented with `atSea: true` (and no `port`), or simply omitted.
 */
export interface CruisePortOfCall {
  date: string; // YYYY-MM-DD
  /** Port name, e.g. "Dubrovnik" or "Venice/Italy". Omitted when atSea=true. */
  port?: string;
  arrivalTime?: string; // HH:MM, omitted for embarkation day
  departureTime?: string; // HH:MM, omitted for disembarkation day
  /** True when the ship is cruising at sea with no port visit that day. */
  atSea?: boolean;
}

export interface Segment {
  id: string;
  type: SegmentType;
  title: string;
  // Time
  startTime?: string;
  endTime?: string;
  // Location
  venueName?: string;
  address?: string;
  city?: string;
  url?: string;
  // Booking
  confirmationCode?: string;
  provider?: string;
  // Transport-specific
  departureCity?: string;
  arrivalCity?: string;
  carrier?: string;
  routeCode?: string;
  // Train-specific (reuses departureCity/arrivalCity as the station names)
  coach?: string;
  // Dining-specific
  partySize?: number;
  creditCardHold?: boolean;
  cancellationDeadline?: string; // ISO date "YYYY-MM-DD" — when CC hold must be cancelled by
  phone?: string;
  // End-of-stay date (YYYY-MM-DD). Currently used by hotels (check-out),
  // car_rental (drop-off), and cruise (disembark).
  endDate?: string;
  // Cruise-specific: per-day ports of call. When present, applying the
  // segment updates TripDay.city for each day in range to match the port.
  portsOfCall?: CruisePortOfCall[];
  // Hotel-specific
  breakfastIncluded?: boolean;
  // Flight-specific
  seatNumber?: string; // e.g. "14A, 14B"
  cabinClass?: string; // e.g. "Economy", "Business", "First", "Premium Economy"
  baggageInfo?: string; // e.g. "1 checked bag included", "No checked bags - $35/bag"
  // Car service specific
  contactName?: string; // driver / pickup contact name
  // Cost embedded in segment
  cost?: SegmentCost;
  // Google Calendar sync
  calendarEventId?: string;
  // Source tracking
  source: SegmentSource;
  sourceEmailId?: string;
  needsReview: boolean;
  sortOrder: number;
}

export interface TripDay {
  date: string; // ISO date string YYYY-MM-DD
  dayOfWeek: string; // Mon, Tue, Wed, etc.
  city: string;
  segments: Segment[];
}

export interface Todo {
  id: string;
  text: string;
  isCompleted: boolean;
  category?: TodoCategory;
  /** Free-form notes — supports multi-line input from the edit dialog. */
  details?: string;
  sortOrder: number;
}

export interface TripShare {
  id: string;
  shareToken: string;
  sharedWithEmail?: string;
  permission: SharePermission;
  showCosts: boolean;
  showTodos: boolean;
  expiresAt?: string;
  createdAt: string;
}

/**
 * Current Trip JSON schema version.
 *
 * Bump this when the Trip shape changes in a way that existing persisted
 * trips can't round-trip losslessly (new required fields, renamed fields,
 * restructured sub-objects). Every bump needs a corresponding migration
 * step in `migrateTrip` so old JSON continues to load cleanly.
 *
 * Storage layers call `migrateTrip` on every `getTrip`/`listTrips` read,
 * so by the next save the field has been normalised onto the trip.
 */
export const CURRENT_TRIP_SCHEMA_VERSION = 1;

export interface Trip {
  id: string;
  title: string;
  startDate: string; // ISO date string YYYY-MM-DD
  endDate: string;
  status: TripStatus;
  days: TripDay[];
  todos: Todo[];
  shares: TripShare[];
  createdAt: string;
  updatedAt: string;
  /**
   * Version of the Trip JSON shape this document was last saved under. See
   * `CURRENT_TRIP_SCHEMA_VERSION`. Older persisted trips may not have this
   * field yet; storage layers normalise them on read via `migrateTrip`.
   */
  schemaVersion: number;
}

export interface UserSettings {
  gmailLabelFilter?: string;
  emailScanIntervalMinutes: number;
  notificationsEnabled: boolean;
}

/** Aggregated cost summary for a trip */
export interface CostSummaryItem {
  category: string;
  description: string;
  /**
   * City associated with this cost line. Preferred source is the segment's
   * own `city` field; falls back to the containing TripDay's city. Used by
   * the UI to render "City: Description" in the cost table.
   */
  city?: string;
  /** Raw amount as recorded on the segment (in its original currency) */
  amount: number;
  /** Original currency code (e.g. "USD", "EUR", "JPY") */
  currency: string;
  /**
   * Amount converted to USD using static FX rates. Undefined for currencies
   * with no conversion rate (e.g. "points" or unknown codes). The UI should
   * fall back to showing the raw amount for items without amountUsd.
   */
  amountUsd?: number;
  details?: string;
  segmentId: string;
}

export interface CostSummary {
  items: CostSummaryItem[];
  totalsByCurrency: Record<string, number>;
  /**
   * Sum of amountUsd across all items that had a conversion rate.
   * Items in currencies without a rate (e.g. points) are NOT included here
   * and will still appear in totalsByCurrency.
   */
  totalUsd?: number;
}

/** Classification of a parsed segment vs. existing itinerary */
export type SegmentMatchStatus = "new" | "duplicate" | "enrichment" | "conflict";

/** A single field that differs between parsed and existing segments */
export interface SegmentFieldDiff {
  field: string;
  existing?: string | number | boolean;
  parsed?: string | number | boolean;
}

/** Result of matching a parsed segment against an existing itinerary segment */
export interface SegmentMatch {
  status: SegmentMatchStatus;
  existingSegmentId?: string;
  existingTripId?: string;
  /** Fields present on the parsed segment but missing on the existing one */
  newFields?: string[];
  /** Fields where parsed and existing disagree on a non-empty value */
  conflictFields?: SegmentFieldDiff[];
}

/** A segment parsed from an email by Claude AI */
export interface ParsedSegment {
  type: SegmentType;
  title: string;
  date: string; // YYYY-MM-DD
  startTime?: string;
  endTime?: string;
  venueName?: string;
  address?: string;
  city?: string;
  url?: string;
  confirmationCode?: string;
  provider?: string;
  departureCity?: string;
  arrivalCity?: string;
  carrier?: string;
  routeCode?: string;
  coach?: string;
  partySize?: number;
  creditCardHold?: boolean;
  cancellationDeadline?: string;
  phone?: string;
  endDate?: string;
  portsOfCall?: CruisePortOfCall[];
  breakfastIncluded?: boolean;
  seatNumber?: string;
  cabinClass?: string;
  baggageInfo?: string;
  contactName?: string;
  cost?: SegmentCost;
  confidence: "high" | "medium" | "low";
  suggestedTripId?: string;
  /** Populated by scan response — how this segment compares to the itinerary */
  match?: SegmentMatch;
}

/** Result of scanning and parsing a single email */
export interface EmailScanResult {
  emailId: string;
  subject: string;
  from: string;
  receivedAt: string;
  parsedSegments: ParsedSegment[];
  parseStatus: "success" | "no_travel_content" | "failed";
  error?: string;
}

/** Gmail label info */
export interface GmailLabel {
  id: string;
  name: string;
  type: "system" | "user";
}
