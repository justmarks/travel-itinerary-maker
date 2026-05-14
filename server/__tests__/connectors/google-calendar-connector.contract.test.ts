/**
 * Runs the shared `CalendarConnector` contract scenarios against
 * `GoogleCalendarConnector`. The connector is a thin wrapper over
 * functions in `services/google-calendar`; we mock those so the
 * harness can serve canned data without hitting Google's API.
 *
 * Detailed wire-level behaviour (per-segment event upsert, timezone
 * derivation from IATA, orphan recovery) stays covered by the
 * existing service-level + route tests.
 */

import * as googleCalendar from "../../src/services/google-calendar";
import { GoogleCalendarConnector } from "../../src/connectors/google-calendar-connector";
import type { CalendarEntry } from "../../src/connectors/calendar-connector";
import {
  runCalendarConnectorContractTests,
  type CalendarConnectorTestHarness,
} from "./contract/calendar-connector-contract";

jest.mock("../../src/services/google-calendar", () => {
  const actual = jest.requireActual("../../src/services/google-calendar");
  return {
    ...actual,
    // Replace the four service functions the connector calls into.
    listUserCalendars: jest.fn(),
    syncTripToCalendar: jest.fn(),
    syncSegmentToCalendar: jest.fn(),
    unsyncTripFromCalendar: jest.fn(),
  };
});

function makeHarness(): CalendarConnectorTestHarness {
  // Reset per-test queues + implementations so the previous test's
  // canned response can't leak.
  (googleCalendar.listUserCalendars as jest.Mock).mockReset();
  (googleCalendar.syncTripToCalendar as jest.Mock).mockReset();
  (googleCalendar.syncSegmentToCalendar as jest.Mock).mockReset();
  (googleCalendar.unsyncTripFromCalendar as jest.Mock).mockReset();

  // Default impls for the trip-shaped scenarios (`syncTrip` /
  // `unsyncTrip`) so the contract's "trip with no days" cases produce
  // zero counts without requiring per-test stubs. The MS impl
  // accomplishes the same thing by making zero HTTP calls when
  // `trip.days` is empty — we mirror that observed behaviour here.
  (googleCalendar.syncTripToCalendar as jest.Mock).mockImplementation(
    async (_token: string, _trip: unknown, calendarId: string) => ({
      created: 0,
      updated: 0,
      failed: 0,
      calendarId,
      eventMap: {},
    }),
  );
  (googleCalendar.unsyncTripFromCalendar as jest.Mock).mockImplementation(
    async () => ({ removed: 0, failed: 0 }),
  );

  return {
    connector: new GoogleCalendarConnector("google-cal-token"),
    stubCalendars(entries: CalendarEntry[]) {
      (googleCalendar.listUserCalendars as jest.Mock).mockResolvedValueOnce(
        entries,
      );
    },
  };
}

runCalendarConnectorContractTests("GoogleCalendarConnector", makeHarness);
