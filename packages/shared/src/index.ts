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
  createTodoSchema,
  updateTodoSchema,
  createShareSchema,
  userSettingsSchema,
  SEGMENT_TYPES,
  TRIP_STATUSES,
  SEGMENT_SOURCES,
  TODO_CATEGORIES,
  SHARE_PERMISSIONS,
} from "./validators/trip";

export type {
  CreateTripInput,
  UpdateTripInput,
  CreateSegmentInput,
  CreateTodoInput,
  UpdateTodoInput,
  CreateShareInput,
} from "./validators/trip";

// Utilities
export { getDayOfWeek, generateDateRange, isDateInRange } from "./utils/dates";
export { formatCurrency, getCurrencySymbol, sumByCurrency } from "./utils/currency";
export { generateId } from "./utils/ids";
export { tripToMarkdown } from "./utils/markdown";
