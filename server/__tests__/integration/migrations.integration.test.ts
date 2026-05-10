/**
 * Drizzle migration smoke test. Confirms the generated SQL applies
 * cleanly on an empty schema and is idempotent on re-apply, so
 * future schema changes can't accidentally land an un-runnable
 * migration.
 *
 * Each test starts from a freshly-recreated `public` schema so this
 * file is independent of any other integration test's state.
 */
import path from "path";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../drizzle");

async function resetSchema(client: Client): Promise<void> {
  // Drop both `public` (where user tables live) and `drizzle` (where
  // `__drizzle_migrations` lives). Without dropping `drizzle`, the
  // migration journal persists across tests and Drizzle short-circuits
  // re-application as already-done — leaving `public` empty.
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await client.query("CREATE SCHEMA public");
  await client.query("GRANT ALL ON SCHEMA public TO public");
}

async function tableExists(client: Client, name: string): Promise<boolean> {
  const res = await client.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = $1) AS exists",
    [name],
  );
  return res.rows[0].exists;
}

describe("drizzle migrations", () => {
  let client: Client;

  beforeAll(() => {
    if (!DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is required for integration tests. Set it to a " +
          "running Postgres (e.g. `postgres://postgres:postgres@localhost:5432/postgres`).",
      );
    }
  });

  beforeEach(async () => {
    client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    await resetSchema(client);
  });

  afterEach(async () => {
    await client.end();
  });

  it("applies cleanly on an empty schema", async () => {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    expect(await tableExists(client, "_phase0_scaffold")).toBe(true);
  });

  it("re-running migrate on an already-migrated DB is a no-op", async () => {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    // Second call must succeed without throwing or duplicating tables.
    await expect(
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    ).resolves.toBeUndefined();

    expect(await tableExists(client, "_phase0_scaffold")).toBe(true);
  });

  it("re-applies cleanly after a full schema reset", async () => {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    await resetSchema(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    expect(await tableExists(client, "_phase0_scaffold")).toBe(true);
  });

  it("creates expected columns on the scaffold table", async () => {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const res = await client.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns " +
        "WHERE table_schema = 'public' AND table_name = '_phase0_scaffold' " +
        "ORDER BY ordinal_position",
    );
    expect(res.rows.map((r) => r.column_name)).toEqual([
      "id",
      "note",
      "captured_at",
    ]);
  });
});
