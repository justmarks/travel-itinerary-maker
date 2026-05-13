/**
 * Shared contract test suite for `CalendarConnector` implementations.
 * Phase 4 of the migration plan: every concrete connector (Google
 * Calendar, Microsoft Graph, future) must pass these scenarios so
 * a Google-only change can't silently break Outlook (or vice versa).
 *
 * Scope:
 *  - Exports `runCalendarConnectorContractTests`; per-impl
 *    `.contract.test.ts` files supply a harness that wires up
 *    impl-specific mocks and provides shape-level stubs.
 *  - Assertions are shape-level (entry has id/summary, sync result
 *    has the right counts + eventMap, etc.). Wire-level behaviour
 *    (per-segment create/update/timezone wire format, orphan
 *    recovery) stays in each impl's own test file.
 *  - The trip-shaped scenarios use a trip with NO days, so the
 *    sync/unsync paths don't fan out to per-segment HTTP calls.
 *    Per-segment behaviour is part of the per-impl tests; the
 *    contract just locks the public surface.
 */

import type {
  CalendarConnector,
  CalendarEntry,
} from "../../../src/connectors/calendar-connector";
import type { Trip } from "@travel-app/shared";

export interface CalendarConnectorTestHarness {
  connector: CalendarConnector;
  /** Configure the next `connector.listCalendars()` to resolve with `entries`. */
  stubCalendars: (entries: CalendarEntry[]) => void;
}

/**
 * Trip with zero days — every concrete connector resolves an
 * empty-trip sync/unsync without making any provider HTTP calls,
 * so the contract can run these scenarios without per-segment stubs.
 */
export function emptyTrip(overrides: Partial<Trip> = {}): Trip {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id: "trip-contract",
    title: "Contract Trip",
    startDate: "2026-06-01",
    endDate: "2026-06-02",
    status: "planning",
    days: [],
    todos: [],
    shares: [],
    history: [],
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
    ...overrides,
  };
}

export function runCalendarConnectorContractTests(
  name: string,
  makeHarness: () => CalendarConnectorTestHarness,
): void {
  describe(`CalendarConnector contract: ${name}`, () => {
    describe("listCalendars", () => {
      it("returns the calendars reported by the provider", async () => {
        const harness = makeHarness();
        harness.stubCalendars([
          { id: "primary", summary: "Personal", primary: true },
          { id: "work-cal", summary: "Work", primary: false },
        ]);

        const result = await harness.connector.listCalendars();
        expect(result.length).toBe(2);
      });

      it("returns entries with the CalendarEntry shape", async () => {
        const harness = makeHarness();
        harness.stubCalendars([
          { id: "primary", summary: "Personal", primary: true },
        ]);

        const result = await harness.connector.listCalendars();
        for (const entry of result) {
          expect(typeof entry.id).toBe("string");
          expect(entry.id.length).toBeGreaterThan(0);
          expect(typeof entry.summary).toBe("string");
          expect(entry.summary.length).toBeGreaterThan(0);
          expect(typeof entry.primary).toBe("boolean");
        }
      });

      it("returns an empty array when the provider has no calendars", async () => {
        const harness = makeHarness();
        harness.stubCalendars([]);

        const result = await harness.connector.listCalendars();
        expect(result).toEqual([]);
      });
    });

    describe("syncTrip", () => {
      it("returns a zero-count CalendarSyncResult for a trip with no days", async () => {
        const harness = makeHarness();
        const trip = emptyTrip();

        const result = await harness.connector.syncTrip(trip, "primary");
        expect(result).toMatchObject({
          created: 0,
          updated: 0,
          failed: 0,
          calendarId: "primary",
        });
        expect(result.eventMap).toEqual({});
      });

      it("echoes the calendarId the caller passed in", async () => {
        const harness = makeHarness();
        const trip = emptyTrip();

        const result = await harness.connector.syncTrip(trip, "my-target-cal");
        expect(result.calendarId).toBe("my-target-cal");
      });
    });

    describe("unsyncTrip", () => {
      it("returns a zero-count CalendarUnsyncResult for a trip with no days", async () => {
        const harness = makeHarness();
        const trip = emptyTrip();

        const result = await harness.connector.unsyncTrip(trip, "primary");
        expect(result).toEqual({ removed: 0, failed: 0 });
      });
    });
  });
}
