export type TripStatus = "planning" | "active" | "completed" | "archived";

export type SegmentType =
  | "flight"
  | "train"
  | "car_rental"
  | "car_service"
  | "other_transport"
  | "hotel"
  | "activity"
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
  // Dining-specific
  partySize?: number;
  creditCardHold?: boolean;
  cancellationDeadline?: string; // ISO date "YYYY-MM-DD" — when CC hold must be cancelled by
  phone?: string;
  // Hotel-specific
  endDate?: string; // Check-out date for hotels (YYYY-MM-DD)
  breakfastIncluded?: boolean;
  // Flight-specific
  seatNumber?: string; // e.g. "14A, 14B"
  cabinClass?: string; // e.g. "Economy", "Business", "First", "Premium Economy"
  baggageInfo?: string; // e.g. "1 checked bag included", "No checked bags - $35/bag"
  // Car service specific
  contactName?: string; // driver / pickup contact name
  // Cost embedded in segment
  cost?: SegmentCost;
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
  amount: number;
  currency: string;
  details?: string;
  segmentId: string;
}

export interface CostSummary {
  items: CostSummaryItem[];
  totalsByCurrency: Record<string, number>;
  totalUsd?: number;
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
  partySize?: number;
  creditCardHold?: boolean;
  cancellationDeadline?: string;
  phone?: string;
  endDate?: string;
  breakfastIncluded?: boolean;
  seatNumber?: string;
  cabinClass?: string;
  baggageInfo?: string;
  contactName?: string;
  cost?: SegmentCost;
  confidence: "high" | "medium" | "low";
  suggestedTripId?: string;
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
