/**
 * End-to-end verification of `DELETE /api/v1/account`. Seeds rows for
 * the target user across every user-scoped table (plus a sibling user
 * whose data must survive), invokes the endpoint with a stubbed
 * Supabase admin client, and asserts:
 *   - 204 response
 *   - target user's rows are gone (including FK-cascaded children)
 *   - sibling user's rows are intact
 *   - the Supabase admin stub was called exactly once
 *   - the upstream-revoke fetch was called once per active connection
 *
 * Auth path: same JWT-shaped-token + injected validator trick as
 * connections-routes.integration.test.ts.
 */
import path from "path";
import express from "express";
import request from "supertest";
import { Client } from "pg";
import { sql, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDbClient, type DbClient } from "../../src/db/client";
import { createApp } from "../../src/app";
import { configureAuth } from "../../src/middleware/auth";
import { ConnectionsStore } from "../../src/services/connections-store";
import {
  trips,
  segments,
  todos,
  tripHistory,
  shareRules,
  processedEmails,
  userSettings,
  tripShares,
  pushSubscriptions,
  connections,
} from "../../src/db/schema";
import type { SupabaseAdmin } from "../../src/services/supabase-admin";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../drizzle");
const USER_ID = "supabase-user-account-delete";
const OTHER_USER_ID = "supabase-user-sibling";

const TOKEN_PREFIX = "eyJ0ZXN0Ijoi.";
const TOKEN_SUFFIX = ".sig";

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

function userIdToBearer(userId: string): string {
  const middle = Buffer.from(userId)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${TOKEN_PREFIX}${middle}${TOKEN_SUFFIX}`;
}

interface AccountTestHarness {
  app: express.Express;
  supabaseAdmin: SupabaseAdmin & { deleteUser: jest.Mock };
}

async function buildHarnessApp(dbClient: DbClient): Promise<AccountTestHarness> {
  const supabaseAdmin = {
    deleteUser: jest.fn(async (_userId: string) => ({
      ok: true,
      status: 204,
    })),
  };
  const inner = await createApp({
    mode: "postgres",
    dbClient,
    supabaseAdmin,
  });
  configureAuth({
    supabaseValidator: async (token: string) => {
      const middle = token.slice(
        TOKEN_PREFIX.length,
        token.length - TOKEN_SUFFIX.length,
      );
      const userId = Buffer.from(
        middle.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf8");
      if (!userId) throw new Error("test stub: empty userId");
      return {
        sub: userId,
        email: `${userId}@example.com`,
        provider: "google",
      };
    },
  });
  const wrapper = express();
  wrapper.use((req, _res, next) => {
    const userId = req.header("x-test-user-id");
    if (userId && !req.headers.authorization) {
      req.headers.authorization = `Bearer ${userIdToBearer(userId)}`;
    }
    next();
  });
  wrapper.use(inner);
  return { app: wrapper, supabaseAdmin };
}

async function seedUserFixtures(
  dbClient: DbClient,
  userId: string,
  prefix: string,
): Promise<{ tripId: string }> {
  const tripId = `${prefix}-trip-1`;
  const segmentId = `${prefix}-seg-1`;
  const todoId = `${prefix}-todo-1`;
  const historyId = `${prefix}-hist-1`;
  const shareRuleId = `${prefix}-rule-1`;
  const processedId = `${prefix}-msg-1`;
  const shareToken = `${prefix}-tok-1`;
  const endpoint = `https://example.com/push/${prefix}`;

  await dbClient.db.insert(trips).values({
    id: tripId,
    userId,
    title: `${prefix} trip`,
    startDate: "2026-06-01",
    endDate: "2026-06-05",
    status: "planning",
  });
  await dbClient.db.insert(segments).values({
    id: segmentId,
    tripId,
    dayDate: "2026-06-01",
    sortOrder: 0,
    type: "flight",
    title: "Seg",
    source: "manual",
  });
  await dbClient.db.insert(todos).values({
    id: todoId,
    tripId,
    text: "todo",
    completed: false,
    category: "logistics",
    sortOrder: 0,
  });
  await dbClient.db.insert(tripHistory).values({
    id: historyId,
    tripId,
    op: "trip-created",
    actorUserId: userId,
    actorEmail: `${userId}@example.com`,
    payload: {},
    createdAt: new Date(),
  });
  await dbClient.db.insert(shareRules).values({
    id: shareRuleId,
    ownerUserId: userId,
    ownerEmail: `${userId}@example.com`,
    sharedWithEmail: `guest-${prefix}@example.com`,
    permission: "view",
    showCosts: true,
    showTodos: true,
  });
  await dbClient.db.insert(processedEmails).values({
    id: processedId,
    userId,
    provider: "google",
    accountEmail: `${userId}@example.com`,
    messageId: processedId,
    parseStatus: "success",
  });
  await dbClient.db.insert(userSettings).values({
    userId,
    emailScanIntervalMinutes: 1440,
    notificationsEnabled: true,
  });
  await dbClient.db.insert(tripShares).values({
    shareToken,
    tripId,
    ownerUserId: userId,
    ownerEmail: `${userId}@example.com`,
    sharedWithEmail: `guest-${prefix}@example.com`,
    permission: "view",
    showCosts: true,
    showTodos: true,
  });
  await dbClient.db.insert(pushSubscriptions).values({
    endpoint,
    userId,
    email: `${userId}@example.com`,
    p256dh: "p256dh",
    auth: "auth",
  });
  return { tripId };
}

async function countRows(
  dbClient: DbClient,
  table:
    | typeof trips
    | typeof segments
    | typeof todos
    | typeof tripHistory
    | typeof shareRules
    | typeof processedEmails
    | typeof userSettings
    | typeof tripShares
    | typeof pushSubscriptions
    | typeof connections,
  userIdColumn: { name: string },
  userId: string,
): Promise<number> {
  const rows = await dbClient.db
    .select()
    .from(table)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .where(eq((table as any)[userIdColumn.name], userId));
  return rows.length;
}

describe("DELETE /api/v1/account", () => {
  let dbClient: DbClient;
  let harness: AccountTestHarness;
  let fetchSpy: jest.SpyInstance;

  beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error("DATABASE_URL is required for integration tests.");
    }
    await applyMigrations();
    dbClient = createDbClient(DATABASE_URL);
    harness = await buildHarnessApp(dbClient);
  });

  afterAll(async () => {
    if (dbClient) await dbClient.close();
  });

  beforeEach(async () => {
    // CASCADE order: trip-child tables first, then everything else.
    await dbClient.db.execute(
      sql`TRUNCATE TABLE trips, share_rules, processed_emails, user_settings, push_subscriptions, connections CASCADE`,
    );
    harness.supabaseAdmin.deleteUser.mockClear();
    // Stub `fetch` so the route's upstream-revoke calls don't hit the
    // real network. Resolves all calls as 200 OK.
    fetchSpy = jest
      .spyOn(global, "fetch")
      .mockImplementation(async () =>
        new Response("", { status: 200 }),
      );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("wipes every user-scoped row, revokes upstream tokens, and deletes the Supabase Auth user", async () => {
    await seedUserFixtures(dbClient, USER_ID, "victim");
    await seedUserFixtures(dbClient, OTHER_USER_ID, "sibling");

    // Two connection rows for the target user — one Google identity,
    // one Microsoft calendar. We expect at least the Google one to
    // get revoked at https://oauth2.googleapis.com/revoke.
    const store = new ConnectionsStore(dbClient, null);
    await store.upsert({
      id: "victim-conn-google",
      userId: USER_ID,
      provider: "google",
      capability: "identity",
      accountEmail: "victim@gmail.com",
      refreshToken: "google-rt",
      accessToken: "google-at",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      scopes: ["openid", "email"],
    });
    await store.upsert({
      id: "victim-conn-ms",
      userId: USER_ID,
      provider: "microsoft",
      capability: "calendar",
      accountEmail: "victim@outlook.com",
      refreshToken: "ms-rt",
      accessToken: "ms-at",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      scopes: ["Calendars.ReadWrite"],
    });

    await request(harness.app)
      .delete("/api/v1/account")
      .set("x-test-user-id", USER_ID)
      .expect(204);

    // Target user rows are gone.
    expect(
      await countRows(dbClient, trips, { name: "userId" }, USER_ID),
    ).toBe(0);
    expect(
      await countRows(dbClient, shareRules, { name: "ownerUserId" }, USER_ID),
    ).toBe(0);
    expect(
      await countRows(
        dbClient,
        processedEmails,
        { name: "userId" },
        USER_ID,
      ),
    ).toBe(0);
    expect(
      await countRows(dbClient, userSettings, { name: "userId" }, USER_ID),
    ).toBe(0);
    expect(
      await countRows(
        dbClient,
        pushSubscriptions,
        { name: "userId" },
        USER_ID,
      ),
    ).toBe(0);
    expect(
      await countRows(dbClient, connections, { name: "userId" }, USER_ID),
    ).toBe(0);

    // FK-cascaded children also gone (trip row is the parent).
    const victimSegments = await dbClient.db
      .select()
      .from(segments)
      .where(eq(segments.tripId, "victim-trip-1"));
    expect(victimSegments).toEqual([]);
    const victimTodos = await dbClient.db
      .select()
      .from(todos)
      .where(eq(todos.tripId, "victim-trip-1"));
    expect(victimTodos).toEqual([]);
    const victimHistory = await dbClient.db
      .select()
      .from(tripHistory)
      .where(eq(tripHistory.tripId, "victim-trip-1"));
    expect(victimHistory).toEqual([]);
    const victimShares = await dbClient.db
      .select()
      .from(tripShares)
      .where(eq(tripShares.tripId, "victim-trip-1"));
    expect(victimShares).toEqual([]);

    // Sibling user is fully intact.
    expect(
      await countRows(dbClient, trips, { name: "userId" }, OTHER_USER_ID),
    ).toBe(1);
    expect(
      await countRows(
        dbClient,
        shareRules,
        { name: "ownerUserId" },
        OTHER_USER_ID,
      ),
    ).toBe(1);
    expect(
      await countRows(
        dbClient,
        processedEmails,
        { name: "userId" },
        OTHER_USER_ID,
      ),
    ).toBe(1);

    // Supabase admin deleteUser called once with the right id.
    expect(harness.supabaseAdmin.deleteUser).toHaveBeenCalledTimes(1);
    expect(harness.supabaseAdmin.deleteUser).toHaveBeenCalledWith(USER_ID);

    // At least one Google revoke + one Microsoft revoke fetch fired.
    const fetchCalls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(
      fetchCalls.some((url) =>
        url.startsWith("https://oauth2.googleapis.com/revoke?token="),
      ),
    ).toBe(true);
    expect(
      fetchCalls.some(
        (url) =>
          url ===
          "https://graph.microsoft.com/v1.0/me/revokeSignInSessions",
      ),
    ).toBe(true);
  });

  it("returns 204 even when the upstream revoke fetch fails", async () => {
    await seedUserFixtures(dbClient, USER_ID, "victim");
    const store = new ConnectionsStore(dbClient, null);
    await store.upsert({
      id: "victim-conn-google-fail",
      userId: USER_ID,
      provider: "google",
      capability: "identity",
      accountEmail: "victim@gmail.com",
      refreshToken: "google-rt",
      accessToken: "google-at",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      scopes: ["openid"],
    });

    fetchSpy.mockImplementation(
      async () => new Response("revoke failed", { status: 500 }),
    );

    await request(harness.app)
      .delete("/api/v1/account")
      .set("x-test-user-id", USER_ID)
      .expect(204);

    expect(
      await countRows(dbClient, trips, { name: "userId" }, USER_ID),
    ).toBe(0);
    expect(
      await countRows(dbClient, connections, { name: "userId" }, USER_ID),
    ).toBe(0);
  });

  it("returns 204 even when the Supabase admin call fails", async () => {
    await seedUserFixtures(dbClient, USER_ID, "victim");
    harness.supabaseAdmin.deleteUser.mockImplementationOnce(async () => ({
      ok: false,
      status: 500,
      body: "service unavailable",
    }));

    await request(harness.app)
      .delete("/api/v1/account")
      .set("x-test-user-id", USER_ID)
      .expect(204);

    // Local cleanup still happened.
    expect(
      await countRows(dbClient, trips, { name: "userId" }, USER_ID),
    ).toBe(0);
  });

  it("rejects requests with no auth", async () => {
    await request(harness.app).delete("/api/v1/account").expect(401);
  });
});
