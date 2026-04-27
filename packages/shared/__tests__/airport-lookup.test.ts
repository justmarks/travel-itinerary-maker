import {
  formatAirportLabel,
  getAirportTimezone,
  lookupAirport,
  searchAirports,
} from "../src/utils/airport-lookup";

describe("lookupAirport", () => {
  it("returns city/country/name/timezone for a known IATA code", () => {
    const jfk = lookupAirport("JFK");
    expect(jfk).toBeDefined();
    expect(jfk?.city).toBe("New York");
    expect(jfk?.country).toBe("US");
    expect(jfk?.timezone).toBe("America/New_York");
    expect(jfk?.airportName).toMatch(/Kennedy/);
  });

  it("normalises lower-case and whitespace input", () => {
    expect(lookupAirport("jfk")?.city).toBe("New York");
    expect(lookupAirport("  lhr  ")?.city).toBe("London");
  });

  it("returns undefined for unknown / malformed codes", () => {
    expect(lookupAirport("XYZ")).toBeUndefined();
    expect(lookupAirport("")).toBeUndefined();
    expect(lookupAirport(undefined)).toBeUndefined();
    expect(lookupAirport("AB")).toBeUndefined();
    expect(lookupAirport("ABCD")).toBeUndefined();
    expect(lookupAirport("J1K")).toBeUndefined();
  });
});

describe("getAirportTimezone", () => {
  it("returns IANA zone for known codes", () => {
    expect(getAirportTimezone("NRT")).toBe("Asia/Tokyo");
    expect(getAirportTimezone("CDG")).toBe("Europe/Paris");
    expect(getAirportTimezone("SFO")).toBe("America/Los_Angeles");
  });

  it("returns undefined for unknown codes", () => {
    expect(getAirportTimezone("ZZZ")).toBeUndefined();
  });
});

describe("formatAirportLabel", () => {
  it("returns 'City (CODE)' in full style", () => {
    expect(formatAirportLabel("JFK")).toBe("New York (JFK)");
    expect(formatAirportLabel("nrt")).toBe("Narita (NRT)");
  });

  it("returns just the code in compact style", () => {
    expect(formatAirportLabel("JFK", "compact")).toBe("JFK");
    expect(formatAirportLabel("lhr", "compact")).toBe("LHR");
  });

  it("returns the raw code when unknown", () => {
    expect(formatAirportLabel("ZZZ")).toBe("ZZZ");
    expect(formatAirportLabel("ZZZ", "compact")).toBe("ZZZ");
  });

  it("returns undefined when input is empty / undefined", () => {
    expect(formatAirportLabel(undefined)).toBeUndefined();
    expect(formatAirportLabel("")).toBeUndefined();
  });
});

describe("searchAirports", () => {
  it("ranks exact code match first", () => {
    const results = searchAirports("JFK");
    expect(results[0]?.code).toBe("JFK");
  });

  it("matches by city name", () => {
    const results = searchAirports("Tokyo");
    const codes = results.map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(["HND", "NRT"]));
  });

  it("matches by airport name", () => {
    const results = searchAirports("Heathrow");
    expect(results.map((r) => r.code)).toContain("LHR");
  });

  it("returns an empty array for blank input", () => {
    expect(searchAirports("")).toEqual([]);
    expect(searchAirports("   ")).toEqual([]);
  });

  it("respects the limit parameter", () => {
    const results = searchAirports("a", 5);
    expect(results.length).toBeLessThanOrEqual(5);
  });
});
