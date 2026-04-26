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
  // ─── Basic missing-meal detection ───────────────────────

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

  it("does not flag non-transport segments as transit", () => {
    // A museum visit at noon shouldn't suppress lunch — only flight/train
    // overlap does.
    const result = suggestMealTodos([
      day("2026-04-14", "Mon", "Tokyo", []),
      day("2026-04-15", "Tue", "Tokyo", [
        seg({ type: "activity", title: "Museum", startTime: "12:00", endTime: "14:00" }),
      ]),
    ]);
    const day2Lunch = result.find(
      (r) => r.date === "2026-04-15" && r.meal === "lunch",
    );
    expect(day2Lunch).toBeDefined();
    expect(day2Lunch!.takeaway).toBe(false);
  });

  // ─── Rule: skip dinner on final-leg-home day ────────────

  it("skips dinner on the final day when there's a transport segment (final leg home)", () => {
    const result = suggestMealTodos([
      day("2026-04-14", "Mon", "Tokyo", []),
      day("2026-04-15", "Tue", "Tokyo", [
        seg({ type: "flight", title: "NRT → JFK", startTime: "17:30" }),
      ]),
    ]);
    // Day 1 (non-final): lunch + dinner suggested.
    expect(
      result.filter((r) => r.date === "2026-04-14").map((r) => r.meal),
    ).toEqual(["lunch", "dinner"]);
    // Final day: only lunch — dinner skipped because the day has a flight home.
    const finalDay = result.filter((r) => r.date === "2026-04-15");
    expect(finalDay.map((r) => r.meal)).toEqual(["lunch"]);
  });

  it("still suggests dinner on the final day when there's no transport", () => {
    const result = suggestMealTodos([
      day("2026-04-14", "Mon", "Tokyo", []),
      day("2026-04-15", "Tue", "Tokyo", []),
    ]);
    const finalDay = result.filter((r) => r.date === "2026-04-15");
    expect(finalDay.map((r) => r.meal)).toContain("dinner");
  });

  // ─── Rule 2: don't plan a meal during a flight/train ────

  it("skips lunch when a flight is in the air during the lunch window", () => {
    // Flight 11:00–13:30 covers most of lunch — user can't eat at a place
    // while on the plane.
    const result = suggestMealTodos([
      day("2026-04-14", "Mon", "Tokyo", []),
      day("2026-04-15", "Tue", "", [
        seg({
          type: "flight",
          title: "Tokyo → Hong Kong",
          startTime: "11:00",
          endTime: "13:30",
        }),
      ]),
    ]);
    const day2 = result.filter((r) => r.date === "2026-04-15");
    expect(day2.map((r) => r.meal)).not.toContain("lunch");
  });

  it("skips dinner when a train is moving during the dinner window", () => {
    const result = suggestMealTodos([
      day("2026-04-14", "Mon", "Tokyo", []),
      day("2026-04-15", "Tue", "", [
        seg({
          type: "train",
          title: "Overnight train",
          startTime: "19:00",
          endTime: "23:30",
        }),
      ]),
    ]);
    const day2 = result.filter((r) => r.date === "2026-04-15");
    expect(day2.map((r) => r.meal)).not.toContain("dinner");
  });

  it("treats a flight without an endTime as long enough to overlap the meal", () => {
    // Without endTime, the suggester errs long: better to skip a meal than
    // recommend lunch while the user is mid-flight.
    const result = suggestMealTodos([
      day("2026-04-14", "Mon", "Tokyo", []),
      day("2026-04-15", "Tue", "", [
        seg({ type: "flight", title: "JFK → NRT", startTime: "11:30" }),
      ]),
    ]);
    const day2 = result.filter((r) => r.date === "2026-04-15");
    expect(day2.map((r) => r.meal)).not.toContain("lunch");
  });

  it("does not flag a car or bus during the meal as transit (only flight/train do)", () => {
    // A bus or rideshare during lunch isn't a sealed cabin — user can grab
    // food before/after, or even on the way. Only flight/train suppress.
    const result = suggestMealTodos([
      day("2026-04-14", "Mon", "Tokyo", []),
      day("2026-04-15", "Tue", "Tokyo", [
        seg({
          type: "car_service",
          title: "Hotel transfer",
          startTime: "12:00",
          endTime: "13:00",
        }),
      ]),
    ]);
    expect(
      result.find((r) => r.date === "2026-04-15" && r.meal === "lunch"),
    ).toBeDefined();
  });

  // ─── Rule 1: skip during a < 6h layover ─────────────────

  it("skips lunch when it falls inside a layover shorter than 6 hours", () => {
    // Land 09:00, depart 14:00 → 5 hour layover. Lunch (11:30–14:00) is
    // entirely inside it. Not enough time to leave the airport — skip.
    const result = suggestMealTodos([
      day("2026-04-14", "Mon", "Tokyo", []),
      day("2026-04-15", "Tue", "", [
        seg({
          type: "flight",
          title: "JFK → ICN",
          startTime: "06:00",
          endTime: "09:00",
        }),
        seg({
          type: "flight",
          title: "ICN → SIN",
          startTime: "14:00",
          endTime: "20:00",
        }),
      ]),
    ]);
    const day2 = result.filter((r) => r.date === "2026-04-15");
    expect(day2.map((r) => r.meal)).not.toContain("lunch");
  });

  it("still suggests lunch when the layover is at least 6 hours", () => {
    // Land 08:00, depart 17:00 → 9 hour layover. Plenty of time to leave
    // the airport for a real lunch.
    const result = suggestMealTodos([
      day("2026-04-14", "Mon", "Tokyo", []),
      day("2026-04-15", "Tue", "Singapore", [
        seg({
          type: "flight",
          title: "JFK → SIN",
          startTime: "06:00",
          endTime: "08:00",
        }),
        seg({
          type: "flight",
          title: "SIN → BKK",
          startTime: "17:00",
          endTime: "19:30",
        }),
      ]),
    ]);
    const day2 = result.filter((r) => r.date === "2026-04-15");
    expect(day2.map((r) => r.meal)).toContain("lunch");
  });

  // ─── Rule 3: takeaway only on overnight-departure days ──

  it("does NOT flag lunch as takeaway when arriving from home (first day)", () => {
    // First day with an inbound flight — user is going to a hotel, not
    // packing for the airport. Regular sit-down lunch.
    const result = suggestMealTodos([
      day("2026-04-14", "Mon", "Tokyo", [
        seg({
          type: "flight",
          title: "JFK → NRT",
          startTime: "06:00",
          endTime: "10:00",
        }),
      ]),
      day("2026-04-15", "Tue", "Tokyo", []),
    ]);
    const day1Lunch = result.find(
      (r) => r.date === "2026-04-14" && r.meal === "lunch",
    );
    expect(day1Lunch).toBeDefined();
    expect(day1Lunch!.takeaway).toBe(false);
    expect(day1Lunch!.text.toLowerCase()).not.toContain("takeaway");
  });

  it("flags lunch as takeaway on a non-first-day with a departure after lunch", () => {
    // Day 2 is a hotel-to-airport day: user slept in town the prior night
    // and is leaving by flight after lunch — pack something portable.
    const result = suggestMealTodos([
      day("2026-04-14", "Mon", "Tokyo", []),
      day("2026-04-15", "Tue", "Tokyo", [
        seg({
          type: "flight",
          title: "NRT → JFK",
          startTime: "17:00",
          endTime: "23:00",
        }),
      ]),
    ]);
    const day2Lunch = result.find(
      (r) => r.date === "2026-04-15" && r.meal === "lunch",
    );
    expect(day2Lunch).toBeDefined();
    expect(day2Lunch!.takeaway).toBe(true);
    expect(day2Lunch!.text.toLowerCase()).toContain("takeaway");
    expect(day2Lunch!.details).toMatch(/portable|heading out/i);
  });

  it("does not flag takeaway when a non-first-day's only flight is in the morning (an arrival)", () => {
    // Mid-trip arrival: morning flight lands, no later departure. Regular
    // lunch — they're checking into a hotel, not catching another plane.
    const result = suggestMealTodos([
      day("2026-04-14", "Mon", "Tokyo", []),
      day("2026-04-15", "Tue", "Kyoto", [
        seg({
          type: "flight",
          title: "Tokyo → Kyoto",
          startTime: "06:00",
          endTime: "08:30",
        }),
      ]),
      day("2026-04-16", "Wed", "Kyoto", []),
    ]);
    const day2Lunch = result.find(
      (r) => r.date === "2026-04-15" && r.meal === "lunch",
    );
    expect(day2Lunch).toBeDefined();
    expect(day2Lunch!.takeaway).toBe(false);
  });

  // ─── Rule 4: skip both meals on overnight transport days ──

  it("skips both lunch and dinner when a flight crosses midnight (overnight)", () => {
    // Mirrors the Iceland sample trip: depart 16:40, arrive 06:30 next day.
    // The day is effectively a transit day — user is at home/airport/in
    // the air for the bulk of it, not eating in the destination city.
    const result = suggestMealTodos([
      day("2026-07-18", "Sat", "Reykjavík", [
        seg({
          type: "flight",
          title: "SEA → KEF",
          startTime: "16:40",
          endTime: "06:30",
        }),
      ]),
      day("2026-07-19", "Sun", "Reykjavík", []),
    ]);
    const day1 = result.filter((r) => r.date === "2026-07-18");
    expect(day1).toEqual([]);
    // The next day (proper arrival) still gets meals.
    const day2 = result.filter((r) => r.date === "2026-07-19");
    expect(day2.map((r) => r.meal)).toEqual(["lunch", "dinner"]);
  });

  it("skips both meals when a train crosses midnight (overnight train)", () => {
    const result = suggestMealTodos([
      day("2026-04-14", "Mon", "Paris", []),
      day("2026-04-15", "Tue", "Venice", [
        seg({
          type: "train",
          title: "Paris → Venice sleeper",
          startTime: "21:00",
          endTime: "07:30",
        }),
      ]),
    ]);
    const day2 = result.filter((r) => r.date === "2026-04-15");
    expect(day2).toEqual([]);
  });

  it("does not treat a same-day flight (endTime > startTime) as overnight", () => {
    // Sanity check: the overnight rule keys on endTime < startTime, not
    // on time-of-day. A normal evening flight that lands the same day
    // still suggests lunch.
    const result = suggestMealTodos([
      day("2026-04-14", "Mon", "Tokyo", []),
      day("2026-04-15", "Tue", "Tokyo", [
        seg({
          type: "flight",
          title: "Late evening hop",
          startTime: "19:00",
          endTime: "22:30",
        }),
      ]),
    ]);
    const day2Lunch = result.find(
      (r) => r.date === "2026-04-15" && r.meal === "lunch",
    );
    expect(day2Lunch).toBeDefined();
  });

  it("on a single-day trip with an evening departure, lunch is not takeaway (first-day rule)", () => {
    // Even though the day has a late departure, isFirstDay=true means
    // takeaway doesn't fire — there's no overnight-in-town context.
    const result = suggestMealTodos([
      day("2026-04-14", "Mon", "Tokyo", [
        seg({
          type: "flight",
          title: "Same-day return",
          startTime: "20:00",
          endTime: "23:00",
        }),
      ]),
    ]);
    const lunch = result.find((r) => r.meal === "lunch");
    expect(lunch).toBeDefined();
    expect(lunch!.takeaway).toBe(false);
    // Dinner is in the air → skipped.
    expect(result.map((r) => r.meal)).not.toContain("dinner");
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
