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

  describe("bookend exclusion", () => {
    it("ignores the bookend city when first and last days are the same (home → trip → home)", () => {
      const result = primaryLocationFor({
        days: [
          day("2024-04-01", "Seattle"),
          day("2024-04-02", "Paris"),
          day("2024-04-03", "Paris"),
          day("2024-04-04", "Rome"),
          day("2024-04-05", "Seattle"),
        ],
      });
      // Without bookend exclusion Seattle would tie Rome (1-1) and lose
      // to Paris on count anyway. With exclusion, Seattle is dropped
      // entirely and the result reflects the actual destination.
      expect(result?.city).toBe("Paris");
      expect(result?.dayCount).toBe(2);
      expect(result?.countryCode).toBe("FR");
    });

    it("does not exclude when first and last cities differ", () => {
      const result = primaryLocationFor({
        days: [
          day("2024-04-01", "Seattle"),
          day("2024-04-02", "Paris"),
          day("2024-04-03", "Paris"),
          day("2024-04-04", "Tokyo"),
        ],
      });
      // Seattle ≠ Tokyo so neither is a bookend; Paris still wins on count.
      expect(result?.city).toBe("Paris");
    });

    it("falls back to the bookend when no other city exists (staycation)", () => {
      const result = primaryLocationFor({
        days: [
          day("2024-04-01", "Seattle"),
          day("2024-04-02", "Seattle"),
          day("2024-04-03", "Seattle"),
        ],
      });
      expect(result?.city).toBe("Seattle");
      expect(result?.dayCount).toBe(3);
    });

    it("does not treat a single-day trip as a bookend", () => {
      const result = primaryLocationFor({
        days: [day("2024-04-01", "Seattle")],
      });
      expect(result?.city).toBe("Seattle");
    });
  });

  describe("slash-separated transfer days", () => {
    it("counts both halves of a slash-separated transfer day", () => {
      const result = primaryLocationFor({
        days: [
          day("2024-04-01", "Paris"),
          day("2024-04-02", "Paris"),
          day("2024-04-03", "Paris / Rome"),
          day("2024-04-04", "Rome"),
          day("2024-04-05", "Rome"),
        ],
      });
      // Paris: 3 (days 1, 2, transfer), Rome: 3 (transfer, days 4, 5).
      // Tie at 3 → earliest first appearance wins → Paris.
      expect(result?.city).toBe("Paris");
      expect(result?.dayCount).toBe(3);
    });

    it("handles slash without surrounding spaces", () => {
      const result = primaryLocationFor({
        days: [
          day("2024-04-01", "Tokyo/Kyoto"),
          day("2024-04-02", "Kyoto"),
          day("2024-04-03", "Kyoto"),
        ],
      });
      // Tokyo: 1, Kyoto: 3 → Kyoto wins.
      expect(result?.city).toBe("Kyoto");
      expect(result?.dayCount).toBe(3);
    });

    it("preserves diacritics on a slash-part display when that city wins", () => {
      const result = primaryLocationFor({
        days: [
          // First/last cities differ → no bookend exclusion. Reykjavík wins
          // on count and the display preserves its diacritic.
          day("2024-04-01", "Akureyri"),
          day("2024-04-02", "Reykjavík / Selfoss"),
          day("2024-04-03", "Reykjavík"),
          day("2024-04-04", "Reykjavík"),
        ],
      });
      expect(result?.city).toBe("Reykjavík");
      expect(result?.countryCode).toBe("IS");
    });
  });

  describe("bookend with asymmetric transfer days", () => {
    it("flags bookend when the first day is a transfer (Home/X → ... → Home)", () => {
      const result = primaryLocationFor({
        days: [
          day("2024-04-01", "Seattle / Istanbul"),
          day("2024-04-02", "Istanbul"),
          day("2024-04-03", "Istanbul"),
          day("2024-04-04", "Seattle"),
        ],
      });
      // First slash-part of first day = "seattle", last city of last day =
      // "seattle" → Seattle bookend → excluded. Istanbul wins.
      expect(result?.city).toBe("Istanbul");
    });

    it("flags bookend when the last day is a transfer (Home → ... → X/Home)", () => {
      const result = primaryLocationFor({
        days: [
          day("2024-05-01", "Seattle"),
          day("2024-05-02", "Istanbul"),
          day("2024-05-03", "Istanbul"),
          day("2024-05-04", "Munich / Seattle"),
        ],
      });
      // First city of first day = "seattle", last slash-part of last day =
      // "seattle" → Seattle bookend → excluded. Istanbul wins.
      expect(result?.city).toBe("Istanbul");
    });

    it("flags bookend when both ends are transfers through home (Home/X → ... → Y/Home)", () => {
      const result = primaryLocationFor({
        days: [
          day("2024-05-01", "Seattle / New York"),
          day("2024-05-02", "Istanbul"),
          day("2024-05-03", "Istanbul"),
          day("2024-05-04", "Munich / Seattle"),
        ],
      });
      // first[0] = "seattle", last[-1] = "seattle" → bookend.
      expect(result?.city).toBe("Istanbul");
    });

    it("does not flag bookend when first/last cities differ even if a city is shared elsewhere", () => {
      const result = primaryLocationFor({
        days: [
          day("2024-05-01", "Seattle / Istanbul"),
          day("2024-05-02", "Istanbul"),
          day("2024-05-03", "Istanbul / Tokyo"),
        ],
      });
      // first[0] = "seattle", last[-1] = "tokyo" → no match, no bookend.
      // Istanbul still wins on count.
      expect(result?.city).toBe("Istanbul");
    });
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
