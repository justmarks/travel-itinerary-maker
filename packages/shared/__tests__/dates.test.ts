import {
  getDayOfWeek,
  generateDateRange,
  addDays,
  isDateInRange,
  dateRangesOverlap,
  findOverlappingTrips,
  formatTripDateRange,
} from "../src/utils/dates";

describe("getDayOfWeek", () => {
  it("returns correct day for known dates", () => {
    expect(getDayOfWeek("2025-12-19")).toBe("Fri"); // Christmas trip start
    expect(getDayOfWeek("2025-12-25")).toBe("Thu"); // Christmas Day 2025
    expect(getDayOfWeek("2026-06-26")).toBe("Fri"); // June Europe trip start
    expect(getDayOfWeek("2026-07-01")).toBe("Wed");
  });

  it("handles leap year", () => {
    expect(getDayOfWeek("2024-02-29")).toBe("Thu");
  });
});

describe("addDays", () => {
  it("adds positive days", () => {
    expect(addDays("2026-04-21", 1)).toBe("2026-04-22");
    expect(addDays("2026-04-21", 3)).toBe("2026-04-24");
  });

  it("handles month boundary", () => {
    expect(addDays("2026-04-30", 1)).toBe("2026-05-01");
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("handles year boundary", () => {
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
  });

  it("handles leap year", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-02-29", 1)).toBe("2024-03-01");
  });

  it("supports negative offsets", () => {
    expect(addDays("2026-04-21", -1)).toBe("2026-04-20");
  });

  it("returns input unchanged for empty / invalid strings", () => {
    expect(addDays("", 1)).toBe("");
    expect(addDays("not-a-date", 1)).toBe("not-a-date");
  });
});

describe("generateDateRange", () => {
  it("generates inclusive range", () => {
    const range = generateDateRange("2025-12-19", "2025-12-22");
    expect(range).toEqual([
      "2025-12-19",
      "2025-12-20",
      "2025-12-21",
      "2025-12-22",
    ]);
  });

  it("handles single day", () => {
    const range = generateDateRange("2025-12-25", "2025-12-25");
    expect(range).toEqual(["2025-12-25"]);
  });

  it("handles month boundary", () => {
    const range = generateDateRange("2025-12-30", "2026-01-02");
    expect(range).toEqual([
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
    ]);
  });

  it("returns empty array when start is after end", () => {
    const range = generateDateRange("2025-12-25", "2025-12-20");
    expect(range).toEqual([]);
  });
});

describe("isDateInRange", () => {
  it("returns true for date within range", () => {
    expect(isDateInRange("2025-12-22", "2025-12-19", "2025-12-30")).toBe(true);
  });

  it("returns true for start date", () => {
    expect(isDateInRange("2025-12-19", "2025-12-19", "2025-12-30")).toBe(true);
  });

  it("returns true for end date", () => {
    expect(isDateInRange("2025-12-30", "2025-12-19", "2025-12-30")).toBe(true);
  });

  it("returns false for date before range", () => {
    expect(isDateInRange("2025-12-18", "2025-12-19", "2025-12-30")).toBe(false);
  });

  it("returns false for date after range", () => {
    expect(isDateInRange("2025-12-31", "2025-12-19", "2025-12-30")).toBe(false);
  });
});

describe("dateRangesOverlap", () => {
  it("detects full overlap", () => {
    expect(
      dateRangesOverlap(
        { startDate: "2026-06-01", endDate: "2026-06-10" },
        { startDate: "2026-06-05", endDate: "2026-06-15" },
      ),
    ).toBe(true);
  });

  it("detects overlap when one range contains the other", () => {
    expect(
      dateRangesOverlap(
        { startDate: "2026-06-01", endDate: "2026-06-30" },
        { startDate: "2026-06-10", endDate: "2026-06-20" },
      ),
    ).toBe(true);
  });

  it("detects overlap on exact boundary (end == start)", () => {
    expect(
      dateRangesOverlap(
        { startDate: "2026-06-01", endDate: "2026-06-10" },
        { startDate: "2026-06-10", endDate: "2026-06-20" },
      ),
    ).toBe(true);
  });

  it("returns false for adjacent non-overlapping ranges", () => {
    expect(
      dateRangesOverlap(
        { startDate: "2026-06-01", endDate: "2026-06-10" },
        { startDate: "2026-06-11", endDate: "2026-06-20" },
      ),
    ).toBe(false);
  });

  it("returns false for completely separate ranges", () => {
    expect(
      dateRangesOverlap(
        { startDate: "2026-01-01", endDate: "2026-01-10" },
        { startDate: "2026-06-01", endDate: "2026-06-10" },
      ),
    ).toBe(false);
  });
});

describe("findOverlappingTrips", () => {
  const trips = [
    { id: "t1", title: "Italy", startDate: "2026-06-15", endDate: "2026-06-25" },
    { id: "t2", title: "Japan", startDate: "2026-09-01", endDate: "2026-09-14" },
    { id: "t3", title: "Mexico", startDate: "2026-12-20", endDate: "2027-01-02" },
  ];

  it("finds overlapping trips", () => {
    const result = findOverlappingTrips(trips, {
      startDate: "2026-06-20",
      endDate: "2026-07-05",
    });
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Italy");
  });

  it("returns empty when no overlap", () => {
    const result = findOverlappingTrips(trips, {
      startDate: "2026-07-01",
      endDate: "2026-07-15",
    });
    expect(result).toHaveLength(0);
  });

  it("finds multiple overlapping trips", () => {
    const result = findOverlappingTrips(trips, {
      startDate: "2026-06-01",
      endDate: "2026-10-01",
    });
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.title)).toEqual(["Italy", "Japan"]);
  });

  it("excludes a trip by ID", () => {
    const result = findOverlappingTrips(
      trips,
      { startDate: "2026-06-20", endDate: "2026-07-05" },
      "t1",
    );
    expect(result).toHaveLength(0);
  });
});

describe("formatTripDateRange", () => {
  it("formats a same-year range with year on the end only", () => {
    expect(formatTripDateRange("2026-04-10", "2026-04-16")).toBe(
      "Apr 10 – Apr 16, 2026",
    );
  });

  it("formats a cross-year range with year on both ends", () => {
    expect(formatTripDateRange("2025-12-28", "2026-01-03")).toBe(
      "Dec 28, 2025 – Jan 3, 2026",
    );
  });

  it("handles single-day trips (start == end)", () => {
    expect(formatTripDateRange("2026-07-04", "2026-07-04")).toBe(
      "Jul 4 – Jul 4, 2026",
    );
  });

  it("falls back to raw ISO when input is malformed", () => {
    expect(formatTripDateRange("not-a-date", "2026-04-16")).toBe(
      "not-a-date – 2026-04-16",
    );
  });
});
