import request from "supertest";
import type express from "express";
import { createApp } from "../../src/app";
import { InMemoryStorage } from "../../src/services/storage";

// Mock only the async API-calling functions; keep segmentToEvent real for unit tests
jest.mock("../../src/services/google-calendar", () => ({
  ...jest.requireActual("../../src/services/google-calendar"),
  syncTripToCalendar: jest.fn(),
  unsyncTripFromCalendar: jest.fn(),
}));

import {
  syncTripToCalendar,
  unsyncTripFromCalendar,
} from "../../src/services/google-calendar";

const mockSync = syncTripToCalendar as jest.MockedFunction<typeof syncTripToCalendar>;
const mockUnsync = unsyncTripFromCalendar as jest.MockedFunction<typeof unsyncTripFromCalendar>;

let storage: InMemoryStorage;
let app: express.Express;
let tripId: string;

beforeEach(async () => {
  storage = new InMemoryStorage();
  app = await createApp({ mode: "memory", storage, disableRedis: true });

  // Create a trip with one segment
  const tripRes = await request(app)
    .post("/api/v1/trips")
    .send({ title: "Test Trip", startDate: "2026-06-10", endDate: "2026-06-11" });
  tripId = tripRes.body.id;

  await request(app)
    .put(`/api/v1/trips/${tripId}/days/2026-06-10`)
    .send({ city: "Paris" });

  await request(app)
    .post(`/api/v1/trips/${tripId}/segments`)
    .send({
      date: "2026-06-10",
      type: "flight",
      title: "CDG → JFK",
      departureCity: "Paris",
      arrivalCity: "New York",
      startTime: "10:00",
      endTime: "14:00",
    });

  jest.resetAllMocks();
});

describe("GET /api/v1/trips/:tripId/calendar/sync", () => {
  it("returns null when the user has no sync state", async () => {
    const res = await request(app).get(
      `/api/v1/trips/${tripId}/calendar/sync`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it("returns the per-user sync row when it exists", async () => {
    const trip = await storage.getTrip(tripId);
    const segId = trip!.days[0].segments[0].id;
    await storage.saveTripUserCalendarSync({
      id: "sync-1",
      tripId,
      userId: "memory-anon",
      calendarId: "work@example.com",
      segmentEventMap: { [segId]: "ev-123" },
      createdAt: "2026-05-15T00:00:00.000Z",
      updatedAt: "2026-05-15T00:00:00.000Z",
    });
    const res = await request(app).get(
      `/api/v1/trips/${tripId}/calendar/sync`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      tripId,
      userId: "memory-anon",
      calendarId: "work@example.com",
      segmentEventMap: { [segId]: "ev-123" },
    });
  });
});

describe("POST /api/v1/trips/:tripId/calendar/sync", () => {
  it("syncs a trip and returns counts", async () => {
    mockSync.mockResolvedValueOnce({
      created: 1,
      updated: 0,
      failed: 0,
      calendarId: "primary",
      eventMap: {},
    });

    const res = await request(app)
      .post(`/api/v1/trips/${tripId}/calendar/sync`);

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(res.body.updated).toBe(0);
    expect(res.body.failed).toBe(0);
    expect(res.body.calendarId).toBe("primary");
    expect(mockSync).toHaveBeenCalledTimes(1);
  });

  it("persists the eventMap in the per-user sync state after sync", async () => {
    const trip = await storage.getTrip(tripId);
    const segId = trip!.days[0].segments[0].id;

    mockSync.mockResolvedValueOnce({
      created: 1,
      updated: 0,
      failed: 0,
      calendarId: "primary",
      eventMap: { [segId]: "gcal-event-xyz" },
    });

    await request(app).post(`/api/v1/trips/${tripId}/calendar/sync`);

    // Calendar sync state is now per-user in
    // `trip_user_calendar_syncs` (memory-mode userId defaults to
    // "memory-anon"); the segment row itself no longer carries
    // calendarEventId.
    const syncState = await storage.getTripUserCalendarSync(
      tripId,
      "memory-anon",
    );
    expect(syncState).not.toBeNull();
    expect(syncState!.calendarId).toBe("primary");
    expect(syncState!.segmentEventMap[segId]).toBe("gcal-event-xyz");
  });

  it("accepts a custom calendarId via query param", async () => {
    mockSync.mockResolvedValueOnce({
      created: 0,
      updated: 0,
      failed: 0,
      calendarId: "custom@group.calendar.google.com",
      eventMap: {},
    });

    const res = await request(app)
      .post(`/api/v1/trips/${tripId}/calendar/sync?calendarId=custom%40group.calendar.google.com`);

    expect(res.status).toBe(200);
    expect(mockSync).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "custom@group.calendar.google.com",
      // userEmail — populated from requireAuth in postgres mode,
      // undefined in memory-mode tests where no auth runs.
      undefined,
    );
  });

  it("returns 404 for a non-existent trip", async () => {
    const res = await request(app)
      .post("/api/v1/trips/does-not-exist/calendar/sync");

    expect(res.status).toBe(404);
    expect(mockSync).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/v1/trips/:tripId/calendar/sync", () => {
  it("removes synced events and clears the per-user sync state row", async () => {
    // Plant a per-user sync state row directly in storage so the
    // DELETE has something to drop. Memory-mode userId is the
    // "memory-anon" constant the calendar router falls back to.
    const trip = await storage.getTrip(tripId);
    const segId = trip!.days[0].segments[0].id;
    await storage.saveTripUserCalendarSync({
      id: "sync-to-delete",
      tripId,
      userId: "memory-anon",
      calendarId: "primary",
      segmentEventMap: { [segId]: "gcal-event-to-delete" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    mockUnsync.mockResolvedValueOnce({ removed: 1, failed: 0 });

    const res = await request(app)
      .delete(`/api/v1/trips/${tripId}/calendar/sync`);

    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(1);
    expect(res.body.failed).toBe(0);

    const after = await storage.getTripUserCalendarSync(tripId, "memory-anon");
    expect(after).toBeNull();
  });

  it("only drops the requester's sync row — other users' state is untouched", async () => {
    // Two different users on the same trip — each with their own sync
    // row. Unsync via the memory-mode userId should only delete that
    // user's row.
    const trip = await storage.getTrip(tripId);
    const segId = trip!.days[0].segments[0].id;
    const otherUserId = "recipient-uid";
    await storage.saveTripUserCalendarSync({
      id: "sync-mine",
      tripId,
      userId: "memory-anon",
      calendarId: "primary",
      segmentEventMap: { [segId]: "mine" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await storage.saveTripUserCalendarSync({
      id: "sync-theirs",
      tripId,
      userId: otherUserId,
      calendarId: "their-calendar",
      segmentEventMap: { [segId]: "theirs" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    mockUnsync.mockResolvedValueOnce({ removed: 1, failed: 0 });
    await request(app).delete(`/api/v1/trips/${tripId}/calendar/sync`);

    expect(
      await storage.getTripUserCalendarSync(tripId, "memory-anon"),
    ).toBeNull();
    const theirs = await storage.getTripUserCalendarSync(tripId, otherUserId);
    expect(theirs).not.toBeNull();
    expect(theirs!.segmentEventMap[segId]).toBe("theirs");
  });

  it("returns 404 for a non-existent trip", async () => {
    const res = await request(app)
      .delete("/api/v1/trips/does-not-exist/calendar/sync");

    expect(res.status).toBe(404);
    expect(mockUnsync).not.toHaveBeenCalled();
  });
});

describe("segmentToEvent", () => {
  it("maps a flight segment correctly", async () => {
    const { segmentToEvent } = await import("../../src/services/google-calendar");
    const day = { date: "2026-06-10", dayOfWeek: "Wed", city: "Paris", segments: [] };
    const segment = {
      id: "s1",
      type: "flight" as const,
      title: "CDG → JFK",
      departureCity: "Paris",
      arrivalCity: "New York",
      carrier: "Air France",
      routeCode: "AF001",
      startTime: "10:00",
      endTime: "14:00",
      confirmationCode: "AFXYZ",
      source: "manual" as const,
      needsReview: false,
      sortOrder: 0,
    };

    const event = segmentToEvent(segment, day, "Test Trip");

    expect(event.summary).toContain("Air France");
    expect(event.summary).toContain("Paris");
    expect(event.summary).toContain("New York");
    // Departure in Paris (CET/CEST), arrival in New York (ET) — different zones
    expect(event.start).toEqual({ dateTime: "2026-06-10T10:00:00", timeZone: "Europe/Paris" });
    expect(event.end).toEqual({ dateTime: "2026-06-10T14:00:00", timeZone: "America/New_York" });
    expect(event.description).toContain("AFXYZ");
  });

  it("maps a hotel segment with endDate as multi-day event in local timezone", async () => {
    const { segmentToEvent } = await import("../../src/services/google-calendar");
    const day = { date: "2026-06-10", dayOfWeek: "Wed", city: "Paris", segments: [] };
    const segment = {
      id: "s2",
      type: "hotel" as const,
      title: "Hotel Lutetia",
      venueName: "Hotel Lutetia",
      address: "45 Blvd Raspail, Paris",
      endDate: "2026-06-13",
      breakfastIncluded: true,
      confirmationCode: "LUT123",
      source: "manual" as const,
      needsReview: false,
      sortOrder: 0,
    };

    const event = segmentToEvent(segment, day, "Test Trip");

    expect(event.summary).toBe("Hotel: Hotel Lutetia");
    // Hotel has no startTime, so uses all-day date (no timeZone on all-day)
    expect(event.start).toEqual({ date: "2026-06-10" });
    expect(event.end).toEqual({ date: "2026-06-13" });
    expect(event.location).toContain("Blvd Raspail");
    expect(event.description).toContain("Breakfast included");
    expect(event.description).toContain("LUT123");
  });

  it("maps a restaurant segment with timezone from day city", async () => {
    const { segmentToEvent } = await import("../../src/services/google-calendar");
    const day = { date: "2026-06-10", dayOfWeek: "Wed", city: "Tokyo", segments: [] };
    const segment = {
      id: "s3",
      type: "restaurant_dinner" as const,
      title: "Ichiran Ramen",
      venueName: "Ichiran Ramen",
      startTime: "19:00",
      partySize: 2,
      source: "manual" as const,
      needsReview: false,
      sortOrder: 0,
    };

    const event = segmentToEvent(segment, day, "Test Trip");

    expect(event.summary).toBe("Dinner: Ichiran Ramen");
    expect(event.start).toEqual({ dateTime: "2026-06-10T19:00:00", timeZone: "Asia/Tokyo" });
    expect(event.end).toEqual({ dateTime: "2026-06-10T21:00:00", timeZone: "Asia/Tokyo" });
    expect(event.description).toContain("Party of 2");
  });

  it("falls back gracefully when city is unrecognised (no timeZone field)", async () => {
    const { segmentToEvent } = await import("../../src/services/google-calendar");
    const day = { date: "2026-06-10", dayOfWeek: "Wed", city: "At Sea", segments: [] };
    const segment = {
      id: "s3b",
      type: "restaurant_dinner" as const,
      title: "Dinner at Sea",
      venueName: "Main Dining Room",
      startTime: "18:00",
      source: "manual" as const,
      needsReview: false,
      sortOrder: 0,
    };

    const event = segmentToEvent(segment, day, "Test Trip");

    // "At Sea" is not in the lookup table — no timeZone should be emitted
    expect(event.start).toEqual({ dateTime: "2026-06-10T18:00:00" });
    expect((event.start as { timeZone?: string }).timeZone).toBeUndefined();
  });

  it("maps a cruise segment with endDate as a multi-day event titled by the ship name", async () => {
    const { segmentToEvent } = await import("../../src/services/google-calendar");
    const day = { date: "2026-06-10", dayOfWeek: "Wed", city: "Barcelona", segments: [] };
    const segment = {
      id: "s4",
      type: "cruise" as const,
      title: "Mediterranean Cruise",
      shipName: "MSC Seaside",
      departureCity: "Barcelona",
      arrivalCity: "Civitavecchia",
      startTime: "16:00",
      endDate: "2026-06-17",
      confirmationCode: "MSC-7741",
      source: "manual" as const,
      needsReview: false,
      sortOrder: 0,
    };

    const event = segmentToEvent(segment, day, "Test Trip");

    // Summary now reflects the ship name; route falls into the
    // description and location is the boarding port.
    expect(event.summary).toBe("MSC Seaside");
    expect(event.location).toBe("Barcelona");
    // Start in Barcelona (Europe/Madrid), end in Civitavecchia (Europe/Rome)
    expect(event.start).toEqual({ dateTime: "2026-06-10T16:00:00", timeZone: "Europe/Madrid" });
    expect(event.end).toEqual({ date: "2026-06-17" }); // endTime omitted → all-day end
    expect(event.description).toContain("Barcelona → Civitavecchia");
    expect(event.description).toContain("MSC-7741");
  });

  it("maps a car_rental segment titled '<Provider> - <Pickup city>' across pickup → dropoff", async () => {
    const { segmentToEvent } = await import("../../src/services/google-calendar");
    const day = { date: "2026-06-10", dayOfWeek: "Wed", city: "Kyoto", segments: [] };
    const segment = {
      id: "s5",
      type: "car_rental" as const,
      title: "Hertz - Kyoto",
      provider: "Hertz",
      departureCity: "Kyoto",
      arrivalCity: "Kyoto",
      address: "12 Karasuma-dori",
      startTime: "15:00",
      endTime: "10:00",
      endDate: "2026-06-13",
      confirmationCode: "TCR-7741",
      source: "manual" as const,
      needsReview: false,
      sortOrder: 0,
    };

    const event = segmentToEvent(segment, day, "Test Trip");

    expect(event.summary).toBe("Hertz - Kyoto");
    expect(event.location).toBe("12 Karasuma-dori");
    expect(event.start).toEqual({ date: "2026-06-10" });
    // Exclusive DTEND — 2026-06-14 makes the dropoff date (6/13) visible.
    expect(event.end).toEqual({ date: "2026-06-14" });
    expect(event.description).toContain("TCR-7741");
    expect(event.description).toContain("Pickup: Kyoto, 2026-06-10, 15:00");
    expect(event.description).toContain("Dropoff: Kyoto, 2026-06-13, 10:00");
  });

  it("maps a show segment with seat number", async () => {
    const { segmentToEvent } = await import("../../src/services/google-calendar");
    const day = { date: "2026-06-10", dayOfWeek: "Wed", city: "Tokyo", segments: [] };
    const segment = {
      id: "s6",
      type: "show" as const,
      title: "Kabuki Evening Performance",
      venueName: "Kabuki-za Theatre",
      address: "4-12-15 Ginza, Chuo City",
      startTime: "18:00",
      endTime: "21:00",
      seatNumber: "Tier 2, Row B · 14-15",
      source: "manual" as const,
      needsReview: false,
      sortOrder: 0,
    };

    const event = segmentToEvent(segment, day, "Test Trip");

    expect(event.summary).toBe("Show: Kabuki-za Theatre");
    expect(event.start).toEqual({ dateTime: "2026-06-10T18:00:00", timeZone: "Asia/Tokyo" });
    expect(event.end).toEqual({ dateTime: "2026-06-10T21:00:00", timeZone: "Asia/Tokyo" });
    expect(event.description).toContain("Tier 2, Row B · 14-15");
  });

  it("includes train coach in description", async () => {
    const { segmentToEvent } = await import("../../src/services/google-calendar");
    const day = { date: "2026-06-10", dayOfWeek: "Wed", city: "Tokyo", segments: [] };
    const segment = {
      id: "s7",
      type: "train" as const,
      title: "Shinkansen Tokyo → Kyoto",
      departureCity: "Tokyo Station",
      arrivalCity: "Kyoto Station",
      carrier: "JR",
      routeCode: "Nozomi 15",
      coach: "Car 7",
      seatNumber: "12A, 12B",
      startTime: "12:00",
      endTime: "14:24",
      source: "manual" as const,
      needsReview: false,
      sortOrder: 0,
    };

    const event = segmentToEvent(segment, day, "Test Trip");

    expect(event.description).toContain("Coach: Car 7");
    expect(event.description).toContain("Seat: 12A, 12B");
  });
});
