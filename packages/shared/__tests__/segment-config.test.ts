import {
  SEGMENT_LABELS,
  SEGMENT_TOKEN_FAMILY,
  costCategoryLabel,
} from "../src/segment-config";
import { SEGMENT_TYPES } from "../src/validators/trip";

describe("SEGMENT_LABELS", () => {
  it("has a label for every SegmentType", () => {
    for (const type of SEGMENT_TYPES) {
      expect(SEGMENT_LABELS[type]).toBeTruthy();
    }
  });

  it("renders the canonical labels desktop and mobile both rely on", () => {
    expect(SEGMENT_LABELS.flight).toBe("Flight");
    expect(SEGMENT_LABELS.car_rental).toBe("Car Rental");
    expect(SEGMENT_LABELS.other_transport).toBe("Transport");
    expect(SEGMENT_LABELS.restaurant_breakfast).toBe("Breakfast");
    expect(SEGMENT_LABELS.show).toBe("Show");
  });
});

describe("SEGMENT_TOKEN_FAMILY", () => {
  it("has a token family for every SegmentType", () => {
    for (const type of SEGMENT_TYPES) {
      expect(SEGMENT_TOKEN_FAMILY[type]).toBeTruthy();
    }
  });

  it("collapses both car_* types onto the same family", () => {
    expect(SEGMENT_TOKEN_FAMILY.car_rental).toBe("car");
    expect(SEGMENT_TOKEN_FAMILY.car_service).toBe("car");
  });

  it("strips the restaurant_ prefix for meal token families", () => {
    expect(SEGMENT_TOKEN_FAMILY.restaurant_breakfast).toBe("breakfast");
    expect(SEGMENT_TOKEN_FAMILY.restaurant_dinner).toBe("dinner");
  });
});

describe("costCategoryLabel", () => {
  it("uses SEGMENT_LABELS for known segment types", () => {
    expect(costCategoryLabel("flight")).toBe("Flight");
    expect(costCategoryLabel("show")).toBe("Show");
    expect(costCategoryLabel("restaurant_dinner")).toBe("Dinner");
  });

  it("titlecases unknown snake_case keys as a graceful fallback", () => {
    expect(costCategoryLabel("tips_and_fees")).toBe("Tips And Fees");
    expect(costCategoryLabel("custom")).toBe("Custom");
  });
});
