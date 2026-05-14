/**
 * Verifies the phase 2 move: ShareRegistry writes through to Postgres
 * and a fresh instance can hydrate the same state on restart. The
 * in-memory cache behavior is already covered by the unit suite at
 * `__tests__/services/share-registry.test.ts`; this file just exercises
 * the durable persistence path.
 */
import path from "path";
import { Client } from "pg";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDbClient, type DbClient } from "../../src/db/client";
import { ShareRegistry } from "../../src/services/share-registry";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../drizzle");

async function applyMigrations(): Promise<void> {
  const setup = new Client({ connectionString: DATABASE_URL });
  await setup.connect();
  try {
    await setup.query("DROP SCHEMA IF EXISTS public CASCADE");
    await setup.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await setup.query("CREATE SCHEMA public");
    await setup.query("GRANT ALL ON SCHEMA public TO public");
    await migrate(drizzle(setup), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await setup.end();
  }
}

// Wait briefly for fire-and-forget writes (register/remove) to land in
// Postgres before asserting against them. Matches the existing pattern
// for Redis write-through — keeps the route handler synchronous, so
// tests need to give the async write a tick to complete.
async function settle(ms = 50): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("ShareRegistry (Postgres persistence)", () => {
  let dbClient: DbClient;

  beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error("DATABASE_URL is required for integration tests.");
    }
    await applyMigrations();
    dbClient = createDbClient(DATABASE_URL);
    // Seed a trip so FK inserts on trip_shares succeed. share_token
    // values don't need a real owner, but tripId does need to exist.
    await dbClient.db.execute(sql`
      INSERT INTO trips (id, user_id, title, start_date, end_date, status)
      VALUES ('trip-A', 'owner-1', 'Test', '2026-06-01', '2026-06-03', 'planning'),
             ('trip-B', 'owner-1', 'Test 2', '2026-07-01', '2026-07-03', 'planning')
    `);
  });

  afterAll(async () => {
    if (dbClient) await dbClient.close();
  });

  beforeEach(async () => {
    await dbClient.db.execute(sql`TRUNCATE TABLE trip_shares CASCADE`);
  });

  it("write-through: register lands in Postgres", async () => {
    const registry = new ShareRegistry(dbClient);
    registry.register({
      shareToken: "tok-1",
      tripId: "trip-A",
      ownerUserId: "owner-1",
      ownerEmail: "owner@example.com",
      sharedWithEmail: "guest@example.com",
      permission: "view",
      showCosts: true,
      showTodos: true,
    });

    await settle();

    const rows = await dbClient.db.execute(sql`
      SELECT share_token, trip_id, shared_with_email, permission
      FROM trip_shares
    `);
    expect(rows.rows).toEqual([
      {
        share_token: "tok-1",
        trip_id: "trip-A",
        shared_with_email: "guest@example.com",
        permission: "view",
      },
    ]);
  });

  it("hydrate: a fresh registry instance picks up persisted state", async () => {
    // Seed via one registry.
    const writer = new ShareRegistry(dbClient);
    writer.register({
      shareToken: "tok-a",
      tripId: "trip-A",
      ownerUserId: "owner-1",
      sharedWithEmail: "guest@example.com",
      permission: "view",
      showCosts: false,
      showTodos: true,
    });
    writer.register({
      shareToken: "tok-b",
      tripId: "trip-B",
      ownerUserId: "owner-1",
      sharedWithEmail: "guest2@example.com",
      permission: "edit",
      showCosts: true,
      showTodos: false,
    });

    await settle();

    // New registry instance simulates a server restart.
    const reader = new ShareRegistry(dbClient);
    await reader.hydrate();

    expect(reader.lookup("tok-a")?.permission).toBe("view");
    expect(reader.lookup("tok-a")?.showCosts).toBe(false);
    expect(reader.lookup("tok-b")?.permission).toBe("edit");
    expect(reader.lookupByEmail("guest@example.com")).toHaveLength(1);
    expect(reader.lookupByEmail("guest2@example.com")).toHaveLength(1);
  });

  it("remove: deletes from Postgres", async () => {
    const registry = new ShareRegistry(dbClient);
    registry.register({
      shareToken: "tok-x",
      tripId: "trip-A",
      ownerUserId: "owner-1",
      sharedWithEmail: "guest@example.com",
      permission: "view",
      showCosts: true,
      showTodos: true,
    });
    await settle();

    registry.remove("tok-x");
    await settle();

    const rows = await dbClient.db.execute(sql`
      SELECT share_token FROM trip_shares WHERE share_token = 'tok-x'
    `);
    expect(rows.rows).toEqual([]);
  });

  it("cascade delete: removing the trip drops its shares", async () => {
    const registry = new ShareRegistry(dbClient);
    registry.register({
      shareToken: "tok-cascade-1",
      tripId: "trip-A",
      ownerUserId: "owner-1",
      sharedWithEmail: "guest@example.com",
      permission: "view",
      showCosts: true,
      showTodos: true,
    });
    registry.register({
      shareToken: "tok-cascade-2",
      tripId: "trip-A",
      ownerUserId: "owner-1",
      sharedWithEmail: "guest2@example.com",
      permission: "edit",
      showCosts: true,
      showTodos: true,
    });
    await settle();

    await dbClient.db.execute(sql`DELETE FROM trips WHERE id = 'trip-A'`);

    const rows = await dbClient.db.execute(sql`
      SELECT share_token FROM trip_shares WHERE trip_id = 'trip-A'
    `);
    expect(rows.rows).toEqual([]);

    // Re-seed trip-A so other tests still have it.
    await dbClient.db.execute(sql`
      INSERT INTO trips (id, user_id, title, start_date, end_date, status)
      VALUES ('trip-A', 'owner-1', 'Test', '2026-06-01', '2026-06-03', 'planning')
    `);
  });

  it("update-on-conflict: re-registering same token updates the row", async () => {
    const registry = new ShareRegistry(dbClient);
    registry.register({
      shareToken: "tok-upsert",
      tripId: "trip-A",
      ownerUserId: "owner-1",
      sharedWithEmail: "guest@example.com",
      permission: "view",
      showCosts: true,
      showTodos: true,
    });
    await settle();

    registry.register({
      shareToken: "tok-upsert",
      tripId: "trip-A",
      ownerUserId: "owner-1",
      sharedWithEmail: "newguest@example.com",
      permission: "edit",
      showCosts: false,
      showTodos: false,
    });
    await settle();

    const rows = await dbClient.db.execute<{
      shared_with_email: string;
      permission: string;
      show_costs: boolean;
    }>(sql`
      SELECT shared_with_email, permission, show_costs
      FROM trip_shares WHERE share_token = 'tok-upsert'
    `);
    expect(rows.rows).toEqual([
      {
        shared_with_email: "newguest@example.com",
        permission: "edit",
        show_costs: false,
      },
    ]);
  });

  it("no dbClient: in-memory only, no Postgres rows written", async () => {
    const registry = new ShareRegistry(null);
    registry.register({
      shareToken: "tok-memory",
      tripId: "trip-A",
      ownerUserId: "owner-1",
      sharedWithEmail: "guest@example.com",
      permission: "view",
      showCosts: true,
      showTodos: true,
    });
    await settle();

    expect(registry.lookup("tok-memory")).toBeDefined();
    const rows = await dbClient.db.execute(sql`
      SELECT share_token FROM trip_shares WHERE share_token = 'tok-memory'
    `);
    expect(rows.rows).toEqual([]);
  });
});
