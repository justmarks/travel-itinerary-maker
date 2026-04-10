import { z } from "zod";

export const SEGMENT_TYPES = [
  "flight",
  "train",
  "car_rental",
  "car_service",
  "other_transport",
  "hotel",
  "activity",
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
  "archived",
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

export const segmentCostSchema = z.object({
  amount: z.number().min(0),
  currency: z.string().min(1).max(10),
  details: z.string().optional(),
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
  carrier: z.string().optional(),
  routeCode: z.string().optional(),
  partySize: z.number().int().min(1).optional(),
  creditCardHold: z.boolean().optional(),
  endDate: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD").optional(),
  cabinClass: z.string().optional(),
  baggageInfo: z.string().optional(),
  cost: segmentCostSchema.optional(),
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
  carrier: z.string().optional(),
  routeCode: z.string().optional(),
  partySize: z.number().int().min(1).optional(),
  creditCardHold: z.boolean().optional(),
  endDate: z.string().regex(isoDateRegex, "Must be YYYY-MM-DD").optional(),
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
}).partial();

/** Schema for creating a todo */
export const createTodoSchema = z.object({
  text: z.string().min(1),
  category: z.enum(TODO_CATEGORIES).optional(),
});

/** Schema for updating a todo */
export const updateTodoSchema = z.object({
  text: z.string().min(1).optional(),
  isCompleted: z.boolean().optional(),
  category: z.enum(TODO_CATEGORIES).optional(),
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
  carrier: z.string().optional(),
  routeCode: z.string().optional(),
  partySize: z.number().int().min(1).optional(),
  creditCardHold: z.boolean().optional(),
  cancellationDeadline: z.string().regex(isoDateRegex).optional(),
  phone: z.string().optional(),
  endDate: z.string().regex(isoDateRegex).optional(),
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

/** Schema for triggering an email scan */
export const emailScanRequestSchema = z.object({
  tripId: z.string().optional(),
  labelFilter: z.string().optional(),
  maxResults: z.number().int().min(1).max(100).optional(),
  newerThanDays: z.number().int().min(1).max(730).optional(),
});

export const APPLY_ACTIONS = ["create", "merge", "replace"] as const;
export type ApplyAction = (typeof APPLY_ACTIONS)[number];

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
export type ApplyParsedSegmentsInput = z.infer<typeof applyParsedSegmentsSchema>;
