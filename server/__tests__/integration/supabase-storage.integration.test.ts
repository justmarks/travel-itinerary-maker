/**
 * Runs the `StorageProvider` contract suite against `SupabaseStorage`
 * + a real Postgres. `SupabaseStorage` is one of two backends the
 * contract is parameterised over (`InMemoryStorage` is the other);
 * both must satisfy identical semantics.
 *
 * Schema migration runs once in `beforeAll`. The harness's
 * `newStorage()` truncates the data tables before constructing each
 * fresh `SupabaseStorage` so contract tests (which use fixed IDs
 * like "trip-1") don't trip the global trip PK.
 */
import path from "path";
import { Client } from "pg";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDbClient, type DbClient } from "../../src/db/client";
import { SupabaseStorage } from "../../src/services/supabase-storage";
import { runStorageProviderContract } from "../storage/contract";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../drizzle");
const TEST_USER_ID = "supabase-storage-contract-user";

async function applyMigrations(): Promise<void> {
  const setupClient = new Client({ connectionString: DATABASE_URL });
  await setupClient.connect();
  try {
    // Wipe everything so the suite is independent of prior runs.
    // Drops both `public` (data tables) and `drizzle` (migration
    // journal); recreates `public` clean.
    await setupClient.query("DROP SCHEMA IF EXISTS public CASCADE");
    await setupClient.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await setupClient.query("CREATE SCHEMA public");
    await setupClient.query("GRANT ALL ON SCHEMA public TO public");
    const db = drizzle(setupClient);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await setupClient.end();
  }
}

describe("SupabaseStorage", () => {
  let dbClient: DbClient;

  beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is required for integration tests. Set it to a " +
          "running Postgres (e.g. `postgres://postgres:postgres@localhost:5432/postgres`).",
      );
    }
    await applyMigrations();
    dbClient = createDbClient(DATABASE_URL);
  });

  afterAll(async () => {
    if (dbClient) await dbClient.close();
  });

  runStorageProviderContract({
    newStorage: async () => {
      // TRUNCATE all data tables between tests so contract tests can
      // use fixed IDs like "trip-1" without colliding across cases.
      // CASCADE handles the FKs from segments / todos / trip_history /
      // processed_emails into trips. RESTART IDENTITY is a no-op
      // (we don't use serial PKs) but harmless and explicit.
      await dbClient.db.execute(sql`
        TRUNCATE TABLE
          trips,
          segments,
          todos,
          trip_history,
          share_rules,
          processed_emails,
          user_settings
        RESTART IDENTITY CASCADE
      `);
      return new SupabaseStorage({ db: dbClient.db, userId: TEST_USER_ID });
    },
  });
});
