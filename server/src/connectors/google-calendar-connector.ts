/**
 * Google Calendar implementation of `CalendarConnector`. Thin wrapper
 * around the existing free functions in `services/google-calendar.ts`
 * — created during Phase 4a so route handlers can target the
 * provider-agnostic interface without behavioural drift.
 *
 * The constructor takes the access token directly; the resolver
 * (`resolve.ts`) is where the legacy `req.accessToken` → token-string
 * mapping lives. Future improvement: take a `getAccessToken` callback
 * that refreshes from the `connections` row's encrypted refresh
 * token, so token expiry is handled inside the connector rather than
 * at the route layer.
 */

import {
  listUserCalendars,
  syncTripToCalendar,
  syncSegmentToCalendar,
  unsyncTripFromCalendar,
} from "../services/google-calendar";
import type {
  CalendarConnector,
  CalendarEntry,
  CalendarSyncResult,
  CalendarUnsyncResult,
  SegmentSyncResult,
} from "./calendar-connector";
import type { Trip, TripDay, Segment } from "@itinly/shared";

export class GoogleCalendarConnector implements CalendarConnector {
  constructor(private readonly accessToken: string) {}

  listCalendars(): Promise<CalendarEntry[]> {
    return listUserCalendars(this.accessToken);
  }

  syncTrip(
    trip: Trip,
    calendarId: string,
    userEmail?: string,
  ): Promise<CalendarSyncResult> {
    return syncTripToCalendar(this.accessToken, trip, calendarId, userEmail);
  }

  syncSegment(
    trip: Trip,
    day: TripDay,
    segment: Segment,
    calendarId: string,
    userEmail?: string,
  ): Promise<SegmentSyncResult> {
    return syncSegmentToCalendar(
      this.accessToken,
      trip,
      day,
      segment,
      calendarId,
      userEmail,
    );
  }

  unsyncTrip(
    trip: Trip,
    calendarId: string,
    userEmail?: string,
  ): Promise<CalendarUnsyncResult> {
    return unsyncTripFromCalendar(
      this.accessToken,
      trip,
      calendarId,
      userEmail,
    );
  }
}
