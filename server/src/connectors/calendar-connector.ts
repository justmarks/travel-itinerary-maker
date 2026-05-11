/**
 * Provider-agnostic calendar API surface. Phase 4a of the
 * Drive→Supabase migration: the foundation for swapping Google
 * Calendar out for Microsoft Graph (or any future provider) without
 * touching route handlers.
 *
 * Implementations today:
 *   - `GoogleCalendarConnector` — wraps the existing
 *     `services/google-calendar.ts` functions. Behaviour-identical to
 *     the pre-refactor code path.
 *
 * Coming in Phase 4b:
 *   - `MicrosoftCalendarConnector` — `/me/events` create/update/delete
 *     via Microsoft Graph.
 *
 * The interface intentionally returns shapes already used by the
 * existing route code (`CalendarSyncResult`, `CalendarUnsyncResult`,
 * `CalendarEntry`). Microsoft's API responses get adapted INTO these
 * shapes at the connector boundary, not at the route handler — so
 * route code stays provider-agnostic.
 */

import type { Trip, TripDay, Segment } from "@travel-app/shared";
import type {
  CalendarEntry,
  CalendarSyncResult,
  CalendarUnsyncResult,
} from "../services/google-calendar";

export type {
  CalendarEntry,
  CalendarSyncResult,
  CalendarUnsyncResult,
} from "../services/google-calendar";

/**
 * Result of a single-segment sync. Distinct from `CalendarSyncResult`
 * because the trip-wide sync returns a `segmentId → eventId` map,
 * whereas the single-segment path returns the one event ID directly.
 * The shape matches what `syncSegmentToCalendar` already returns —
 * route handlers consume it as-is.
 */
export interface SegmentSyncResult {
  created: number;
  updated: number;
  failed: number;
  eventId?: string;
}

export interface CalendarConnector {
  /**
   * Lists the user's calendars on this provider. The "primary"
   * boolean on each entry identifies the default calendar the
   * provider considers canonical for the user.
   */
  listCalendars(): Promise<CalendarEntry[]>;

  /**
   * Creates/updates events for every segment in the trip on
   * `calendarId`. Returns counts + a `segmentId → eventId` map so the
   * caller can persist event IDs for incremental sync next time.
   *
   * `userEmail` is forwarded into the connector's log lines so a single
   * user's sync run is greppable in Railway logs.
   */
  syncTrip(
    trip: Trip,
    calendarId: string,
    userEmail?: string,
  ): Promise<CalendarSyncResult>;

  /**
   * Creates/updates a single segment's event. Used by the
   * incremental-sync path that fires when a segment is created or
   * updated and the trip is already calendar-synced.
   */
  syncSegment(
    trip: Trip,
    day: TripDay,
    segment: Segment,
    calendarId: string,
    userEmail?: string,
  ): Promise<SegmentSyncResult>;

  /**
   * Removes every event for the trip from `calendarId`. Used when
   * the user disconnects calendar sync for a trip.
   */
  unsyncTrip(
    trip: Trip,
    calendarId: string,
    userEmail?: string,
  ): Promise<CalendarUnsyncResult>;
}
