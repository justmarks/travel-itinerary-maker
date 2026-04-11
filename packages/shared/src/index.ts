// Types
export type {
  Trip,
  TripDay,
  Segment,
  SegmentCost,
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

// Validators
export {
  tripSchema,
  segmentSchema,
  tripDaySchema,
  todoSchema,
  tripShareSchema,
  segmentCostSchema,
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
  ApplyParsedSegmentsInput,
  ApplyAction,
  XlsxImportRequest,
} from "./validators/trip";

// Utilities
export {
  getDayOfWeek,
  generateDateRange,
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
export { formatFlightLabel } from "./utils/segments";
export { tripToMarkdown } from "./utils/markdown";
export { tripToOneNoteHtml } from "./utils/onenote";
