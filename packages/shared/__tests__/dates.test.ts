import { getDayOfWeek, generateDateRange, isDateInRange } from "../src/utils/dates";

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
