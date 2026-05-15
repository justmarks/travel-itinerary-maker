import { segmentToEvent } from "../../src/services/google-calendar";
import type { Segment, TripDay } from "@itinly/shared";

/**
 * Cover the per-segment-type calendar event shape for car_rental and
 * cruise — the two types the user asked for richer descriptions on.
 * Other types (flight / hotel / restaurant / etc.) are covered by the
 * iCal generator suite and the in-place calendar route tests.
 */

function makeDay(date: string, city: string, segments: Segment[]): TripDay {
  return { date, dayOfWeek: "Wed", city, segments };
}

function baseCarRental(overrides: Partial<Segment> = {}): Segment {
  return {
    id: "seg-cr",
    type: "car_rental",
    title: "Hertz - Kyoto",
    provider: "Hertz",
    departureCity: "Kyoto",
    arrivalCity: "Kyoto",
    address: "12 Karasuma-dori, Kyoto",
    startTime: "15:00",
    endTime: "10:00",
    endDate: "2026-06-13",
    confirmationCode: "ABC123",
    source: "manual",
    needsReview: false,
    sortOrder: 0,
    ...overrides,
  };
}

function baseCruise(overrides: Partial<Segment> = {}): Segment {
  return {
    id: "seg-cr2",
    type: "cruise",
    title: "7-night Western Caribbean",
    shipName: "Symphony of the Seas",
    departureCity: "Port Canaveral",
    arrivalCity: "Port Canaveral",
    startTime: "16:00",
    endTime: "08:00",
    endDate: "2026-06-17",
    confirmationCode: "RCL-9988",
    portsOfCall: [
      { date: "2026-06-11", atSea: true },
      {
        date: "2026-06-12",
        port: "Nassau",
        arrivalTime: "08:00",
        departureTime: "17:00",
      },
    ],
    source: "manual",
    needsReview: false,
    sortOrder: 0,
    ...overrides,
  };
}

describe("segmentToEvent — car_rental", () => {
  it('titles the event "<Provider> - <Pickup city>"', () => {
    const day = makeDay("2026-06-10", "Kyoto", []);
    const event = segmentToEvent(baseCarRental(), day, "Japan 2026");
    expect(event.summary).toBe("Hertz - Kyoto");
  });

  it("falls back to the segment title when provider or pickup is missing", () => {
    const day = makeDay("2026-06-10", "Kyoto", []);
    const event = segmentToEvent(
      baseCarRental({ provider: undefined, title: "Car rental — Kyoto" }),
      day,
      "Japan 2026",
    );
    expect(event.summary).toBe("Car rental — Kyoto");
  });

  it("uses the pickup address as the calendar location", () => {
    const day = makeDay("2026-06-10", "Kyoto", []);
    const event = segmentToEvent(baseCarRental(), day, "Japan 2026");
    expect(event.location).toBe("12 Karasuma-dori, Kyoto");
  });

  it("includes confirmation + pickup + dropoff details in the description", () => {
    const day = makeDay("2026-06-10", "Kyoto", []);
    const event = segmentToEvent(baseCarRental(), day, "Japan 2026");
    expect(event.description).toContain("Confirmation: ABC123");
    expect(event.description).toContain("Pickup: Kyoto, 2026-06-10, 15:00");
    expect(event.description).toContain("Dropoff: Kyoto, 2026-06-13, 10:00");
  });

  it("end-dates the all-day event one day after the dropoff (Google exclusive convention)", () => {
    const day = makeDay("2026-06-10", "Kyoto", []);
    const event = segmentToEvent(baseCarRental(), day, "Japan 2026");
    // Google all-day events use exclusive DTEND: dropoff 2026-06-13
    // means the event's `end.date` is 2026-06-14 so 6/13 is visibly
    // covered for the user.
    expect(event.start).toEqual({ date: "2026-06-10" });
    expect(event.end).toEqual({ date: "2026-06-14" });
  });
});

describe("segmentToEvent — cruise", () => {
  it("titles the event with the ship name", () => {
    const day = makeDay("2026-06-10", "Port Canaveral", []);
    const event = segmentToEvent(baseCruise(), day, "Caribbean 2026");
    expect(event.summary).toBe("Symphony of the Seas");
  });

  it("uses the boarding port (departureCity) as the location", () => {
    const day = makeDay("2026-06-10", "Port Canaveral", []);
    const event = segmentToEvent(baseCruise(), day, "Caribbean 2026");
    expect(event.location).toBe("Port Canaveral");
  });

  it("renders the per-port list (with at-sea days) in the description", () => {
    const day = makeDay("2026-06-10", "Port Canaveral", []);
    const event = segmentToEvent(baseCruise(), day, "Caribbean 2026");
    expect(event.description).toContain("Confirmation: RCL-9988");
    expect(event.description).toContain("Ports of call:");
    expect(event.description).toContain("2026-06-11 — At sea");
    expect(event.description).toContain(
      "2026-06-12 — Nassau (arr 08:00, dep 17:00)",
    );
  });

  it("falls back to a boarding → disembark route when no ports of call are set", () => {
    const day = makeDay("2026-06-10", "Port Canaveral", []);
    const event = segmentToEvent(
      baseCruise({
        portsOfCall: undefined,
        shipName: undefined,
        title: "Caribbean cruise",
        departureCity: "Port Canaveral",
        arrivalCity: "Cozumel",
      }),
      day,
      "Caribbean 2026",
    );
    expect(event.summary).toBe("Caribbean cruise");
    expect(event.description).toContain("Port Canaveral → Cozumel");
  });
});
