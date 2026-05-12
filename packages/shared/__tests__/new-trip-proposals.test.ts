import {
  NEW_TRIP_PREFIX,
  proposeNewTrips,
} from "../src/utils/new-trip-proposals";
import type { ParsedSegment } from "../src/types/trip";

function seg(
  date: string,
  overrides: Partial<ParsedSegment> = {},
): ParsedSegment {
  return {
    type: "activity",
    title: "Test segment",
    date,
    confidence: "high",
    ...overrides,
  };
}

function inputs(...segs: ParsedSegment[]) {
  return segs.map((s, idx) => ({ key: String(idx), segment: s }));
}

describe("proposeNewTrips", () => {
  it("returns no proposals when there are no segments", () => {
    expect(proposeNewTrips([])).toEqual([]);
  });

  it("groups segments within 14 days into one proposal", () => {
    const a = seg("2026-04-10", { city: "Maui" });
    const b = seg("2026-04-12", { city: "Maui" });
    const c = seg("2026-04-15", { city: "Maui" });
    const proposals = proposeNewTrips(inputs(a, b, c));
    expect(proposals).toHaveLength(1);
    expect(proposals[0].id).toBe(`${NEW_TRIP_PREFIX}0`);
    expect(proposals[0].segmentKeys).toEqual(["0", "1", "2"]);
    expect(proposals[0].startDate).toBe("2026-04-10");
    expect(proposals[0].endDate).toBe("2026-04-15");
    expect(proposals[0].title).toBe("Maui April 2026");
  });

  it("splits into multiple proposals when gap > 14 days", () => {
    const a = seg("2026-04-10", { city: "Maui" });
    const b = seg("2026-04-15", { city: "Maui" });
    // 30+ day gap — separate trip
    const c = seg("2026-06-01", { city: "Tokyo" });
    const d = seg("2026-06-05", { city: "Tokyo" });
    const proposals = proposeNewTrips(inputs(a, b, c, d));
    expect(proposals).toHaveLength(2);
    expect(proposals[0].title).toBe("Maui April 2026");
    expect(proposals[0].segmentKeys).toEqual(["0", "1"]);
    expect(proposals[1].title).toBe("Tokyo June 2026");
    expect(proposals[1].segmentKeys).toEqual(["2", "3"]);
  });

  it("does not split a trip with a hotel that spans the gap day", () => {
    // Hotel covers Apr 10–15 (5-night stay), activity Apr 25 — gap from
    // hotel end (Apr 15) to Apr 25 is 10 days, under threshold. Stay
    // together as one trip.
    const hotel = seg("2026-04-10", {
      type: "hotel",
      endDate: "2026-04-15",
      city: "Maui",
    });
    const activity = seg("2026-04-25", { city: "Maui" });
    const proposals = proposeNewTrips(inputs(hotel, activity));
    expect(proposals).toHaveLength(1);
    expect(proposals[0].endDate).toBe("2026-04-25");
  });

  it("uses the most-common destination across mixed segment types", () => {
    const flight = seg("2026-04-10", {
      type: "flight",
      arrivalCity: "Honolulu",
    });
    const hotel = seg("2026-04-10", { type: "hotel", city: "Maui" });
    const activity1 = seg("2026-04-12", { type: "activity", city: "Maui" });
    const activity2 = seg("2026-04-13", { type: "activity", city: "Maui" });
    const proposals = proposeNewTrips(
      inputs(flight, hotel, activity1, activity2),
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0].title).toBe("Maui April 2026");
  });

  it("falls back to `Trip <Month> <Year>` when no city is detectable", () => {
    const a = seg("2026-04-10");
    const b = seg("2026-04-12");
    const proposals = proposeNewTrips(inputs(a, b));
    expect(proposals[0].title).toBe("Trip April 2026");
  });

  it("falls back to departureCity when arrivalCity and city are absent", () => {
    const a = seg("2026-04-10", {
      type: "car_service",
      departureCity: "Lisbon",
    });
    const proposals = proposeNewTrips(inputs(a));
    expect(proposals[0].title).toBe("Lisbon April 2026");
  });

  it("returns proposals sorted by date even if input order is reversed", () => {
    const later = seg("2026-08-15", { city: "Tokyo" });
    const earlier = seg("2026-03-01", { city: "Maui" });
    const proposals = proposeNewTrips(inputs(later, earlier));
    expect(proposals).toHaveLength(2);
    expect(proposals[0].title).toBe("Maui March 2026");
    expect(proposals[1].title).toBe("Tokyo August 2026");
    // Keys preserved by reference — first cluster is the early one
    // which is index 1 in the input.
    expect(proposals[0].segmentKeys).toEqual(["1"]);
    expect(proposals[1].segmentKeys).toEqual(["0"]);
  });

  it("uses the final destination, not a layover, for flight-only round-trips", () => {
    // Real Delta itinerary: MIA → LAX → SEA outbound, SEA → MIA
    // return. Previously the title fell on Los Angeles because all
    // three arrivals tied at count 1 and the layover (first inserted
    // into the frequency map) won — same bug shape as #303 for
    // TripDay.city. Now we walk transports in chronological order
    // and pick the last non-home arrival.
    const out1 = seg("2026-06-24", {
      type: "flight",
      startTime: "08:12",
      departureCity: "Miami",
      arrivalCity: "Los Angeles",
    });
    const out2 = seg("2026-06-24", {
      type: "flight",
      startTime: "11:56",
      departureCity: "Los Angeles",
      arrivalCity: "Seattle",
    });
    const ret = seg("2026-07-05", {
      type: "flight",
      startTime: "08:05",
      departureCity: "Seattle",
      arrivalCity: "Miami",
    });
    const proposals = proposeNewTrips(inputs(out1, out2, ret));
    expect(proposals).toHaveLength(1);
    expect(proposals[0].title).toBe("Seattle June 2026");
  });

  it("uses the final destination, not a layover, for one-way multi-leg flights", () => {
    // MIA → LAX → SEA one-way. No return leg, so "last non-home
    // arrival" still resolves to Seattle.
    const leg1 = seg("2026-06-24", {
      type: "flight",
      startTime: "08:12",
      departureCity: "Miami",
      arrivalCity: "Los Angeles",
    });
    const leg2 = seg("2026-06-24", {
      type: "flight",
      startTime: "11:56",
      departureCity: "Los Angeles",
      arrivalCity: "Seattle",
    });
    const proposals = proposeNewTrips(inputs(leg1, leg2));
    expect(proposals).toHaveLength(1);
    expect(proposals[0].title).toBe("Seattle June 2026");
  });

  it("treats a single segment as one proposal", () => {
    const a = seg("2026-12-22", { city: "Whistler" });
    const proposals = proposeNewTrips(inputs(a));
    expect(proposals).toHaveLength(1);
    expect(proposals[0].startDate).toBe("2026-12-22");
    expect(proposals[0].endDate).toBe("2026-12-22");
    expect(proposals[0].title).toBe("Whistler December 2026");
  });
});
