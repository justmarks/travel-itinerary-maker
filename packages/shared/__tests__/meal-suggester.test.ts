import {
  suggestMealTodos,
  dedupeAgainstExistingTodos,
} from "../src/utils/meal-suggester";
import type { Segment, SegmentType, TripDay } from "../src/types/trip";

function seg(overrides: Partial<Segment> & { type: SegmentType }): Segment {
  return {
    id: `seg-${Math.random().toString(36).slice(2)}`,
    type: overrides.type,
    title: "Untitled",
    source: "manual",
    needsReview: false,
    sortOrder: 0,
    ...overrides,
  };
}

function day(date: string, dayOfWeek: string, city: string, segments: Segment[]): TripDay {
  return { date, dayOfWeek, city, segments };
}

describe("suggestMealTodos", () => {
  it("emits lunch + dinner suggestions for a day with no meals", () => {
    const result = suggestMealTodos([
      day("2026-04-14", "Mon", "Tokyo", []),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      meal: "lunch",
      takeaway: false,
      date: "2026-04-14",
      category: "meals",
    });
    expect(result[0].text).toContain("Mon, Apr 14");
    expect(result[0].text).toContain("Tokyo");
    expect(result[1]).toMatchObject({ meal: "dinner", takeaway: false });
  });

  it("skips a meal type that already exists on the day", () => {
    const result = suggestMealTodos([
      day("2026-04-14", "Mon", "Kyoto", [
        seg({ type: "restaurant_lunch", title: "Lunch · Nishiki", startTime: "12:30" }),
      ]),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].meal).toBe("dinner");
  });

  it("skips both meals when both restaurant types are already booked", () => {
    const result = suggestMealTodos([
      day("2026-04-14", "Mon", "Kyoto", [
        seg({ type: "restaurant_lunch", title: "Lunch", startTime: "12:00" }),
        seg({ type: "restaurant_dinner", title: "Dinner", startTime: "19:00" }),
      ]),
    ]);
    expect(result).toEqual([]);
  });

  it("flags lunch as takeaway when transport overlaps the lunch window", () => {
    // Train departing at 12:00 — user is in transit during lunch.
    const result = suggestMealTodos([
      day("2026-04-14", "Mon", "Kyoto", [
        seg({ type: "train", title: "Shinkansen", startTime: "12:00" }),
      ]),
    ]);
    const lunch = result.find((r) => r.meal === "lunch");
    expect(lunch).toBeDefined();
    expect(lunch!.takeaway).toBe(true);
    expect(lunch!.text.toLowerCase()).toContain("takeaway");
    expect(lunch!.details).toMatch(/transit/i);
  });

  it("treats a 10:00 transport as in-window (inclusive lower bound)", () => {
    const result = suggestMealTodos([
      day("2026-04-14", "Mon", "", [
        seg({ type: "flight", title: "JFK → NRT", startTime: "10:00" }),
      ]),
    ]);
    expect(result.find((r) => r.meal === "lunch")?.takeaway).toBe(true);
  });

  it("treats a 14:00 transport as out-of-window (exclusive upper bound)", () => {
    const result = suggestMealTodos([
      day("2026-04-14", "Mon", "", [
        seg({ type: "flight", title: "JFK → NRT", startTime: "14:00" }),
      ]),
    ]);
    expect(result.find((r) => r.meal === "lunch")?.takeaway).toBe(false);
  });

  it("ignores transports outside the lunch window", () => {
    const result = suggestMealTodos([
      day("2026-04-14", "Mon", "", [
        seg({ type: "flight", title: "Early flight", startTime: "07:00" }),
        seg({ type: "car_service", title: "Hotel pickup", startTime: "16:00" }),
      ]),
    ]);
    expect(result.find((r) => r.meal === "lunch")?.takeaway).toBe(false);
  });

  it("does not flag non-transport segments in the lunch window", () => {
    // A museum visit at noon shouldn't trigger takeaway — only transit does.
    const result = suggestMealTodos([
      day("2026-04-14", "Mon", "", [
        seg({ type: "activity", title: "Museum", startTime: "12:00" }),
      ]),
    ]);
    expect(result.find((r) => r.meal === "lunch")?.takeaway).toBe(false);
  });

  it("renders the date label even when city is empty", () => {
    const result = suggestMealTodos([day("2026-04-14", "Mon", "", [])]);
    expect(result[0].text).toContain("Mon, Apr 14");
    expect(result[0].text).not.toContain(" in ");
  });

  it("emits stable per-day, per-meal keys", () => {
    const result = suggestMealTodos([
      day("2026-04-14", "Mon", "Tokyo", []),
      day("2026-04-15", "Tue", "Kyoto", []),
    ]);
    const keys = result.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("lunch-2026-04-14");
    expect(keys).toContain("dinner-2026-04-15");
  });
});

describe("dedupeAgainstExistingTodos", () => {
  it("filters out suggestions whose text already exists as a todo", () => {
    const suggestions = [
      { text: "Plan lunch for Mon, Apr 14 in Tokyo" },
      { text: "Plan dinner for Mon, Apr 14 in Tokyo" },
    ];
    const existing = ["Plan lunch for Mon, Apr 14 in Tokyo"];
    const result = dedupeAgainstExistingTodos(suggestions, existing);
    expect(result).toHaveLength(1);
    expect(result[0].text).toContain("dinner");
  });

  it("matches case-insensitively and trims whitespace", () => {
    const suggestions = [{ text: "Plan dinner for Mon, Apr 14" }];
    const existing = ["  PLAN DINNER FOR MON, APR 14  "];
    expect(dedupeAgainstExistingTodos(suggestions, existing)).toEqual([]);
  });

  it("returns the suggestions unchanged when the existing list is empty", () => {
    const suggestions = [{ text: "Plan dinner" }];
    expect(dedupeAgainstExistingTodos(suggestions, [])).toEqual(suggestions);
  });
});
