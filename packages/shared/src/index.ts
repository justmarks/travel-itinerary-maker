// Types
export type {
  Trip,
  TripDay,
  Segment,
  SegmentCost,
  CruisePortOfCall,
  Todo,
  TripShare,
  TripStatus,
  SegmentType,
  SegmentSource,
  TodoCategory,
  SharePermission,
  UserSettings,
  CostSummary,
  CostSummaryItem,
  ParsedSegment,
  SegmentMatch,
  SegmentMatchStatus,
  SegmentFieldDiff,
  EmailScanResult,
  GmailLabel,
} from "./types/trip";
export { CURRENT_TRIP_SCHEMA_VERSION } from "./types/trip";

// Validators
export {
  tripSchema,
  segmentSchema,
  tripDaySchema,
  todoSchema,
  tripShareSchema,
  segmentCostSchema,
  cruisePortOfCallSchema,
  createTripSchema,
  updateTripSchema,
  createSegmentSchema,
  updateSegmentSchema,
  createTodoSchema,
  updateTodoSchema,
  createShareSchema,
  userSettingsSchema,
  parsedSegmentSchema,
  segmentMatchSchema,
  segmentFieldDiffSchema,
  emailScanRequestSchema,
  htmlImportRequestSchema,
  applyParsedSegmentsSchema,
  xlsxImportRequestSchema,
  SEGMENT_TYPES,
  TRIP_STATUSES,
  SEGMENT_SOURCES,
  TODO_CATEGORIES,
  SHARE_PERMISSIONS,
  SEGMENT_MATCH_STATUSES,
  APPLY_ACTIONS,
} from "./validators/trip";

export type {
  CreateTripInput,
  UpdateTripInput,
  CreateSegmentInput,
  UpdateSegmentInput,
  CreateTodoInput,
  UpdateTodoInput,
  CreateShareInput,
  EmailScanRequest,
  HtmlImportRequest,
  ApplyParsedSegmentsInput,
  ApplyAction,
  XlsxImportRequest,
} from "./validators/trip";

// Utilities
export {
  getDayOfWeek,
  generateDateRange,
  addDays,
  isDateInRange,
  dateRangesOverlap,
  findOverlappingTrips,
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
export { primaryLocationFor } from "./utils/primary-location";
export type { PrimaryLocation } from "./utils/primary-location";
export {
  lookupAirport,
  getAirportTimezone,
  formatAirportLabel,
  searchAirports,
} from "./utils/airport-lookup";
export type { AirportInfo } from "./utils/airport-lookup";
