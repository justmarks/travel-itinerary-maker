import { primaryLocationFor } from "../src/utils/primary-location";
import type { TripDay } from "../src/types/trip";

function day(date: string, city: string): TripDay {
  return { date, dayOfWeek: "Mon", city, segments: [] };
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
});
