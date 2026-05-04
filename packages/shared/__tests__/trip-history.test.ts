import {
  appendTripHistory,
  TRIP_HISTORY_MAX_ENTRIES,
  type Trip,
  type TripHistoryEntry,
} from "../src";

function makeTrip(history: TripHistoryEntry[] = []): Trip {
  return {
    id: "trip-1",
    title: "Test Trip",
    startDate: "2026-01-01",
    endDate: "2026-01-05",
    status: "planning",
    days: [],
    todos: [],
    shares: [],
    history,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    schemaVersion: 2,
  };
}

function makeEntry(overrides: Partial<TripHistoryEntry> = {}): TripHistoryEntry {
  return {
    id: `h-${Math.random()}`,
    timestamp: new Date().toISOString(),
    actor: { email: "test@example.com" },
    kind: "segment.create",
    summary: "Added flight",
    ...overrides,
  };
}

describe("appendTripHistory", () => {
  it("appends a single entry to an empty history", () => {
    const trip = makeTrip();
    const entry = makeEntry();
    const next = appendTripHistory(trip, entry);
    expect(next.history).toHaveLength(1);
    expect(next.history[0]).toEqual(entry);
  });

  it("preserves existing entries", () => {
    const existing = makeEntry({ id: "first", summary: "First entry" });
    const trip = makeTrip([existing]);
    const next = appendTripHistory(trip, makeEntry({ id: "second" }));
    expect(next.history).toHaveLength(2);
    expect(next.history[0].id).toBe("first");
    expect(next.history[1].id).toBe("second");
  });

  it("does not mutate the input trip", () => {
    const trip = makeTrip();
    const before = JSON.stringify(trip);
    appendTripHistory(trip, makeEntry());
    expect(JSON.stringify(trip)).toBe(before);
  });

  it("trims old entries when the cap is exceeded", () => {
    // Seed exactly at the cap so the next append should evict the oldest.
    const seeded = Array.from({ length: TRIP_HISTORY_MAX_ENTRIES }, (_, i) =>
      makeEntry({ id: `entry-${i}` }),
    );
    const trip = makeTrip(seeded);
    const next = appendTripHistory(trip, makeEntry({ id: "newest" }));
    expect(next.history).toHaveLength(TRIP_HISTORY_MAX_ENTRIES);
    expect(next.history[0].id).toBe("entry-1"); // oldest dropped
    expect(next.history[next.history.length - 1].id).toBe("newest");
  });

  it("handles a trip with undefined history (older trip pre-migration)", () => {
    const trip = makeTrip();
    delete (trip as { history?: unknown }).history;
    const next = appendTripHistory(trip, makeEntry());
    expect(next.history).toHaveLength(1);
  });
});
