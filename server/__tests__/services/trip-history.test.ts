import type { Segment } from "@itinly/shared";
import { summariseSegmentChanges } from "../../src/services/trip-history";

function baseSegment(): Segment {
  return {
    id: "seg-1",
    type: "flight",
    title: "SEA → NRT",
    startTime: "09:00",
    endTime: "12:00",
    source: "manual",
    sortOrder: 0,
    needsReview: false,
  };
}

describe("summariseSegmentChanges", () => {
  it("returns undefined when nothing changed", () => {
    const seg = baseSegment();
    expect(summariseSegmentChanges(seg, { ...seg })).toBeUndefined();
  });

  it("flags a scalar field change", () => {
    const before = baseSegment();
    const after = { ...before, title: "SEA → HND" };
    expect(summariseSegmentChanges(before, after)).toBe("Changed title");
  });

  it("does not flag a cost object whose only difference is key insertion order", () => {
    // `JSON.stringify` is order-sensitive — without a stable
    // serialiser this case produced false-positive history rows
    // (no real edit, but `{amount, currency}` vs `{currency, amount}`
    // diff'd as "Changed cost").
    const before: Segment = {
      ...baseSegment(),
      cost: { amount: 547.2, currency: "USD" },
    };
    const after: Segment = {
      ...baseSegment(),
      cost: { currency: "USD", amount: 547.2 } as Segment["cost"],
    };
    expect(summariseSegmentChanges(before, after)).toBeUndefined();
  });

  it("does flag a cost object whose values actually differ", () => {
    const before: Segment = {
      ...baseSegment(),
      cost: { amount: 547.2, currency: "USD" },
    };
    const after: Segment = {
      ...baseSegment(),
      cost: { amount: 600, currency: "USD" },
    };
    expect(summariseSegmentChanges(before, after)).toBe("Changed cost");
  });
});
