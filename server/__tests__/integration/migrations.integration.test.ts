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

// The set of tables every applied migration should leave behind. If
// you add or rename a domain table, update this list — that's the
// signal that the migration smoke test needs to evolve too.
const EXPECTED_TABLES = [
  "trips",
  "segments",
  "todos",
  "trip_history",
  "share_rules",
  "processed_emails",
  "user_settings",
  // Phase 2:
  "trip_shares",
  "push_subscriptions",
  // Phase 3:
  "connections",
];

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

async function listPublicTables(client: Client): Promise<string[]> {
  const res = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  return res.rows.map((r) => r.tablename);
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

    const tables = await listPublicTables(client);
    for (const expected of EXPECTED_TABLES) {
      expect(tables).toContain(expected);
    }
  });

  it("re-running migrate on an already-migrated DB is a no-op", async () => {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    // Second call must succeed without throwing or duplicating tables.
    await expect(
      migrate(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    ).resolves.toBeUndefined();

    const tables = await listPublicTables(client);
    for (const expected of EXPECTED_TABLES) {
      expect(tables).toContain(expected);
    }
  });

  it("re-applies cleanly after a full schema reset", async () => {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    await resetSchema(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const tables = await listPublicTables(client);
    for (const expected of EXPECTED_TABLES) {
      expect(tables).toContain(expected);
    }
  });

  it("trips table exposes the indexed (user_id, start_date) lookup path", async () => {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    const res = await client.query<{ indexname: string; indexdef: string }>(
      "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='trips'",
    );
    const indexNames = res.rows.map((r) => r.indexname);
    expect(indexNames).toContain("trips_user_start_date_idx");
  });

  it("segments cascade-delete with their parent trip", async () => {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    await client.query(
      `INSERT INTO trips (id, user_id, title, start_date, end_date, status)
       VALUES ('t1', 'u1', 'Test', '2026-06-01', '2026-06-03', 'planning')`,
    );
    await client.query(
      `INSERT INTO segments (id, trip_id, day_date, type, title, source)
       VALUES ('s1', 't1', '2026-06-01', 'flight', 'Test flight', 'manual')`,
    );

    await client.query("DELETE FROM trips WHERE id='t1'");

    const res = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM segments WHERE trip_id='t1'",
    );
    expect(res.rows[0].count).toBe("0");
  });

  it("processed_emails NULL trip_id on parent delete", async () => {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    await client.query(
      `INSERT INTO trips (id, user_id, title, start_date, end_date, status)
       VALUES ('t1', 'u1', 'Test', '2026-06-01', '2026-06-03', 'planning')`,
    );
    await client.query(
      `INSERT INTO processed_emails
         (id, user_id, message_id, parse_status, trip_id)
       VALUES ('e1', 'u1', 'msg-1', 'parsed', 't1')`,
    );

    await client.query("DELETE FROM trips WHERE id='t1'");

    const res = await client.query<{ trip_id: string | null }>(
      "SELECT trip_id FROM processed_emails WHERE id='e1'",
    );
    // Email row preserved; only the cross-table link is nulled.
    expect(res.rows[0].trip_id).toBeNull();
  });

  it("share_rules enforce one rule per (owner, recipient)", async () => {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    await client.query(
      `INSERT INTO share_rules
         (id, owner_user_id, shared_with_email, permission)
       VALUES ('r1', 'u1', 'guest@example.com', 'view')`,
    );
    await expect(
      client.query(
        `INSERT INTO share_rules
           (id, owner_user_id, shared_with_email, permission)
         VALUES ('r2', 'u1', 'guest@example.com', 'edit')`,
      ),
    ).rejects.toThrow(/share_rules_owner_recipient_uniq|duplicate key/);
  });

  it("processed_emails enforce unique (user, provider, account, message_id)", async () => {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    await client.query(
      `INSERT INTO processed_emails
         (id, user_id, message_id, parse_status)
       VALUES ('e1', 'u1', 'msg-1', 'parsed')`,
    );
    await expect(
      client.query(
        `INSERT INTO processed_emails
           (id, user_id, message_id, parse_status)
         VALUES ('e2', 'u1', 'msg-1', 'parsed')`,
      ),
    ).rejects.toThrow(/processed_emails_msg_uniq|duplicate key/);
  });

  it("trip_shares cascade-delete with their parent trip", async () => {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    await client.query(
      `INSERT INTO trips (id, user_id, title, start_date, end_date, status)
       VALUES ('t1', 'u1', 'Test', '2026-06-01', '2026-06-03', 'planning')`,
    );
    await client.query(
      `INSERT INTO trip_shares
         (share_token, trip_id, owner_user_id, permission)
       VALUES ('tok-1', 't1', 'u1', 'view')`,
    );

    await client.query("DELETE FROM trips WHERE id='t1'");

    const res = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM trip_shares WHERE trip_id='t1'",
    );
    expect(res.rows[0].count).toBe("0");
  });

  it("push_subscriptions de-dup by endpoint", async () => {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    await client.query(
      `INSERT INTO push_subscriptions
         (endpoint, user_id, email, p256dh, auth)
       VALUES ('https://push/abc', 'u1', 'u1@example.com', 'k1', 'a1')`,
    );
    await expect(
      client.query(
        `INSERT INTO push_subscriptions
           (endpoint, user_id, email, p256dh, auth)
         VALUES ('https://push/abc', 'u2', 'u2@example.com', 'k2', 'a2')`,
      ),
    ).rejects.toThrow(/push_subscriptions_pkey|duplicate key/);
  });

  it("connections enforce unique (user, provider, capability, account_email)", async () => {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    await client.query(
      `INSERT INTO connections
         (id, user_id, provider, capability, account_email)
       VALUES ('c1', 'u1', 'google', 'identity', 'alice@example.com')`,
    );
    // Different id, same (user, provider, capability, email) → reject.
    await expect(
      client.query(
        `INSERT INTO connections
           (id, user_id, provider, capability, account_email)
         VALUES ('c2', 'u1', 'google', 'identity', 'alice@example.com')`,
      ),
    ).rejects.toThrow(/connections_user_provider_capability_email_uniq|duplicate key/);
  });

  it("connections accept multiple capabilities per (user, provider, email)", async () => {
    // A user granting Gmail + Calendar from the same Google account
    // should get separate rows per capability, not a single combined
    // row. The unique constraint discriminates on capability.
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    await client.query(
      `INSERT INTO connections
         (id, user_id, provider, capability, account_email)
       VALUES
         ('c-id', 'u1', 'google', 'identity', 'alice@example.com'),
         ('c-em', 'u1', 'google', 'email', 'alice@example.com'),
         ('c-ca', 'u1', 'google', 'calendar', 'alice@example.com')`,
    );

    const res = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM connections WHERE user_id='u1'",
    );
    expect(res.rows[0].count).toBe("3");
  });

  it("connections accept multiple accounts per (user, provider, capability)", async () => {
    // gmail-personal + gmail-work pattern: same user, same capability,
    // different account_email = legitimate. Phase 4 reads these as
    // distinct mailboxes for the scan job.
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    await client.query(
      `INSERT INTO connections
         (id, user_id, provider, capability, account_email)
       VALUES
         ('c-personal', 'u1', 'google', 'email', 'alice@gmail.com'),
         ('c-work',     'u1', 'google', 'email', 'alice@company.com')`,
    );

    const res = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM connections " +
        "WHERE user_id='u1' AND provider='google' AND capability='email'",
    );
    expect(res.rows[0].count).toBe("2");
  });

  it("connections scopes column is a text[] array", async () => {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

    await client.query(
      `INSERT INTO connections
         (id, user_id, provider, capability, account_email, scopes)
       VALUES ('c1', 'u1', 'google', 'identity', 'alice@example.com',
               ARRAY['openid', 'email', 'profile'])`,
    );

    const res = await client.query<{ scopes: string[] }>(
      "SELECT scopes FROM connections WHERE id='c1'",
    );
    expect(res.rows[0].scopes).toEqual(["openid", "email", "profile"]);
  });
});
