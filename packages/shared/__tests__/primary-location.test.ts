import { primaryLocationFor } from "../src/utils/primary-location";
import type { Segment, TripDay } from "../src/types/trip";

function day(date: string, city: string, segments: Segment[] = []): TripDay {
  return { date, dayOfWeek: "Mon", city, segments };
}

function cruiseSegment(title: string, endDate: string): Segment {
  return {
    id: `cruise-${title}`,
    type: "cruise",
    title,
    endDate,
    source: "manual",
    needsReview: false,
    sortOrder: 0,
  };
}

describe("primaryLocationFor", () => {
  it("returns the city with the most days", () => {
    const result = primaryLocationFor({
      days: [
        day("2025-04-10", "Tokyo"),
        day("2025-04-11", "Tokyo"),
        day("2025-04-12", "Tokyo"),
        day("2025-04-13", "Kyoto"),
        day("2025-04-14", "Kyoto"),
      ],
    });
    expect(result?.city).toBe("Tokyo");
    expect(result?.dayCount).toBe(3);
    expect(result?.countryCode).toBe("JP");
    expect(result?.country).toBe("Japan");
  });

  it("does not pick the first-day city when another city has a longer stay", () => {
    const result = primaryLocationFor({
      days: [
        day("2025-04-10", "Tokyo"),
        day("2025-04-11", "Kyoto"),
        day("2025-04-12", "Kyoto"),
        day("2025-04-13", "Kyoto"),
      ],
    });
    expect(result?.city).toBe("Kyoto");
  });

  it("breaks ties by earliest first appearance", () => {
    const result = primaryLocationFor({
      days: [
        day("2025-02-14", "Paris"),
        day("2025-02-15", "Paris"),
        day("2025-02-16", "London"),
        day("2025-02-17", "London"),
      ],
    });
    expect(result?.city).toBe("Paris");
  });

  it("treats accented and unaccented variants as the same city", () => {
    const result = primaryLocationFor({
      days: [
        day("2026-07-18", "Reykjavík"),
        day("2026-07-19", "Reykjavik"),
        day("2026-07-20", "Selfoss"),
      ],
    });
    expect(result?.city).toBe("Reykjavík");
    expect(result?.dayCount).toBe(2);
    expect(result?.countryCode).toBe("IS");
  });

  it("ignores blank cities and 'At Sea' cruise days", () => {
    const result = primaryLocationFor({
      days: [
        day("2025-07-19", ""),
        day("2025-07-20", "At Sea"),
        day("2025-07-21", "Nassau, Bahamas"),
      ],
    });
    expect(result?.city).toBe("Nassau, Bahamas");
    expect(result?.countryCode).toBe("BS");
  });

  it("falls back to the suffix country when only the country name is mapped", () => {
    const result = primaryLocationFor({
      days: [day("2025-07-22", "Castaway Cay, Bahamas")],
    });
    expect(result?.countryCode).toBe("BS");
  });

  it("strips state/region suffixes (e.g. 'Orlando, FL') before matching", () => {
    const result = primaryLocationFor({
      days: [day("2025-07-19", "Orlando, FL")],
    });
    expect(result?.city).toBe("Orlando, FL");
    expect(result?.countryCode).toBe("US");
  });

  it("returns a city even when the country is unknown", () => {
    const result = primaryLocationFor({
      days: [day("2025-09-01", "Atlantis")],
    });
    expect(result?.city).toBe("Atlantis");
    expect(result?.countryCode).toBeUndefined();
    expect(result?.country).toBeUndefined();
  });

  it("returns undefined when there are no usable cities", () => {
    expect(
      primaryLocationFor({
        days: [day("2025-07-19", ""), day("2025-07-20", "At Sea")],
      }),
    ).toBeUndefined();
    expect(primaryLocationFor({ days: [] })).toBeUndefined();
  });

  it("marks city results with kind='city'", () => {
    const result = primaryLocationFor({
      days: [day("2025-04-10", "Tokyo"), day("2025-04-11", "Tokyo")],
    });
    expect(result?.kind).toBe("city");
  });

  describe("cruise detection", () => {
    it("uses the ship name when a cruise covers most of the trip", () => {
      const result = primaryLocationFor({
        days: [
          day("2025-07-19", "Orlando, FL"),
          day("2025-07-20", "Port Canaveral, FL", [
            cruiseSegment("Disney Fantasy — 7-Night Eastern Caribbean", "2025-07-26"),
          ]),
          day("2025-07-21", "Nassau, Bahamas"),
          day("2025-07-22", "Castaway Cay, Bahamas"),
          day("2025-07-23", "At Sea"),
          day("2025-07-24", "At Sea"),
          day("2025-07-25", "At Sea"),
          day("2025-07-26", "Port Canaveral, FL"),
        ],
      });
      expect(result?.kind).toBe("cruise");
      expect(result?.city).toBe("Disney Fantasy");
      expect(result?.dayCount).toBe(7);
      expect(result?.countryCode).toBeUndefined();
      expect(result?.country).toBeUndefined();
    });

    it("strips a '·' descriptor suffix from the cruise title", () => {
      const result = primaryLocationFor({
        days: [
          day("2025-07-20", "Port", [
            cruiseSegment("Symphony of the Seas · 4-Night Bahamas", "2025-07-23"),
          ]),
          day("2025-07-21", "At Sea"),
          day("2025-07-22", "At Sea"),
          day("2025-07-23", "Port"),
        ],
      });
      expect(result?.city).toBe("Symphony of the Seas");
      expect(result?.kind).toBe("cruise");
    });

    it("falls back to the city when the cruise covers less than half the trip", () => {
      // 2-day cruise on a 10-day trip — the cruise shouldn't dominate.
      const days = Array.from({ length: 10 }, (_, i) =>
        day(`2025-06-${String(i + 1).padStart(2, "0")}`, "Miami"),
      );
      days[7] = day("2025-06-08", "Miami", [
        cruiseSegment("Sample Ship — Day Cruise", "2025-06-09"),
      ]);
      const result = primaryLocationFor({ days });
      expect(result?.kind).toBe("city");
      expect(result?.city).toBe("Miami");
    });

    it("ignores cruise segments that have no endDate", () => {
      const result = primaryLocationFor({
        days: [
          day("2025-07-20", "Port", [
            {
              id: "c1",
              type: "cruise",
              title: "Mystery Ship",
              source: "manual",
              needsReview: false,
              sortOrder: 0,
            },
          ]),
          day("2025-07-21", "Port"),
        ],
      });
      expect(result?.city).toBe("Port");
      expect(result?.kind).toBe("city");
    });
  });
});
