import { formatFlightLabel } from "../src/utils/segments";

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
