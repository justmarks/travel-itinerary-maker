import request from "supertest";
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
let app: ReturnType<typeof createApp>;
let tripId: string;

beforeEach(async () => {
  storage = new InMemoryStorage();
  app = createApp({ mode: "memory", storage });

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

  it("persists calendarEventId on the segment after sync", async () => {
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

    const updated = await storage.getTrip(tripId);
    expect(updated!.days[0].segments[0].calendarEventId).toBe("gcal-event-xyz");
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
    );
  });

  it("returns 404 for a non-existent trip", async () => {
    const res = await request(app)
      .post("/api/v1/trips/does-not-exist/calendar/sync");

    expect(res.status).toBe(404);
    expect(mockSync).not.toHaveBeenCalled();
  });

  it("returns 401 in drive mode when no Authorization header is sent", async () => {
    // In drive mode, requireAuth middleware rejects requests without a token
    const driveApp = createApp({ mode: "drive" });

    const res = await request(driveApp)
      .post("/api/v1/trips/any-id/calendar/sync");

    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/v1/trips/:tripId/calendar/sync", () => {
  it("removes synced events and clears calendarEventId", async () => {
    // First, plant a calendarEventId on the segment directly in storage
    const trip = await storage.getTrip(tripId);
    trip!.days[0].segments[0].calendarEventId = "gcal-event-to-delete";
    await storage.saveTrip(trip!);

    mockUnsync.mockResolvedValueOnce({ removed: 1, failed: 0 });

    const res = await request(app)
      .delete(`/api/v1/trips/${tripId}/calendar/sync`);

    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(1);
    expect(res.body.failed).toBe(0);

    const updated = await storage.getTrip(tripId);
    expect(updated!.days[0].segments[0].calendarEventId).toBeUndefined();
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
    expect(event.start).toEqual({ dateTime: "2026-06-10T10:00:00" });
    expect(event.end).toEqual({ dateTime: "2026-06-10T14:00:00" });
    expect(event.description).toContain("AFXYZ");
  });

  it("maps a hotel segment with endDate as multi-day event", async () => {
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
    expect(event.start).toEqual({ date: "2026-06-10" });
    expect(event.end).toEqual({ date: "2026-06-13" });
    expect(event.location).toContain("Blvd Raspail");
    expect(event.description).toContain("Breakfast included");
    expect(event.description).toContain("LUT123");
  });

  it("maps a restaurant segment with default 2-hour duration", async () => {
    const { segmentToEvent } = await import("../../src/services/google-calendar");
    const day = { date: "2026-06-10", dayOfWeek: "Wed", city: "Paris", segments: [] };
    const segment = {
      id: "s3",
      type: "restaurant_dinner" as const,
      title: "Le Jules Verne",
      venueName: "Le Jules Verne",
      startTime: "20:00",
      partySize: 2,
      creditCardHold: true,
      source: "manual" as const,
      needsReview: false,
      sortOrder: 0,
    };

    const event = segmentToEvent(segment, day, "Test Trip");

    expect(event.summary).toBe("Dinner: Le Jules Verne");
    expect(event.start).toEqual({ dateTime: "2026-06-10T20:00:00" });
    expect(event.end).toEqual({ dateTime: "2026-06-10T22:00:00" });
    expect(event.description).toContain("Party of 2");
    expect(event.description).toContain("Credit card hold required");
  });

  it("maps a cruise segment with endDate as a multi-day event", async () => {
    const { segmentToEvent } = await import("../../src/services/google-calendar");
    const day = { date: "2026-06-10", dayOfWeek: "Wed", city: "Barcelona", segments: [] };
    const segment = {
      id: "s4",
      type: "cruise" as const,
      title: "Mediterranean Cruise",
      venueName: "MSC Seaside",
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

    expect(event.summary).toBe("Cruise: MSC Seaside");
    expect(event.start).toEqual({ dateTime: "2026-06-10T16:00:00" });
    expect(event.end).toEqual({ date: "2026-06-17" });
    expect(event.description).toContain("Barcelona → Civitavecchia");
    expect(event.description).toContain("MSC-7741");
  });

  it("maps a car_rental segment with endDate as a multi-day event", async () => {
    const { segmentToEvent } = await import("../../src/services/google-calendar");
    const day = { date: "2026-06-10", dayOfWeek: "Wed", city: "Kyoto", segments: [] };
    const segment = {
      id: "s5",
      type: "car_rental" as const,
      title: "Car Rental · Toyota Aqua",
      venueName: "Times Car Rental Kyoto Station",
      city: "Kyoto",
      startTime: "15:00",
      endTime: "10:00",
      endDate: "2026-06-13",
      confirmationCode: "TCR-7741",
      source: "manual" as const,
      needsReview: false,
      sortOrder: 0,
    };

    const event = segmentToEvent(segment, day, "Test Trip");

    expect(event.summary).toBe("Car Rental: Times Car Rental Kyoto Station");
    expect(event.start).toEqual({ dateTime: "2026-06-10T15:00:00" });
    expect(event.end).toEqual({ dateTime: "2026-06-13T10:00:00" });
    expect(event.description).toContain("TCR-7741");
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
    expect(event.start).toEqual({ dateTime: "2026-06-10T18:00:00" });
    expect(event.end).toEqual({ dateTime: "2026-06-10T21:00:00" });
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
