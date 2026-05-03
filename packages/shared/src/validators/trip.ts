import { z } from "zod";

export const SEGMENT_TYPES = [
  "flight",
  "train",
  "car_rental",
  "car_service",
  "other_transport",
  "hotel",
  "activity",
  "show",
  "restaurant_breakfast",
  "restaurant_brunch",
  "restaurant_lunch",
  "restaurant_dinner",
  "tour",
  "cruise",
] as const;

export const TRIP_STATUSES = [
  "planning",
  "active",
  "completed",
  "cancelled",
] as const;

export const SEGMENT_SOURCES = [
  "manual",
  "email_auto",
  "email_confirmed",
] as const;

export const TODO_CATEGORIES = [
  "meals",
  "activities",
  "research",
  "logistics",
] as const;

export const SHARE_PERMISSIONS = ["view", "edit"] as const;

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
const timeRegex = /^\d{2}:\d{2}(:\d{2})?$/;
const iataRegex = /^[A-Za-z]{3}$/;

/**
 * Zod schema fragment for an IATA airport code. Accepts mixed case so that
 * forms / email parsers can submit "jfk" or "Jfk"; the route handler
 * normalises to upper-case before storing.
 */
const iataAirportSchema = z
  .string()
  .regex(iataRegex, "Must be a 3-letter IATA airport code")
  .transform((s) => s.toUpperCase())
  .optional();

export const segmentCostSchema = z.object({
  amount: z.number().min(0),
  currency: z.string().min(1).max(10),
  details: z.string().optional(),
});

/**
 * Per-day port of call for a cruise. `port` is the destination city for
 * that day; `atSea` marks sea days (no port visit). When `atSea` is true,
 * `port` is normally omitted.
 */
export const cruisePortOfCallSchema = z
  .object({
    date: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD"),
    port: z.string().optional(),
    arrivalTime: z.string().regex(timeRegex, "Must be HH:MM or HH:MM:SS").optional(),
    departureTime: z.string().regex(timeRegex, "Must be HH:MM or HH:MM:SS").optional(),
    atSea: z.boolean().optional(),
  })
  .refine((data) => data.atSea === true || (data.port && data.port.length > 0), {
    message: "port is required unless atSea is true",
    path: ["port"],
  });

export const segmentSchema = z.object({
  id: z.string().min(1),
  type: z.enum(SEGMENT_TYPES),
  title: z.string().min(1),
  startTime: z.string().regex(timeRegex, "Must be HH:MM or HH:MM:SS").optional(),
  endTime: z.string().regex(timeRegex, "Must be HH:MM or HH:MM:SS").optional(),
  venueName: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  url: z.string().url().optional(),
  confirmationCode: z.string().optional(),
  provider: z.string().optional(),
  departureCity: z.string().optional(),
  arrivalCity: z.string().optional(),
  departureAirport: iataAirportSchema,
  arrivalAirport: iataAirportSchema,
  carrier: z.string().optional(),
  routeCode: z.string().optional(),
  coach: z.string().optional(),
  seatNumber: z.string().optional(),
  partySize: z.number().int().min(1).optional(),
  creditCardHold: z.boolean().optional(),
  cancellationDeadline: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD").optional(),
  phone: z.string().optional(),
  endDate: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD").optional(),
  portsOfCall: z.array(cruisePortOfCallSchema).optional(),
  breakfastIncluded: z.boolean().optional(),
  cabinClass: z.string().optional(),
  baggageInfo: z.string().optional(),
  contactName: z.string().optional(),
  cost: segmentCostSchema.optional(),
  calendarEventId: z.string().optional(),
  source: z.enum(SEGMENT_SOURCES),
  sourceEmailId: z.string().optional(),
  needsReview: z.boolean(),
  sortOrder: z.number().int().min(0),
});

export const tripDaySchema = z.object({
  date: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD"),
  dayOfWeek: z.string().min(1).max(3),
  city: z.string().min(1),
  segments: z.array(segmentSchema),
});

export const todoSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  isCompleted: z.boolean(),
  category: z.enum(TODO_CATEGORIES).optional(),
  sortOrder: z.number().int().min(0),
});

export const tripShareSchema = z.object({
  id: z.string().min(1),
  shareToken: z.string().min(1),
  sharedWithEmail: z.string().email().optional(),
  permission: z.enum(SHARE_PERMISSIONS),
  showCosts: z.boolean(),
  showTodos: z.boolean(),
  expiresAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});

export const tripSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  startDate: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD"),
  endDate: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD"),
  status: z.enum(TRIP_STATUSES),
  days: z.array(tripDaySchema),
  todos: z.array(todoSchema),
  shares: z.array(tripShareSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  calendarId: z.string().optional(),
  // Optional in the validator so trips persisted before schema versioning
  // existed still parse cleanly. Code that reads trips should pipe the
  // result through `migrateTrip` to fill this in at v1.
  schemaVersion: z.number().int().positive().optional(),
});

/** Schema for creating a new trip (auto-generates id, dates, etc.) */
export const createTripSchema = z
  .object({
    title: z.string().min(1),
    startDate: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD"),
    endDate: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD"),
  })
  .refine((data) => data.startDate <= data.endDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  });

/** Schema for updating trip metadata */
export const updateTripSchema = z.object({
  title: z.string().min(1).optional(),
  startDate: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD").optional(),
  endDate: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD").optional(),
  status: z.enum(TRIP_STATUSES).optional(),
});

/** Schema for creating a new segment */
export const createSegmentSchema = z.object({
  type: z.enum(SEGMENT_TYPES),
  title: z.string().min(1),
  startTime: z.string().regex(timeRegex, "Must be HH:MM or HH:MM:SS").optional(),
  endTime: z.string().regex(timeRegex, "Must be HH:MM or HH:MM:SS").optional(),
  venueName: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  url: z.string().url().optional(),
  confirmationCode: z.string().optional(),
  provider: z.string().optional(),
  departureCity: z.string().optional(),
  arrivalCity: z.string().optional(),
  departureAirport: iataAirportSchema,
  arrivalAirport: iataAirportSchema,
  carrier: z.string().optional(),
  routeCode: z.string().optional(),
  coach: z.string().optional(),
  partySize: z.number().int().min(1).optional(),
  creditCardHold: z.boolean().optional(),
  endDate: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD").optional(),
  portsOfCall: z.array(cruisePortOfCallSchema).optional(),
  cabinClass: z.string().optional(),
  baggageInfo: z.string().optional(),
  seatNumber: z.string().optional(),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  breakfastIncluded: z.boolean().optional(),
  cost: segmentCostSchema.optional(),
});

/** Schema for updating a segment (all fields optional — partial update) */
export const updateSegmentSchema = createSegmentSchema.extend({
  // Additional fields editable on existing segments (not at creation)
  cancellationDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD").optional(),
  needsReview: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  // Segments are stored inside TripDay, not on the segment itself. Accepting
  // `date` here lets a PUT move a segment to a different day in one call.
  date: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD").optional(),
}).partial();

/** Schema for creating a todo */
export const createTodoSchema = z.object({
  text: z.string().min(1),
  category: z.enum(TODO_CATEGORIES).optional(),
  details: z.string().optional(),
});

/** Schema for updating a todo */
export const updateTodoSchema = z.object({
  text: z.string().min(1).optional(),
  isCompleted: z.boolean().optional(),
  category: z.enum(TODO_CATEGORIES).optional(),
  // Empty string clears the field; the route handler treats `null` and `""`
  // as "remove details" so the user can wipe notes from the edit dialog.
  details: z.string().optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
});

/** Schema for creating a share */
export const createShareSchema = z.object({
  sharedWithEmail: z.string().email().optional(),
  permission: z.enum(SHARE_PERMISSIONS),
  showCosts: z.boolean(),
  showTodos: z.boolean(),
});

/** Schema for user settings */
export const userSettingsSchema = z.object({
  gmailLabelFilter: z.string().optional(),
  emailScanIntervalMinutes: z.number().int().min(5).max(1440),
  notificationsEnabled: z.boolean(),
});

/**
 * Schema for a Web Push subscription payload coming from the browser.
 * Mirrors the shape of `PushSubscription.toJSON()` — what
 * `subscription.toJSON()` returns is exactly `{ endpoint, keys }`.
 */
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const SEGMENT_MATCH_STATUSES = [
  "new",
  "duplicate",
  "enrichment",
  "conflict",
] as const;

export const segmentFieldDiffSchema = z.object({
  field: z.string().min(1),
  existing: z.union([z.string(), z.number(), z.boolean()]).optional(),
  parsed: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export const segmentMatchSchema = z.object({
  status: z.enum(SEGMENT_MATCH_STATUSES),
  existingSegmentId: z.string().optional(),
  existingTripId: z.string().optional(),
  newFields: z.array(z.string()).optional(),
  conflictFields: z.array(segmentFieldDiffSchema).optional(),
});

/** Schema for a segment parsed from email by Claude AI */
export const parsedSegmentSchema = z.object({
  type: z.enum(SEGMENT_TYPES),
  title: z.string().min(1),
  date: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD"),
  startTime: z.string().regex(timeRegex).optional(),
  endTime: z.string().regex(timeRegex).optional(),
  venueName: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  url: z.string().url().optional().or(z.literal("")),
  confirmationCode: z.string().optional(),
  provider: z.string().optional(),
  departureCity: z.string().optional(),
  arrivalCity: z.string().optional(),
  departureAirport: iataAirportSchema,
  arrivalAirport: iataAirportSchema,
  carrier: z.string().optional(),
  routeCode: z.string().optional(),
  coach: z.string().optional(),
  partySize: z.number().int().min(1).optional(),
  creditCardHold: z.boolean().optional(),
  cancellationDeadline: z.string().regex(isoDateRegex).optional(),
  phone: z.string().optional(),
  endDate: z.string().regex(isoDateRegex).optional(),
  portsOfCall: z.array(cruisePortOfCallSchema).optional(),
  breakfastIncluded: z.boolean().optional(),
  seatNumber: z.string().optional(),
  cabinClass: z.string().optional(),
  baggageInfo: z.string().optional(),
  contactName: z.string().optional(),
  cost: segmentCostSchema.optional(),
  confidence: z.enum(["high", "medium", "low"]),
  suggestedTripId: z.string().optional(),
  match: segmentMatchSchema.optional(),
});

/**
 * Schema for importing a raw email (HTML blob or RFC 822 / MIME `.eml`) and
 * running it through the same parser used for Gmail scanning. Unblocks users
 * who have travel confirmations in mailboxes we can't scan directly (e.g.
 * work accounts that don't grant Gmail API access). Exactly one of `html` or
 * `eml` must be provided. When `eml` is used, subject/from/receivedAt are
 * extracted from the MIME headers — the caller may still override them, which
 * takes precedence over the header values.
 */
export const htmlImportRequestSchema = z
  .object({
    /** Raw HTML content of the email (full document or just the body). */
    html: z.string().min(1).optional(),
    /** Raw MIME / RFC 822 source of the email (e.g. contents of a `.eml` file). */
    eml: z.string().min(1).optional(),
    /** Optional subject line from the original email. Overrides EML header. */
    subject: z.string().optional(),
    /** Optional sender address from the original email. Overrides EML header. */
    from: z.string().optional(),
    /**
     * Optional ISO datetime the email was received. Used as the anchor date
     * for year inference. Overrides EML Date header. If omitted (and EML has
     * no Date), falls back to the server's current time.
     */
    receivedAt: z.string().datetime().optional(),
    /**
     * Optional trip hint — when set, all parsed segments are matched against
     * this trip instead of being auto-matched by date range.
     */
    tripId: z.string().optional(),
  })
  .refine((data) => Boolean(data.html) !== Boolean(data.eml), {
    message: "Provide exactly one of `html` or `eml`",
    path: ["html"],
  });

/**
 * Reasons a user can give when reporting that an email wasn't parsed
 * correctly. Kept open enough to cover both auto-scan and HTML/EML
 * imports — the UI surfaces these wherever a parse outcome looks
 * questionable.
 */
export const PARSE_REPORT_REASONS = [
  "failed",            // Parser threw / returned only invalid items
  "no_travel_content", // Parser said "nothing to extract" but user disagrees
  "parsed_wrong",      // Segments were extracted but they're incorrect
] as const;
export type ParseReportReason = (typeof PARSE_REPORT_REASONS)[number];

/**
 * Schema for POST /emails/report. The server uses `emailId` to look up
 * Gmail-scanned emails (and re-fetch the body via the user's access
 * token). For HTML/EML imports we don't store the raw source, so the
 * client passes it inline via `inlineEmail`.
 */
export const emailReportRequestSchema = z.object({
  emailId: z.string().min(1),
  reason: z.enum(PARSE_REPORT_REASONS),
  /** Free-form note from the user about what went wrong. */
  userNote: z.string().max(2000).optional(),
  /** What the user expected the parser to extract. */
  expectedOutcome: z.string().max(2000).optional(),
  /**
   * Inline email content for sources we can't refetch (HTML / EML
   * imports). When omitted the server tries to re-fetch from Gmail.
   */
  inlineEmail: z
    .object({
      subject: z.string().max(1000).optional(),
      from: z.string().max(500).optional(),
      receivedAt: z.string().optional(),
      body: z.string().max(200_000),
    })
    .optional(),
});

/** Schema for triggering an email scan */
export const emailScanRequestSchema = z.object({
  tripId: z.string().optional(),
  labelFilter: z.string().optional(),
  maxResults: z.number().int().min(1).max(500).optional(),
  newerThanDays: z.number().int().min(1).max(730).optional(),
  /**
   * When true, re-parse emails even if they were previously marked as
   * "skipped", "failed", or "parsed". Does not re-parse emails already
   * "mapped" to a trip. Used to recover from stuck state after fixing
   * parser bugs.
   */
  forceRescan: z.boolean().optional(),
});

export const APPLY_ACTIONS = ["create", "merge", "replace"] as const;
export type ApplyAction = (typeof APPLY_ACTIONS)[number];

/**
 * Schema for importing a full trip from an XLSX workbook export. The caller
 * sends a base64-encoded file body; the server decodes, parses, and creates
 * a new trip with all segments in one call.
 */
export const xlsxImportRequestSchema = z.object({
  /** Base64-encoded contents of the .xlsx file */
  fileBase64: z.string().min(1, "fileBase64 is required"),
  /**
   * Optional trip title override. If omitted, the server derives a title
   * from the provided filename (stripping the extension) or falls back to
   * "Imported Trip".
   */
  title: z.string().min(1).optional(),
  /** Original filename, used to derive a trip title if none is supplied */
  filename: z.string().optional(),
});

/** Schema for applying parsed segments to trips */
export const applyParsedSegmentsSchema = z.object({
  segments: z.array(
    parsedSegmentSchema.extend({
      tripId: z.string().min(1),
      emailId: z.string().min(1),
      /** How to apply: create new (default), merge into existing, or replace existing */
      action: z.enum(APPLY_ACTIONS).optional(),
      /** Required when action is merge or replace */
      existingSegmentId: z.string().optional(),
    }),
  ).min(1),
});

export type CreateTripInput = z.infer<typeof createTripSchema>;
export type UpdateTripInput = z.infer<typeof updateTripSchema>;
export type CreateSegmentInput = z.infer<typeof createSegmentSchema>;
export type UpdateSegmentInput = z.infer<typeof updateSegmentSchema>;
export type CreateTodoInput = z.infer<typeof createTodoSchema>;
export type UpdateTodoInput = z.infer<typeof updateTodoSchema>;
export type CreateShareInput = z.infer<typeof createShareSchema>;
export type EmailScanRequest = z.infer<typeof emailScanRequestSchema>;
export type HtmlImportRequest = z.infer<typeof htmlImportRequestSchema>;
export type EmailReportRequest = z.infer<typeof emailReportRequestSchema>;
export type ApplyParsedSegmentsInput = z.infer<typeof applyParsedSegmentsSchema>;
export type XlsxImportRequest = z.infer<typeof xlsxImportRequestSchema>;
