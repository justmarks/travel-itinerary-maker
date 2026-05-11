/**
 * End-to-end verification of the phase 3 `/api/v1/connections`
 * endpoints. Spins up the app in `mode: "postgres"`, fakes
 * `req.userId` + `req.authSource` via a thin Express wrapper
 * (matches the pattern in app-postgres-mode.integration.test.ts),
 * and asserts list/upsert/delete round-trips against real Postgres.
 *
 * Auth path stubbing: we set `req.authSource = "supabase"` for the
 * POST tests because the route refuses legacy Google-token requests
 * by design.
 */
import path from "path";
import express from "express";
import request from "supertest";
import { Client } from "pg";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDbClient, type DbClient } from "../../src/db/client";
import { createApp } from "../../src/app";
import { configureAuth } from "../../src/middleware/auth";

const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../drizzle");
const USER_ID = "supabase-user-uuid-1";
// Bearer tokens used by tests must satisfy `looksLikeJwt` (three
// non-empty base64url segments) so the middleware actually invokes
// the Supabase validator. Plain "test-token-x" fails the shape check
// and would fall through to Google.
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
  // base64url-safe encoding (lower-case letters + digits + `-_`).
  const middle = Buffer.from(userId)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `${TOKEN_PREFIX}${middle}${TOKEN_SUFFIX}`;
}

async function buildHarnessApp(dbClient: DbClient): Promise<express.Express> {
  const inner = await createApp({ mode: "postgres", dbClient });
  // createApp's configureAuth runs first; replace its (undefined,
  // because SUPABASE_URL isn't set in tests) validator with a stub
  // that decodes the userId straight from the Bearer token.
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
  // Convenience: tests pass `x-test-user-id` and the wrapper turns
  // that into a Bearer header so they don't have to encode tokens.
  wrapper.use((req, _res, next) => {
    const userId = req.header("x-test-user-id");
    if (userId && !req.headers.authorization) {
      req.headers.authorization = `Bearer ${userIdToBearer(userId)}`;
    }
    next();
  });
  wrapper.use(inner);
  return wrapper;
}

describe("/api/v1/connections", () => {
  let dbClient: DbClient;
  let app: express.Express;

  beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error("DATABASE_URL is required for integration tests.");
    }
    await applyMigrations();
    dbClient = createDbClient(DATABASE_URL);
    app = await buildHarnessApp(dbClient, { authSource: "supabase" });
  });

  afterAll(async () => {
    if (dbClient) await dbClient.close();
  });

  beforeEach(async () => {
    await dbClient.db.execute(sql`TRUNCATE TABLE connections CASCADE`);
  });

  describe("GET /api/v1/connections", () => {
    it("returns an empty list for a user with no connections", async () => {
      const res = await request(app)
        .get("/api/v1/connections")
        .set("x-test-user-id", USER_ID)
        .expect(200);
      expect(res.body).toEqual({ connections: [] });
    });

    it("returns the user's active connections without tokens", async () => {
      await request(app)
        .post("/api/v1/connections")
        .set("x-test-user-id", USER_ID)
        .send({
          provider: "google",
          capability: "identity",
          accountEmail: "alice@example.com",
          refreshToken: "rt-secret",
          accessToken: "at-secret",
          scopes: ["openid", "email"],
        })
        .expect(201);

      const res = await request(app)
        .get("/api/v1/connections")
        .set("x-test-user-id", USER_ID)
        .expect(200);

      expect(res.body.connections).toHaveLength(1);
      const conn = res.body.connections[0];
      expect(conn).toMatchObject({
        provider: "google",
        capability: "identity",
        accountEmail: "alice@example.com",
        scopes: ["openid", "email"],
        status: "active",
      });
      // Crucially: tokens are NOT exposed.
      expect(conn).not.toHaveProperty("refreshToken");
      expect(conn).not.toHaveProperty("accessToken");
      expect(conn).not.toHaveProperty("refreshTokenEncrypted");
      expect(conn).not.toHaveProperty("accessTokenEncrypted");
    });

    it("only returns the requesting user's rows", async () => {
      await request(app)
        .post("/api/v1/connections")
        .set("x-test-user-id", "user-a")
        .send({
          provider: "google",
          capability: "identity",
          accountEmail: "a@example.com",
        });
      await request(app)
        .post("/api/v1/connections")
        .set("x-test-user-id", "user-b")
        .send({
          provider: "microsoft",
          capability: "identity",
          accountEmail: "b@example.com",
        });

      const resA = await request(app)
        .get("/api/v1/connections")
        .set("x-test-user-id", "user-a")
        .expect(200);
      expect(
        resA.body.connections.map((c: { accountEmail: string }) => c.accountEmail),
      ).toEqual(["a@example.com"]);
    });
  });

  describe("POST /api/v1/connections", () => {
    it("creates a new connection and returns it (without tokens)", async () => {
      const res = await request(app)
        .post("/api/v1/connections")
        .set("x-test-user-id", USER_ID)
        .send({
          provider: "microsoft",
          capability: "email",
          accountEmail: "alice@outlook.com",
          refreshToken: "ms-rt",
          accessToken: "ms-at",
          scopes: ["offline_access", "Mail.Read"],
        })
        .expect(201);

      expect(res.body.connection).toMatchObject({
        provider: "microsoft",
        capability: "email",
        accountEmail: "alice@outlook.com",
        scopes: ["offline_access", "Mail.Read"],
        status: "active",
      });
      expect(res.body.connection).not.toHaveProperty("refreshToken");
    });

    it("upserts on the composite key (re-POST same provider/capability/email = update)", async () => {
      await request(app)
        .post("/api/v1/connections")
        .set("x-test-user-id", USER_ID)
        .send({
          provider: "google",
          capability: "identity",
          accountEmail: "alice@example.com",
          scopes: ["openid"],
        })
        .expect(201);
      await request(app)
        .post("/api/v1/connections")
        .set("x-test-user-id", USER_ID)
        .send({
          provider: "google",
          capability: "identity",
          accountEmail: "alice@example.com",
          scopes: ["openid", "email", "profile"],
        })
        .expect(201);

      const list = await request(app)
        .get("/api/v1/connections")
        .set("x-test-user-id", USER_ID)
        .expect(200);
      expect(list.body.connections).toHaveLength(1);
      expect(list.body.connections[0].scopes).toEqual([
        "openid",
        "email",
        "profile",
      ]);
    });

    it("rejects unknown providers", async () => {
      const res = await request(app)
        .post("/api/v1/connections")
        .set("x-test-user-id", USER_ID)
        .send({
          provider: "apple",
          capability: "identity",
          accountEmail: "alice@icloud.com",
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/provider/);
    });

    it("rejects unknown capabilities", async () => {
      const res = await request(app)
        .post("/api/v1/connections")
        .set("x-test-user-id", USER_ID)
        .send({
          provider: "google",
          capability: "drive",
          accountEmail: "alice@example.com",
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/capability/);
    });

    it("rejects malformed accountEmail", async () => {
      const res = await request(app)
        .post("/api/v1/connections")
        .set("x-test-user-id", USER_ID)
        .send({
          provider: "google",
          capability: "identity",
          accountEmail: "not-an-email",
        });
      expect(res.status).toBe(400);
    });

    it("rejects malformed expiresAt", async () => {
      const res = await request(app)
        .post("/api/v1/connections")
        .set("x-test-user-id", USER_ID)
        .send({
          provider: "google",
          capability: "identity",
          accountEmail: "alice@example.com",
          expiresAt: "not-a-date",
        });
      expect(res.status).toBe(400);
    });

    // The legacy-auth-path rejection is a tiny branch (3 lines) that
    // requires a Google-userinfo mock to exercise via integration —
    // not worth the harness complexity. Verified by `LEGACY_AUTH_PATH`
    // being the only `res.status(400).json({code: ...})` site in
    // routes/connections.ts.
  });

  describe("DELETE /api/v1/connections/:id", () => {
    it("soft-deletes the connection (status='revoked', not in list)", async () => {
      const create = await request(app)
        .post("/api/v1/connections")
        .set("x-test-user-id", USER_ID)
        .send({
          provider: "google",
          capability: "identity",
          accountEmail: "alice@example.com",
        })
        .expect(201);
      const connId = create.body.connection.id;

      await request(app)
        .delete(`/api/v1/connections/${connId}`)
        .set("x-test-user-id", USER_ID)
        .expect(204);

      const list = await request(app)
        .get("/api/v1/connections")
        .set("x-test-user-id", USER_ID)
        .expect(200);
      expect(list.body.connections).toEqual([]);

      // Soft-deleted, not hard-deleted.
      const rows = await dbClient.db.execute<{ status: string }>(sql`
        SELECT status FROM connections WHERE id = ${connId}
      `);
      expect(rows.rows[0]?.status).toBe("revoked");
    });

    it("404s when the connection isn't owned by the user", async () => {
      const create = await request(app)
        .post("/api/v1/connections")
        .set("x-test-user-id", USER_ID)
        .send({
          provider: "google",
          capability: "identity",
          accountEmail: "alice@example.com",
        })
        .expect(201);
      const connId = create.body.connection.id;

      await request(app)
        .delete(`/api/v1/connections/${connId}`)
        .set("x-test-user-id", "different-user")
        .expect(404);
    });

    it("404s for a connection id that doesn't exist", async () => {
      await request(app)
        .delete("/api/v1/connections/does-not-exist")
        .set("x-test-user-id", USER_ID)
        .expect(404);
    });
  });
});
