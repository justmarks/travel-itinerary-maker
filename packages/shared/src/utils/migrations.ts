import { CURRENT_TRIP_SCHEMA_VERSION, type Trip } from "../types/trip";

/**
 * Normalise a loaded Trip JSON document to the current schema version.
 *
 * Storage layers (InMemoryStorage, DriveStorage) call this on every read
 * so in-memory trips always conform to the current type. Migrations are
 * small, incremental steps between adjacent versions — bump the version
 * and append a branch here when the Trip shape changes.
 *
 * The input is deliberately typed as `unknown` because it comes from
 * deserialised JSON that may predate the current type. The return value
 * is a fully-typed `Trip`.
 *
 * @param loaded JSON decoded from storage
 * @returns Trip conforming to the current type
 */
export function migrateTrip(loaded: unknown): Trip {
  if (!isObject(loaded)) {
    throw new Error("migrateTrip: expected an object");
  }

  // v0 (unversioned) → v1: stamp schemaVersion. Nothing else has changed
  // between "original shape" and "first versioned shape" — v1 is the
  // baseline that every trip created since schema versioning was introduced
  // carries, and we assume older saved trips conform to that same shape.
  const working = {
    ...loaded,
    schemaVersion: (loaded as { schemaVersion?: number }).schemaVersion ?? 1,
  } as Trip;

  // Future migrations go here, each guarded on `working.schemaVersion`.
  // e.g. if (working.schemaVersion < 2) { ...migrate to v2...; working.schemaVersion = 2; }

  if (working.schemaVersion > CURRENT_TRIP_SCHEMA_VERSION) {
    // A trip saved by a newer build than this one is loading it. We don't
    // auto-downgrade; surface the mismatch so the caller knows.
    throw new Error(
      `migrateTrip: trip was saved with schemaVersion=${working.schemaVersion}, ` +
        `but this build only understands up to v${CURRENT_TRIP_SCHEMA_VERSION}. ` +
        `Update the app to the latest version.`,
    );
  }

  return working;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
