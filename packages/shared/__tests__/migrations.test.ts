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
  it("stamps schemaVersion=1 on an unversioned trip", () => {
    const raw = makeV0TripJson();
    const migrated = migrateTrip(raw);
    expect(migrated.schemaVersion).toBe(1);
    // All other fields survive the migration unchanged.
    expect(migrated.id).toBe("trip-abc");
    expect(migrated.title).toBe("Old Trip");
    expect(migrated.days).toEqual([]);
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
