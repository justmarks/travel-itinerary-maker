/**
 * Phase 4: calendar update path preserves unmodified fields.
 *
 * Both Google Calendar and Microsoft Graph implement PATCH with
 * partial-update semantics — any field NOT in the request body is
 * preserved server-side. The user-facing implication: if a calendar
 * user adds attendees or sets a custom reminder via the calendar app
 * directly, our segment-sync re-runs shouldn't clobber that input
 * for any field WE don't explicitly send.
 *
 * Our connectors don't track "which fields changed on the segment
 * since the last sync" — they re-serialise the whole segment to a
 * provider event on every run. So "preserves unmodified" reduces to:
 *
 *  1. The update payload only contains fields the segment model
 *     represents (subject, body, location, start/end, all-day flag,
 *     and the metadata we own). Fields outside our model (attendees
 *     a user added themselves, custom reminders, color, etc.) are
 *     absent → Graph / Google's partial-update semantics preserve
 *     them server-side.
 *
 *  2. Re-syncing the SAME segment produces an IDENTICAL update
 *     payload. No payload drift between runs means no surprise
 *     clobbers on repeated sync.
 *
 * Scope: Microsoft side (`MicrosoftCalendarConnector`) gets a direct
 * `fetch`-body assertion via the existing global.fetch mock pattern.
 * The Google side's update payload is the output of `segmentToEvent`
 * — we lock that via the same idempotency assertion (re-calling with
 * the same segment yields the same payload).
 */

import type { Segment, Trip, TripDay } from "@travel-app/shared";
import { segmentToEvent } from "../../src/services/google-calendar";
import { MicrosoftCalendarConnector } from "../../src/connectors/microsoft-calendar-connector";

type FetchMock = jest.Mock<Promise<Response>, [string | URL, RequestInit?]>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: "seg-1",
    type: "restaurant_dinner",
    title: "Sushi",
    startTime: "19:00",
    endTime: "21:00",
    city: "Tokyo",
    source: "manual",
    needsReview: false,
    sortOrder: 0,
    ...overrides,
  };
}

function makeDay(overrides: Partial<TripDay> = {}): TripDay {
  return {
    date: "2026-06-10",
    dayOfWeek: "Wed",
    city: "Tokyo",
    segments: [],
    ...overrides,
  };
}

function makeTrip(segment: Segment, day: TripDay): Trip {
  return {
    id: "trip-1",
    title: "Test Trip",
    startDate: "2026-06-10",
    endDate: "2026-06-12",
    status: "planning",
    days: [{ ...day, segments: [segment] }],
    todos: [],
    shares: [],
    history: [],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    schemaVersion: 1,
  };
}

describe("Calendar update path: preserves unmodified fields", () => {
  describe("MicrosoftCalendarConnector PATCH body shape", () => {
    let fetchMock: FetchMock;

    beforeEach(() => {
      fetchMock = jest.fn() as FetchMock;
      global.fetch = fetchMock as unknown as typeof fetch;
    });

    it("PATCH body contains only the fields our segment model owns", async () => {
      // Synced segment → connector takes the update path. Captures
      // the request body sent to Graph and asserts its key set —
      // anything outside the segment model is absent so Graph's
      // partial-update preserves it server-side.
      const segment = makeSegment({ calendarEventId: "ms-existing-1" });
      const day = makeDay();
      const trip = makeTrip(segment, day);

      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { id: "ms-existing-1", subject: "Sushi" }),
      );

      const connector = new MicrosoftCalendarConnector("token");
      await connector.syncTrip(trip, "primary", "user@example.com");

      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;

      // Allow-list: keys we EXPECT in the PATCH body. Anything we
      // don't list here is something we DON'T send → Graph preserves
      // it server-side. If a future commit adds a new field we
      // intentionally write, append it here.
      const allowedKeys = new Set([
        "subject",
        "body",
        "location",
        "start",
        "end",
        "isAllDay",
        "reminderMinutesBeforeStart",
        "singleValueExtendedProperties",
        "attendees", // present only when userEmail is passed; sized to 1.
      ]);
      for (const key of Object.keys(body)) {
        expect(allowedKeys.has(key)).toBe(true);
      }

      // Spot-check that we explicitly DON'T send fields commonly
      // mutated by the user in Outlook — Graph's partial-update keeps
      // these unmodified.
      const userOwnedFields = [
        "categories",
        "importance",
        "sensitivity",
        "showAs",
        "isReminderOn",
      ];
      for (const key of userOwnedFields) {
        expect(body).not.toHaveProperty(key);
      }
    });

    it("PATCH method is used (not POST), so Graph's partial-update semantics apply", async () => {
      const segment = makeSegment({ calendarEventId: "ms-existing-1" });
      const day = makeDay();
      const trip = makeTrip(segment, day);

      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { id: "ms-existing-1" }),
      );

      const connector = new MicrosoftCalendarConnector("token");
      await connector.syncTrip(trip, "primary");

      const [, init] = fetchMock.mock.calls[0];
      expect(init?.method).toBe("PATCH");
    });

    it("re-syncing the SAME segment produces an IDENTICAL PATCH body (no payload drift)", async () => {
      // Determinism: the segment → event mapping has no clock-
      // dependent or random parts. Re-running sync on an unchanged
      // segment must yield byte-identical bodies so a user who
      // hasn't touched the trip doesn't see Outlook's modification
      // timestamp bump on every sync.
      const segment = makeSegment({ calendarEventId: "ms-existing-1" });
      const day = makeDay();
      const trip = makeTrip(segment, day);

      fetchMock.mockResolvedValue(jsonResponse(200, { id: "ms-existing-1" }));

      const connector = new MicrosoftCalendarConnector("token");
      await connector.syncTrip(trip, "primary", "user@example.com");
      await connector.syncTrip(trip, "primary", "user@example.com");

      const firstBody = fetchMock.mock.calls[0][1]?.body as string;
      const secondBody = fetchMock.mock.calls[1][1]?.body as string;
      expect(firstBody).toBe(secondBody);
    });
  });

  describe("Google segmentToEvent payload determinism", () => {
    it("re-deriving the event payload from the same segment yields a strictly-equal object", async () => {
      // Google's update path calls `events.patch` with the result of
      // `segmentToEvent`. Locking this conversion as deterministic
      // means re-syncing an unchanged segment doesn't churn the
      // Calendar event's `etag` for cosmetic reasons.
      const segment = makeSegment({ calendarEventId: "gcal-existing-1" });
      const day = makeDay();

      const a = segmentToEvent(segment, day, "Trip");
      const b = segmentToEvent(segment, day, "Trip");
      expect(a).toEqual(b);
    });

    it("extended-properties on segmentToEvent carry segmentId (tripId is stamped later by syncTripToCalendar)", async () => {
      // `segmentId` is set by `segmentToEvent` itself; `tripId` is
      // intentionally left blank for the caller to fill in because
      // the function takes a segment + day + tripTitle (no trip
      // object). `syncTripToCalendar` patches `tripId` onto every
      // event before dispatching the API call (see
      // services/google-calendar.ts#L510). This test locks the
      // segmentId stamp — the half of the orphan-recovery contract
      // owned by `segmentToEvent`.
      const segment = makeSegment({ calendarEventId: "gcal-existing-1" });
      const day = makeDay();

      const event = segmentToEvent(segment, day, "Trip");

      const props = event.extendedProperties?.private ?? {};
      expect(props.segmentId).toBe(segment.id);
      // `tripId` is present as an empty string sentinel — the
      // caller fills it in. Asserting the KEY is here protects
      // against a future change that removes it from the schema.
      expect(props).toHaveProperty("tripId");
    });
  });
});
