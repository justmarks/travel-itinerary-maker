/**
 * Verifies the phase 2 move: PushSubscriptionStore writes through to
 * Postgres and a fresh instance can hydrate the same state on restart.
 * The in-memory cache behavior is already covered by the unit suite at
 * `__tests__/services/push-subscription-store.test.ts`; this file just
 * exercises the durable persistence path.
 */
import path from "path";
import { Client } from "pg";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDbClient, type DbClient } from "../../src/db/client";
import { PushSubscriptionStore } from "../../src/services/push-subscription-store";

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

// Same fire-and-forget settle helper as ShareRegistry integration tests.
async function settle(ms = 50): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const sub = (endpoint: string) => ({
  endpoint,
  keys: { p256dh: `p256-${endpoint}`, auth: `auth-${endpoint}` },
});

describe("PushSubscriptionStore (Postgres persistence)", () => {
  let dbClient: DbClient;

  beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error("DATABASE_URL is required for integration tests.");
    }
    await applyMigrations();
    dbClient = createDbClient(DATABASE_URL);
  });

  afterAll(async () => {
    if (dbClient) await dbClient.close();
  });

  beforeEach(async () => {
    await dbClient.db.execute(sql`TRUNCATE TABLE push_subscriptions CASCADE`);
  });

  it("write-through: upsert lands in Postgres", async () => {
    const store = new PushSubscriptionStore(dbClient);
    store.upsert({
      userId: "u1",
      email: "alice@example.com",
      subscription: sub("https://push/abc"),
      userAgent: "Firefox 100",
    });

    await settle();

    const rows = await dbClient.db.execute(sql`
      SELECT endpoint, user_id, email, p256dh, auth, user_agent
      FROM push_subscriptions
    `);
    expect(rows.rows).toEqual([
      {
        endpoint: "https://push/abc",
        user_id: "u1",
        email: "alice@example.com",
        p256dh: "p256-https://push/abc",
        auth: "auth-https://push/abc",
        user_agent: "Firefox 100",
      },
    ]);
  });

  it("hydrate: a fresh store picks up persisted state", async () => {
    const writer = new PushSubscriptionStore(dbClient);
    writer.upsert({
      userId: "u1",
      email: "alice@example.com",
      subscription: sub("https://push/abc"),
    });
    writer.upsert({
      userId: "u2",
      email: "bob@example.com",
      subscription: sub("https://push/xyz"),
    });

    await settle();

    const reader = new PushSubscriptionStore(dbClient);
    await reader.hydrate();

    expect(reader.listForUser("u1")).toHaveLength(1);
    expect(reader.listForUser("u2")).toHaveLength(1);
    expect(reader.listForEmail("alice@example.com")).toHaveLength(1);
    expect(reader.listForEmail("bob@example.com")).toHaveLength(1);
  });

  it("upsert: same browser re-registering updates the row, doesn't duplicate", async () => {
    const store = new PushSubscriptionStore(dbClient);
    store.upsert({
      userId: "u1",
      email: "alice@example.com",
      subscription: sub("https://push/same"),
      userAgent: "Firefox 100",
    });
    await settle();

    // Same endpoint, different email + UA — same browser, account switch.
    store.upsert({
      userId: "u2",
      email: "newowner@example.com",
      subscription: sub("https://push/same"),
      userAgent: "Firefox 101",
    });
    await settle();

    const rows = await dbClient.db.execute<{
      user_id: string;
      email: string;
      user_agent: string;
    }>(sql`
      SELECT user_id, email, user_agent
      FROM push_subscriptions WHERE endpoint = 'https://push/same'
    `);
    expect(rows.rows).toEqual([
      {
        user_id: "u2",
        email: "newowner@example.com",
        user_agent: "Firefox 101",
      },
    ]);
  });

  it("remove: deletes from Postgres", async () => {
    const store = new PushSubscriptionStore(dbClient);
    store.upsert({
      userId: "u1",
      email: "alice@example.com",
      subscription: sub("https://push/gone"),
    });
    await settle();

    store.remove("u1", "https://push/gone");
    await settle();

    const rows = await dbClient.db.execute(sql`
      SELECT endpoint FROM push_subscriptions WHERE endpoint = 'https://push/gone'
    `);
    expect(rows.rows).toEqual([]);
  });

  it("removeByEndpoint: deletes regardless of owning user", async () => {
    const store = new PushSubscriptionStore(dbClient);
    store.upsert({
      userId: "u1",
      email: "alice@example.com",
      subscription: sub("https://push/410"),
    });
    await settle();

    // Caller doesn't know which user owns it (e.g. push provider 410).
    store.removeByEndpoint("https://push/410");
    await settle();

    const rows = await dbClient.db.execute(sql`
      SELECT endpoint FROM push_subscriptions WHERE endpoint = 'https://push/410'
    `);
    expect(rows.rows).toEqual([]);
  });

  it("no dbClient: in-memory only, no Postgres rows written", async () => {
    const store = new PushSubscriptionStore(null);
    store.upsert({
      userId: "u1",
      email: "alice@example.com",
      subscription: sub("https://push/memory-only"),
    });
    await settle();

    expect(store.listForUser("u1")).toHaveLength(1);
    const rows = await dbClient.db.execute(sql`
      SELECT endpoint FROM push_subscriptions WHERE endpoint = 'https://push/memory-only'
    `);
    expect(rows.rows).toEqual([]);
  });
});
