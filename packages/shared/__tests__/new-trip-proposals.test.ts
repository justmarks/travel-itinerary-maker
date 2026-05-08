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

  it("treats a single segment as one proposal", () => {
    const a = seg("2026-12-22", { city: "Whistler" });
    const proposals = proposeNewTrips(inputs(a));
    expect(proposals).toHaveLength(1);
    expect(proposals[0].startDate).toBe("2026-12-22");
    expect(proposals[0].endDate).toBe("2026-12-22");
    expect(proposals[0].title).toBe("Whistler December 2026");
  });
});
