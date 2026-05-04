import { migrateTrip, CURRENT_TRIP_SCHEMA_VERSION } from "../src";

/**
 * Storage layers pipe every loaded trip through `migrateTrip` so older
 * persisted trips continue to parse into the current `Trip` shape. These
 * tests cover the v0-unversioned → v1 baseline and the forward-compatibility
 * guard.
 */

function makeV0TripJson(overrides: Record<string, unknown> = {}) {
  // A minimal trip as it would have been stored before schema versioning
  // was introduced. Fields beyond schemaVersion are round-tripped as-is.
  return {
    id: "trip-abc",
    title: "Old Trip",
    startDate: "2025-06-01",
    endDate: "2025-06-05",
    status: "planning",
    days: [],
    todos: [],
    shares: [],
    createdAt: "2025-05-01T00:00:00.000Z",
    updatedAt: "2025-05-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("migrateTrip", () => {
  it("normalises an unversioned trip up to the current schema version", () => {
    const raw = makeV0TripJson();
    const migrated = migrateTrip(raw);
    expect(migrated.schemaVersion).toBe(CURRENT_TRIP_SCHEMA_VERSION);
    // All other fields survive the migration unchanged.
    expect(migrated.id).toBe("trip-abc");
    expect(migrated.title).toBe("Old Trip");
    expect(migrated.days).toEqual([]);
  });

  it("v1 → v2: stamps an empty history array on a v1 trip", () => {
    const raw = makeV0TripJson({ schemaVersion: 1 });
    const migrated = migrateTrip(raw);
    expect(migrated.schemaVersion).toBeGreaterThanOrEqual(2);
    expect(migrated.history).toEqual([]);
  });

  it("v1 → v2: preserves an existing history array if somehow set", () => {
    const raw = makeV0TripJson({
      schemaVersion: 1,
      history: [
        {
          id: "h1",
          timestamp: "2025-05-01T00:00:00.000Z",
          actor: { email: "a@b.com" },
          kind: "segment.create",
          summary: "Added flight",
        },
      ],
    });
    const migrated = migrateTrip(raw);
    expect(migrated.history).toHaveLength(1);
    expect(migrated.history[0].id).toBe("h1");
  });

  it("passes through a trip already at the current schema version", () => {
    const raw = makeV0TripJson({ schemaVersion: CURRENT_TRIP_SCHEMA_VERSION });
    const migrated = migrateTrip(raw);
    expect(migrated.schemaVersion).toBe(CURRENT_TRIP_SCHEMA_VERSION);
  });

  it("throws when given a trip saved by a newer schema than this build understands", () => {
    const raw = makeV0TripJson({ schemaVersion: CURRENT_TRIP_SCHEMA_VERSION + 1 });
    expect(() => migrateTrip(raw)).toThrow(/schemaVersion/);
  });

  it("rejects non-object input", () => {
    expect(() => migrateTrip(null)).toThrow(/expected an object/);
    expect(() => migrateTrip("not a trip")).toThrow(/expected an object/);
    expect(() => migrateTrip([])).toThrow(/expected an object/);
  });

  it("does not mutate the input", () => {
    const raw = makeV0TripJson();
    const before = JSON.stringify(raw);
    migrateTrip(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });
});
