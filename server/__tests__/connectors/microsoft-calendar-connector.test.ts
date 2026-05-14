/**
 * Tests for `MicrosoftCalendarConnector`. Uses a mocked `global.fetch`
 * so the suite never hits real Microsoft Graph endpoints. Each test
 * inspects what the connector requested (URL, method, body) and
 * controls what fetch resolves to.
 *
 * Coverage matches the public interface:
 *  - `listCalendars` reads from `/me/calendars` + pagination
 *  - `syncTrip` creates events for un-synced segments, PATCHes
 *    events for synced segments, recreates on 404
 *  - `syncSegment` create + update paths
 *  - `unsyncTrip` deletes tracked events, treats 404 as success
 *  - `googleEventToMsEvent` translation: all-day vs timed,
 *    extended properties, attendees
 */

import { MicrosoftCalendarConnector, googleEventToMsEvent } from "../../src/connectors/microsoft-calendar-connector";
import type { Trip } from "@itinly/shared";

type FetchMock = jest.Mock<Promise<Response>, [string | URL, RequestInit?]>;

function makeJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeNoContentResponse(): Response {
  return new Response(null, { status: 204 });
}

const ACCESS_TOKEN = "ms-graph-token-abc";

// Minimal trip + segment fixtures. Mirrors shape used by the existing
// google-calendar tests so the segmentToEvent translation has real
// inputs.
const TRIP: Trip = {
  id: "trip-1",
  userId: "user-1",
  title: "Test Trip",
  startDate: "2026-06-10",
  endDate: "2026-06-12",
  status: "confirmed",
  days: [
    {
      date: "2026-06-10",
      city: "Tokyo",
      segments: [
        {
          id: "seg-1",
          type: "dinner",
          title: "Sushi",
          startTime: "19:00",
          endTime: "21:00",
          city: "Tokyo",
        },
      ],
    },
  ],
  todos: [],
  createdAt: "2026-06-01T00:00:00Z",
  updatedAt: "2026-06-01T00:00:00Z",
};

const TRIP_WITH_SYNCED_SEGMENT: Trip = {
  ...TRIP,
  days: [
    {
      ...TRIP.days[0],
      segments: [
        {
          ...TRIP.days[0].segments[0],
          calendarEventId: "ms-event-existing",
        },
      ],
    },
  ],
};

describe("MicrosoftCalendarConnector", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = jest.fn() as FetchMock;
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  describe("listCalendars", () => {
    it("fetches /me/calendars and maps the response", async () => {
      fetchMock.mockResolvedValueOnce(
        makeJsonResponse(200, {
          value: [
            { id: "cal-1", name: "Calendar", isDefaultCalendar: true },
            { id: "cal-2", name: "Work", isDefaultCalendar: false },
          ],
        }),
      );

      const conn = new MicrosoftCalendarConnector(ACCESS_TOKEN);
      const cals = await conn.listCalendars();

      expect(cals).toEqual([
        { id: "cal-1", summary: "Calendar", primary: true },
        { id: "cal-2", summary: "Work", primary: false },
      ]);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url.toString()).toContain("/me/calendars");
      // URLSearchParams encodes `$` as `%24` — the OData query token is
      // still valid; Graph parses `%24select` and `$select` identically.
      expect(url.toString()).toContain("%24select=id%2Cname%2CisDefaultCalendar");
      expect(init?.headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      });
    });

    it("follows @odata.nextLink across pages", async () => {
      fetchMock
        .mockResolvedValueOnce(
          makeJsonResponse(200, {
            value: [{ id: "cal-1", name: "A", isDefaultCalendar: true }],
            "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendars?$skip=1",
          }),
        )
        .mockResolvedValueOnce(
          makeJsonResponse(200, {
            value: [{ id: "cal-2", name: "B", isDefaultCalendar: false }],
          }),
        );

      const conn = new MicrosoftCalendarConnector(ACCESS_TOKEN);
      const cals = await conn.listCalendars();

      expect(cals).toHaveLength(2);
      expect(cals[0].id).toBe("cal-1");
      expect(cals[1].id).toBe("cal-2");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("syncTrip", () => {
    it("POSTs to /me/calendar/events for un-synced segments", async () => {
      // First call is the orphan-event lookup syncTrip kicks off
      // when any segment lacks a `calendarEventId` — returns empty
      // here so we exercise the create-from-scratch path.
      fetchMock
        .mockResolvedValueOnce(makeJsonResponse(200, { value: [] }))
        .mockResolvedValueOnce(
          makeJsonResponse(201, { id: "ms-event-new", subject: "Dinner: Sushi" }),
        );

      const conn = new MicrosoftCalendarConnector(ACCESS_TOKEN);
      const result = await conn.syncTrip(TRIP, "primary", "user@example.com");

      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.failed).toBe(0);
      expect(result.eventMap["seg-1"]).toBe("ms-event-new");

      // Index 1 = the POST after the orphan-lookup probe at index 0.
      const [url, init] = fetchMock.mock.calls[1];
      expect(url.toString()).toContain("/me/calendar/events");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(init?.body as string);
      expect(body.subject).toContain("Sushi");
      expect(body.attendees?.[0]?.emailAddress?.address).toBe("user@example.com");
    });

    it("PATCHes to /me/calendar/events/{id} for synced segments", async () => {
      fetchMock.mockResolvedValueOnce(
        makeJsonResponse(200, { id: "ms-event-existing", subject: "Dinner: Sushi" }),
      );

      const conn = new MicrosoftCalendarConnector(ACCESS_TOKEN);
      const result = await conn.syncTrip(
        TRIP_WITH_SYNCED_SEGMENT,
        "primary",
        "user@example.com",
      );

      expect(result.updated).toBe(1);
      expect(result.created).toBe(0);
      expect(result.eventMap["seg-1"]).toBe("ms-event-existing");

      const [url, init] = fetchMock.mock.calls[0];
      expect(url.toString()).toContain("/me/calendar/events/ms-event-existing");
      expect(init?.method).toBe("PATCH");
    });

    it("re-creates the event when the existing one 404s", async () => {
      fetchMock
        .mockResolvedValueOnce(
          makeJsonResponse(404, {
            error: { code: "ErrorItemNotFound", message: "Event not found" },
          }),
        )
        .mockResolvedValueOnce(
          makeJsonResponse(201, { id: "ms-event-recreated" }),
        );

      const conn = new MicrosoftCalendarConnector(ACCESS_TOKEN);
      const result = await conn.syncTrip(
        TRIP_WITH_SYNCED_SEGMENT,
        "primary",
        "user@example.com",
      );

      expect(result.created).toBe(1);
      expect(result.eventMap["seg-1"]).toBe("ms-event-recreated");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][1]?.method).toBe("PATCH");
      expect(fetchMock.mock.calls[1][1]?.method).toBe("POST");
    });

    it("counts failures and continues to the next segment", async () => {
      // Orphan-lookup probe (empty), then the upsert call we want to
      // observe failing.
      fetchMock
        .mockResolvedValueOnce(makeJsonResponse(200, { value: [] }))
        .mockResolvedValueOnce(
          makeJsonResponse(500, {
            error: { code: "InternalServerError", message: "Boom" },
          }),
        );

      const conn = new MicrosoftCalendarConnector(ACCESS_TOKEN);
      const result = await conn.syncTrip(TRIP, "primary");

      expect(result.created).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.eventMap["seg-1"]).toBeUndefined();
    });

    it("reuses an orphaned event when one exists for the segment", async () => {
      // First call: the orphan-lookup probe finds a prior event with
      // ItinlySegmentId == "seg-1". Second call: upsertSegmentEvent
      // PATCHes that event rather than creating a duplicate.
      fetchMock
        .mockResolvedValueOnce(
          makeJsonResponse(200, {
            value: [
              {
                id: "ms-event-orphan",
                singleValueExtendedProperties: [
                  {
                    id: "String {00020329-0000-0000-c000-000000000046} Name ItinlySegmentId",
                    value: "seg-1",
                  },
                ],
              },
            ],
          }),
        )
        .mockResolvedValueOnce(
          makeJsonResponse(200, { id: "ms-event-orphan" }),
        );

      const conn = new MicrosoftCalendarConnector(ACCESS_TOKEN);
      const result = await conn.syncTrip(TRIP, "primary", "user@example.com");

      expect(result.updated).toBe(1);
      expect(result.created).toBe(0);
      expect(result.eventMap["seg-1"]).toBe("ms-event-orphan");
      expect(fetchMock.mock.calls[1][1]?.method).toBe("PATCH");
      expect(fetchMock.mock.calls[1][0].toString()).toContain(
        "/me/calendar/events/ms-event-orphan",
      );
    });
  });

  describe("syncSegment", () => {
    it("returns created counts on a fresh event", async () => {
      fetchMock.mockResolvedValueOnce(
        makeJsonResponse(201, { id: "ms-event-1" }),
      );

      const conn = new MicrosoftCalendarConnector(ACCESS_TOKEN);
      const result = await conn.syncSegment(
        TRIP,
        TRIP.days[0],
        TRIP.days[0].segments[0],
        "primary",
        "user@example.com",
      );

      expect(result).toEqual({
        created: 1,
        updated: 0,
        failed: 0,
        eventId: "ms-event-1",
      });
    });

    it("returns updated counts on a pre-synced segment", async () => {
      fetchMock.mockResolvedValueOnce(
        makeJsonResponse(200, { id: "ms-event-existing" }),
      );

      const conn = new MicrosoftCalendarConnector(ACCESS_TOKEN);
      const result = await conn.syncSegment(
        TRIP_WITH_SYNCED_SEGMENT,
        TRIP_WITH_SYNCED_SEGMENT.days[0],
        TRIP_WITH_SYNCED_SEGMENT.days[0].segments[0],
        "primary",
      );

      expect(result.updated).toBe(1);
      expect(result.created).toBe(0);
      expect(result.eventId).toBe("ms-event-existing");
    });
  });

  describe("unsyncTrip", () => {
    it("DELETEs tracked events and counts removals", async () => {
      fetchMock.mockResolvedValueOnce(makeNoContentResponse());

      const conn = new MicrosoftCalendarConnector(ACCESS_TOKEN);
      const result = await conn.unsyncTrip(
        TRIP_WITH_SYNCED_SEGMENT,
        "primary",
      );

      expect(result.removed).toBe(1);
      expect(result.failed).toBe(0);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url.toString()).toContain("/me/calendar/events/ms-event-existing");
      expect(init?.method).toBe("DELETE");
    });

    it("treats a 404 on delete as already-removed (success)", async () => {
      fetchMock.mockResolvedValueOnce(
        makeJsonResponse(404, {
          error: { code: "ErrorItemNotFound", message: "Event not found" },
        }),
      );

      const conn = new MicrosoftCalendarConnector(ACCESS_TOKEN);
      const result = await conn.unsyncTrip(
        TRIP_WITH_SYNCED_SEGMENT,
        "primary",
      );

      expect(result.removed).toBe(1);
      expect(result.failed).toBe(0);
    });

    it("skips segments without a calendarEventId", async () => {
      const conn = new MicrosoftCalendarConnector(ACCESS_TOKEN);
      const result = await conn.unsyncTrip(TRIP, "primary");

      expect(result.removed).toBe(0);
      expect(result.failed).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});

describe("googleEventToMsEvent", () => {
  it("translates a timed event with description and location", () => {
    const ms = googleEventToMsEvent(
      {
        summary: "Dinner: Sushi",
        description: "Confirmation: ABC123",
        location: "Sushi Saito, Tokyo",
        start: { dateTime: "2026-06-10T19:00:00", timeZone: "Asia/Tokyo" },
        end: { dateTime: "2026-06-10T21:00:00", timeZone: "Asia/Tokyo" },
        extendedProperties: {
          private: { tripId: "trip-1", source: "itinly" },
        },
      },
      "user@example.com",
    );

    expect(ms.subject).toBe("Dinner: Sushi");
    expect(ms.body).toEqual({ contentType: "text", content: "Confirmation: ABC123" });
    expect(ms.start).toEqual({ dateTime: "2026-06-10T19:00:00", timeZone: "Asia/Tokyo" });
    expect(ms.end).toEqual({ dateTime: "2026-06-10T21:00:00", timeZone: "Asia/Tokyo" });
    expect(ms.isAllDay).toBe(false);
    expect(ms.location).toEqual({ displayName: "Sushi Saito, Tokyo" });
    expect(ms.attendees?.[0]?.emailAddress?.address).toBe("user@example.com");
    expect(ms.singleValueExtendedProperties?.[0]?.value).toBe("trip-1");
  });

  it("translates a Google all-day event to MS isAllDay + UTC midnight", () => {
    const ms = googleEventToMsEvent({
      summary: "Hotel: Park Hyatt",
      start: { date: "2026-06-10" },
      end: { date: "2026-06-12" },
      extendedProperties: { private: {} },
    });

    expect(ms.isAllDay).toBe(true);
    expect(ms.start).toEqual({ dateTime: "2026-06-10T00:00:00", timeZone: "UTC" });
    expect(ms.end).toEqual({ dateTime: "2026-06-12T00:00:00", timeZone: "UTC" });
  });

  it("omits attendees when no userEmail provided", () => {
    const ms = googleEventToMsEvent({
      summary: "X",
      start: { dateTime: "2026-01-01T00:00:00", timeZone: "UTC" },
      end: { dateTime: "2026-01-01T01:00:00", timeZone: "UTC" },
      extendedProperties: { private: {} },
    });
    expect(ms.attendees).toBeUndefined();
  });
});
