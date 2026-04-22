import { applyCruisePortsToDayCities, formatFlightLabel } from "../src/utils/segments";
import type { Trip } from "../src/types/trip";

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "t1",
    title: "Greek Isles",
    startDate: "2020-07-17",
    endDate: "2020-07-25",
    status: "planning",
    days: [],
    todos: [],
    shares: [],
    createdAt: "2020-01-27T00:00:00Z",
    updatedAt: "2020-01-27T00:00:00Z",
    ...overrides,
  };
}

describe("formatFlightLabel", () => {
  it("combines carrier and routeCode with a space", () => {
    expect(formatFlightLabel({ carrier: "Delta", routeCode: "359" })).toBe("Delta 359");
  });

  it("returns just the carrier when routeCode is absent", () => {
    expect(formatFlightLabel({ carrier: "Alaska Airlines", routeCode: undefined })).toBe("Alaska Airlines");
  });

  it("returns just the routeCode when carrier is absent", () => {
    expect(formatFlightLabel({ carrier: undefined, routeCode: "101" })).toBe("101");
  });

  it("returns empty string when both are absent", () => {
    expect(formatFlightLabel({ carrier: undefined, routeCode: undefined })).toBe("");
  });

  it("returns empty string when both are empty strings", () => {
    expect(formatFlightLabel({ carrier: "", routeCode: "" })).toBe("");
  });

  it("handles carrier only as empty string with a valid routeCode", () => {
    expect(formatFlightLabel({ carrier: "", routeCode: "2410" })).toBe("2410");
  });

  it("handles routeCode only as empty string with a valid carrier", () => {
    expect(formatFlightLabel({ carrier: "United", routeCode: "" })).toBe("United");
  });
});

describe("applyCruisePortsToDayCities", () => {
  it("overrides each day's city from cruise portsOfCall", () => {
    const trip = makeTrip({
      days: [
        { date: "2020-07-17", dayOfWeek: "Fri", city: "Venice", segments: [
          {
            id: "seg-c1",
            type: "cruise",
            title: "Royal Caribbean — Greek Isles",
            departureCity: "Venice",
            arrivalCity: "Venice",
            endDate: "2020-07-25",
            portsOfCall: [
              { date: "2020-07-17", port: "Venice", departureTime: "17:00" },
              { date: "2020-07-18", port: "Split", arrivalTime: "09:00", departureTime: "18:00" },
              { date: "2020-07-19", port: "Dubrovnik", arrivalTime: "07:00", departureTime: "16:00" },
              { date: "2020-07-20", atSea: true },
              { date: "2020-07-21", port: "Athens", arrivalTime: "06:00", departureTime: "18:00" },
              { date: "2020-07-22", port: "Santorini", arrivalTime: "07:00", departureTime: "18:00" },
              { date: "2020-07-23", port: "Katakolon", arrivalTime: "09:00", departureTime: "17:00" },
              { date: "2020-07-24", atSea: true },
              { date: "2020-07-25", port: "Venice", arrivalTime: "06:45" },
            ],
            source: "email_auto",
            needsReview: true,
            sortOrder: 0,
          },
        ] },
        { date: "2020-07-18", dayOfWeek: "Sat", city: "", segments: [] },
        { date: "2020-07-19", dayOfWeek: "Sun", city: "Wrong City", segments: [] },
        { date: "2020-07-20", dayOfWeek: "Mon", city: "", segments: [] },
        { date: "2020-07-21", dayOfWeek: "Tue", city: "", segments: [] },
        { date: "2020-07-22", dayOfWeek: "Wed", city: "", segments: [] },
        { date: "2020-07-23", dayOfWeek: "Thu", city: "", segments: [] },
        { date: "2020-07-24", dayOfWeek: "Fri", city: "", segments: [] },
        { date: "2020-07-25", dayOfWeek: "Sat", city: "", segments: [] },
      ],
    });

    const changes = applyCruisePortsToDayCities(trip);

    expect(trip.days.find((d) => d.date === "2020-07-19")?.city).toBe("Dubrovnik");
    expect(trip.days.find((d) => d.date === "2020-07-23")?.city).toBe("Katakolon");
    expect(trip.days.find((d) => d.date === "2020-07-18")?.city).toBe("Split");
    expect(trip.days.find((d) => d.date === "2020-07-20")?.city).toBe("At Sea");
    expect(trip.days.find((d) => d.date === "2020-07-24")?.city).toBe("At Sea");
    expect(trip.days.find((d) => d.date === "2020-07-17")?.city).toBe("Venice");
    expect(trip.days.find((d) => d.date === "2020-07-25")?.city).toBe("Venice");

    // Days that actually changed are returned in the diff
    expect(changes.some((c) => c.date === "2020-07-19" && c.from === "Wrong City" && c.to === "Dubrovnik")).toBe(true);
    expect(changes.some((c) => c.date === "2020-07-23" && c.to === "Katakolon")).toBe(true);
    // Day 17 already had "Venice" → no change recorded
    expect(changes.some((c) => c.date === "2020-07-17")).toBe(false);
  });

  it("leaves non-cruise days untouched", () => {
    const trip = makeTrip({
      startDate: "2020-07-15",
      endDate: "2020-07-20",
      days: [
        { date: "2020-07-15", dayOfWeek: "Wed", city: "Paris", segments: [] },
        { date: "2020-07-16", dayOfWeek: "Thu", city: "Paris", segments: [] },
        { date: "2020-07-17", dayOfWeek: "Fri", city: "Venice", segments: [
          {
            id: "seg-c2",
            type: "cruise",
            title: "Short Cruise",
            endDate: "2020-07-19",
            portsOfCall: [
              { date: "2020-07-17", port: "Venice" },
              { date: "2020-07-18", port: "Split" },
              { date: "2020-07-19", port: "Venice" },
            ],
            source: "manual",
            needsReview: false,
            sortOrder: 0,
          },
        ] },
        { date: "2020-07-18", dayOfWeek: "Sat", city: "", segments: [] },
        { date: "2020-07-19", dayOfWeek: "Sun", city: "", segments: [] },
        { date: "2020-07-20", dayOfWeek: "Mon", city: "Rome", segments: [] },
      ],
    });

    applyCruisePortsToDayCities(trip);

    // Pre-cruise and post-cruise days are untouched
    expect(trip.days.find((d) => d.date === "2020-07-15")?.city).toBe("Paris");
    expect(trip.days.find((d) => d.date === "2020-07-16")?.city).toBe("Paris");
    expect(trip.days.find((d) => d.date === "2020-07-20")?.city).toBe("Rome");
    // Cruise days get overridden
    expect(trip.days.find((d) => d.date === "2020-07-18")?.city).toBe("Split");
  });

  it("is a no-op when the cruise has no portsOfCall", () => {
    const trip = makeTrip({
      days: [
        { date: "2020-07-17", dayOfWeek: "Fri", city: "Venice", segments: [
          {
            id: "seg-c3",
            type: "cruise",
            title: "No ports cruise",
            departureCity: "Venice",
            arrivalCity: "Venice",
            endDate: "2020-07-19",
            source: "manual",
            needsReview: false,
            sortOrder: 0,
          },
        ] },
        { date: "2020-07-18", dayOfWeek: "Sat", city: "Existing", segments: [] },
      ],
    });

    const changes = applyCruisePortsToDayCities(trip);
    expect(changes).toEqual([]);
    expect(trip.days.find((d) => d.date === "2020-07-18")?.city).toBe("Existing");
  });

  it("ignores portsOfCall entries pointing at dates outside the trip", () => {
    const trip = makeTrip({
      startDate: "2020-07-17",
      endDate: "2020-07-18",
      days: [
        { date: "2020-07-17", dayOfWeek: "Fri", city: "Venice", segments: [
          {
            id: "seg-c4",
            type: "cruise",
            title: "Cruise",
            endDate: "2020-07-18",
            portsOfCall: [
              { date: "2020-07-17", port: "Venice" },
              { date: "2099-01-01", port: "Atlantis" }, // out of range
            ],
            source: "manual",
            needsReview: false,
            sortOrder: 0,
          },
        ] },
        { date: "2020-07-18", dayOfWeek: "Sat", city: "Venice", segments: [] },
      ],
    });

    expect(() => applyCruisePortsToDayCities(trip)).not.toThrow();
    // Only the in-range day matters; it already matched so no change
    expect(trip.days.length).toBe(2);
  });
});
