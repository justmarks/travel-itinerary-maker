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
  /**
   * Flight-only: 3-letter IATA airport codes for the departure and arrival
   * airports (e.g. "JFK", "NRT"). When set, these are the source of truth
   * for the displayed endpoint label and the IANA timezone used at calendar
   * export. Older trips and non-flight transport segments may have only the
   * `*City` fields populated.
   */
  departureAirport?: string;
  arrivalAirport?: string;
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
  /**
   * Cruise-specific: the name of the ship. Surfaced in the calendar
   * description and the auto-generated title falls back to it when no
   * cruise title was given. Optional — older cruise segments stored
   * the ship name in `venueName` or `title` and still render fine.
   */
  shipName?: string;
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
  /**
   * Last time the (named) recipient opened the trip in their dashboard.
   * Anonymous public-link views don't update this — we only know it's
   * the recipient when they're signed in as `sharedWithEmail`. Updates
   * are throttled at the server: at most one write per 30-min window
   * per share so a recipient scrolling around doesn't churn the trip
   * JSON. Surfaces in the owner's share-management UI as
   * "viewed 2h ago".
   */
  lastViewedAt?: string;
  /**
   * Last time an edit-share recipient mutated the trip — segment / todo
   * / trip CRUD all bump this. Same throttle as `lastViewedAt`. Only
   * present on `permission === "edit"` shares; view-only shares can't
   * mutate by definition.
   */
  lastEditedAt?: string;
  /**
   * Set when this share was spawned by an auto-share rule (see
   * `TripShareRule`). Lets the owner cascade-revoke spawned shares on
   * rule deletion, and lets rule edits cascade permission/visibility
   * changes onto the shares they created. Absent on shares the owner
   * created directly.
   */
  originRuleId?: string;
}

/**
 * Owner-scoped rule that auto-shares every trip the owner has (and every
 * trip they create in future) with a given recipient. On creation, the
 * server fans out a `TripShare` row for each existing trip; on trip
 * create, the trip-creation handler iterates active rules and spawns one
 * `TripShare` per recipient. Each spawned share carries `originRuleId`
 * so cascade-revoke and cascade-update can find them.
 *
 * Unique on `(ownerUserId, sharedWithEmail)` — one rule per recipient
 * per owner.
 */
export interface TripShareRule {
  id: string;
  /** Owner of the rule. Per-owner storage uses this to scope listings. */
  ownerUserId: string;
  /** Owner's email at creation time, for display in audit log / Sentry. */
  ownerEmail?: string;
  /**
   * Lower-cased email of the recipient. Required (no anonymous-link
   * rules — a forever-share with the world doesn't make sense).
   * Matches `TripShare.sharedWithEmail`.
   */
  sharedWithEmail: string;
  permission: SharePermission;
  showCosts: boolean;
  showTodos: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Discriminator strings for `TripHistoryEntry.kind`. Dotted to make it cheap
 * to filter ("show me everything that happened to segments") and to map to a
 * small set of icons in the UI.
 */
export type TripHistoryKind =
  | "trip.update"
  | "trip.day_update"
  | "segment.create"
  | "segment.update"
  | "segment.delete"
  | "segment.confirm"
  | "todo.create"
  | "todo.update"
  | "todo.delete"
  | "share.create"
  | "share.revoke"
  | "share.leave"
  | "bulk.import_xlsx"
  | "bulk.email_apply"
  | "bulk.confirm_all";

export interface TripHistoryActor {
  email: string;
  name?: string;
}

/**
 * One entry in a trip's audit log. Append-only — entries are never edited
 * or removed (the list is trimmed to the most recent 500 on write to bound
 * size, see `appendTripHistory`). Each entry captures a single mutation;
 * bulk actions use a single summary entry rather than one per row.
 */
export interface TripHistoryEntry {
  id: string;
  /** ISO 8601 timestamp the mutation was applied. */
  timestamp: string;
  actor: TripHistoryActor;
  kind: TripHistoryKind;
  /** One-line human-readable summary, e.g. `Added flight "SEA → KEF"`. */
  summary: string;
  /** Optional secondary detail, e.g. `Changed startTime, title`. */
  details?: string;
  /** Optional identifier for the affected entity (segment id, todo id). */
  entityId?: string;
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
export const CURRENT_TRIP_SCHEMA_VERSION = 2;

export interface Trip {
  id: string;
  title: string;
  startDate: string; // ISO date string YYYY-MM-DD
  endDate: string;
  status: TripStatus;
  days: TripDay[];
  todos: Todo[];
  shares: TripShare[];
  /**
   * Append-only audit log of mutations. Trimmed to the most recent 500
   * entries on write. Older trips loaded before this field existed get
   * an empty array via `migrateTrip`.
   */
  history: TripHistoryEntry[];
  createdAt: string;
  updatedAt: string;
  /** Google Calendar ID this trip is synced to, if any. */
  calendarId?: string;
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

/**
 * Browser-issued Web Push subscription (RFC 8292). The endpoint URL +
 * p256dh / auth key triple is everything the server needs to deliver a
 * push to that specific device. We persist these per-user so trip-share
 * notifications can find every device the recipient has opted in on.
 */
export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
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
  departureAirport?: string;
  arrivalAirport?: string;
  carrier?: string;
  routeCode?: string;
  coach?: string;
  partySize?: number;
  creditCardHold?: boolean;
  cancellationDeadline?: string;
  phone?: string;
  endDate?: string;
  portsOfCall?: CruisePortOfCall[];
  /** Cruise-only: name of the ship (e.g. "Disney Fantasy"). */
  shipName?: string;
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

/** Frequency cadence for an auto email-scan schedule. */
export type EmailScanFrequency = "daily" | "weekly";

/**
 * A user-owned schedule that re-runs an email scan on a regular
 * cadence. After a successful first scan against a given (provider,
 * labelFilter) pair, the user can persist the same scan as a schedule
 * so new confirmations land as `needsReview: true` segments without
 * the user having to run the scan dialog each time.
 *
 * Multiple schedules per user are allowed — each one is independently
 * scoped to a single (provider, labelFilter, frequency) triple. Two
 * schedules pointing at the same provider+folder with different
 * cadences is supported but uncommon; the typical use case is one
 * schedule per inbox the user wants watched.
 */
export interface EmailScanSchedule {
  id: string;
  /** Owner — schedules are private to the user who created them. */
  userId: string;
  /** Which mailbox provider this schedule scans. */
  provider: "google" | "microsoft";
  /**
   * Provider-specific filter the scan honors. For Gmail this is a
   * label id ("INBOX", "Label_5"); for Outlook it's a folder id.
   * Optional — when omitted, the scan runs over the entire mailbox
   * (same default as a manual scan with no label filter chosen).
   */
  labelFilter?: string;
  /**
   * Human-readable label / folder name resolved at create time and
   * persisted alongside the id so the settings UI can render
   * "Travel/Hotels" without having to re-query the provider for the
   * mapping on every page load. Stays in sync via a periodic refresh
   * the next time a scan runs.
   */
  labelName?: string;
  /**
   * When true, the scheduled scan widens its match to include every
   * label/folder nested under `labelFilter` — e.g. picking "Travel"
   * with this flag set also scans "Travel/Hotels",
   * "Travel/Flights/Confirmed", etc. Implemented at execute time by
   * resolving `labelFilter`'s descendants from the connector's
   * `listLabels()` and scanning each one. Has no effect when
   * `labelFilter` is unset (all-mail scans already cover everything).
   * Defaults to false — picking "Travel" by itself only matches that
   * exact label, matching Gmail's flat-label model.
   */
  includeSublabels?: boolean;
  frequency: EmailScanFrequency;
  /**
   * UTC clock time the schedule should target, formatted as `HH:MM`
   * (24h). Used by both supported cadences (`daily` and `weekly`) to
   * anchor when the scan fires within the day. Stored in UTC because
   * the cron tick runs in UTC; the editor UI converts to / from the
   * user's local time so the picker still reads naturally. Undefined
   * → the scheduler bumps `nextRunAt` by a flat 24h / 7d without
   * anchoring to a specific time-of-day (legacy behaviour for
   * schedules created before this field existed).
   */
  timeOfDay?: string;
  /**
   * UTC day-of-week (0 = Sunday, …, 6 = Saturday) the schedule should
   * target. Only meaningful for the `weekly` cadence. The editor UI
   * converts between the user's local-zone day and UTC together with
   * `timeOfDay` so a late-evening pick that crosses midnight UTC
   * stays consistent (e.g. picking "Sunday 11pm" in UTC-5 stores
   * `dayOfWeek = 1` + `timeOfDay = "04:00"`). Undefined → fall back
   * to a flat 7-day bump from the create-time anchor.
   */
  dayOfWeek?: number;
  /**
   * When false, the scheduler skips this row on the cron tick.
   * Distinct from delete — lets the user pause a schedule (e.g.
   * during a trip) and re-enable it later without losing the
   * configured cadence or run history.
   */
  enabled: boolean;
  /**
   * ISO datetime of the most recent run (success OR failure). Used
   * for ordering + relative-time labels in the settings UI.
   */
  lastRunAt?: string;
  /**
   * ISO datetime the scheduler will next consider this row. The
   * cron-tick endpoint selects schedules with
   * `enabled = true AND nextRunAt <= now()`.
   */
  nextRunAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Outcome of a single execution of a schedule. Capped at the most
 * recent 50 per schedule on insert so storage doesn't grow unbounded;
 * surfaced in the settings UI's "Recent runs" panel.
 */
export interface EmailScanRun {
  id: string;
  scheduleId: string;
  userId: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "succeeded" | "failed";
  /** Number of emails the connector returned (pre-parse). */
  scannedCount: number;
  /**
   * Number of segments the run actually added to a trip. Drives the
   * "X new items" push body and the banner-pill count.
   */
  newCount: number;
  /** Sentence-form error message when status === "failed". */
  errorMessage?: string;
}
