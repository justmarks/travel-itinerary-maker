// Types
export type {
  Trip,
  TripDay,
  Segment,
  SegmentCost,
  CruisePortOfCall,
  Todo,
  TripShare,
  TripShareRule,
  TripStatus,
  SegmentType,
  SegmentSource,
  TodoCategory,
  SharePermission,
  UserSettings,
  PushSubscription,
  CostSummary,
  CostSummaryItem,
  ParsedSegment,
  SegmentMatch,
  SegmentMatchStatus,
  SegmentFieldDiff,
  EmailScanResult,
  EmailScanFrequency,
  EmailScanSchedule,
  EmailScanRun,
  TripUserCalendarSync,
  GmailLabel,
  TripHistoryEntry,
  TripHistoryActor,
  TripHistoryKind,
} from "./types/trip";
export { CURRENT_TRIP_SCHEMA_VERSION } from "./types/trip";

// Validators
export {
  tripSchema,
  segmentSchema,
  tripDaySchema,
  todoSchema,
  tripShareSchema,
  tripShareRuleSchema,
  segmentCostSchema,
  cruisePortOfCallSchema,
  createTripSchema,
  updateTripSchema,
  createSegmentSchema,
  updateSegmentSchema,
  createTodoSchema,
  updateTodoSchema,
  createShareSchema,
  createShareRuleSchema,
  updateShareRuleSchema,
  userSettingsSchema,
  pushSubscriptionSchema,
  parsedSegmentSchema,
  segmentMatchSchema,
  segmentFieldDiffSchema,
  tripHistoryEntrySchema,
  emailScanRequestSchema,
  htmlImportRequestSchema,
  importSharedRequestSchema,
  applyParsedSegmentsSchema,
  xlsxImportRequestSchema,
  createEmailScanScheduleSchema,
  updateEmailScanScheduleSchema,
  EMAIL_SCAN_FREQUENCIES,
  SEGMENT_TYPES,
  TRIP_STATUSES,
  SEGMENT_SOURCES,
  TODO_CATEGORIES,
  SHARE_PERMISSIONS,
  SEGMENT_MATCH_STATUSES,
  APPLY_ACTIONS,
  PARSE_REPORT_REASONS,
  TRIP_HISTORY_KINDS,
} from "./validators/trip";

export type {
  CreateTripInput,
  UpdateTripInput,
  CreateSegmentInput,
  UpdateSegmentInput,
  CreateTodoInput,
  UpdateTodoInput,
  CreateShareInput,
  CreateShareRuleInput,
  UpdateShareRuleInput,
  PushSubscriptionInput,
  EmailScanRequest,
  HtmlImportRequest,
  ImportSharedRequest,
  ParseReportReason,
  ApplyParsedSegmentsInput,
  ApplyAction,
  XlsxImportRequest,
  CreateEmailScanScheduleInput,
  UpdateEmailScanScheduleInput,
} from "./validators/trip";

// Utilities
export {
  getDayOfWeek,
  generateDateRange,
  addDays,
  isDateInRange,
  dateRangesOverlap,
  findOverlappingTrips,
  formatTripDateRange,
} from "./utils/dates";
export type { DateRange } from "./utils/dates";
export {
  formatCurrency,
  getCurrencySymbol,
  sumByCurrency,
  convertToUsd,
  hasUsdRate,
} from "./utils/currency";
export { generateId } from "./utils/ids";
export { migrateTrip } from "./utils/migrations";
export { appendTripHistory, TRIP_HISTORY_MAX_ENTRIES } from "./utils/trip-history";
export {
  formatFlightLabel,
  formatFlightEndpoint,
  applyCruisePortsToDayCities,
} from "./utils/segments";
export { tripToMarkdown } from "./utils/markdown";
export { tripToOneNoteHtml } from "./utils/onenote";
export {
  suggestMealTodos,
  dedupeAgainstExistingTodos,
} from "./utils/meal-suggester";
export type { MealSuggestion } from "./utils/meal-suggester";
export { tripToIcal } from "./utils/ical-generator";
export { getCityTimezone, preloadCityTimezone } from "./utils/city-timezone";
export {
  primaryLocationFor,
  tripDestinationCities,
} from "./utils/primary-location";
export type { PrimaryLocation } from "./utils/primary-location";
export {
  lookupAirport,
  getAirportTimezone,
  formatAirportLabel,
  searchAirports,
} from "./utils/airport-lookup";
export type { AirportInfo } from "./utils/airport-lookup";
export {
  proposeNewTrips,
  NEW_TRIP_PREFIX,
} from "./utils/new-trip-proposals";
export type { NewTripProposal } from "./utils/new-trip-proposals";
export {
  SEGMENT_LABELS,
  SEGMENT_TOKEN_FAMILY,
  costCategoryLabel,
} from "./segment-config";

export { sortByPrimaryEmail } from "./utils/sort-by-primary-email";
