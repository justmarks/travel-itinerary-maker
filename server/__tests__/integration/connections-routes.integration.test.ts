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

    it("drops Google-shaped tokens when writing to a microsoft row", async () => {
      // Production failure mode: the auth-callback link flow can leak
      // the previous Google OAuth round's tokens into the new
      // Microsoft connection. The route must refuse to persist them
      // — better to leave the row tokenless (resolver will return
      // null → reconnect prompt) than to poison the cache with a
      // Google `ya29.*` access token that Graph rejects as
      // "JWT not well formed."
      const res = await request(app)
        .post("/api/v1/connections")
        .set("x-test-user-id", USER_ID)
        .send({
          provider: "microsoft",
          capability: "calendar",
          accountEmail: "alice@outlook.com",
          accessToken: "ya29.a0AfH6SMxxxxx_google_shaped_token_xxxxx",
          refreshToken: "1//google_shaped_refresh_token_xxxxxxx",
          scopes: ["offline_access", "Calendars.ReadWrite"],
        })
        .expect(201);

      expect(res.body.connection.provider).toBe("microsoft");

      // The row exists but neither token survived the write. Confirm
      // by going to the underlying table since the public view masks
      // tokens unconditionally.
      const rows = await dbClient.db.execute<{
        access_token_encrypted: string | null;
        refresh_token_encrypted: string | null;
      }>(sql`
        SELECT access_token_encrypted, refresh_token_encrypted
        FROM connections WHERE id = ${res.body.connection.id}
      `);
      expect(rows.rows[0]?.access_token_encrypted).toBeNull();
      expect(rows.rows[0]?.refresh_token_encrypted).toBeNull();
    });

    it("accepts Google-shaped tokens for a google row (no false positive)", async () => {
      const res = await request(app)
        .post("/api/v1/connections")
        .set("x-test-user-id", USER_ID)
        .send({
          provider: "google",
          capability: "calendar",
          accountEmail: "alice@gmail.com",
          accessToken: "ya29.a0AfH6SMxxxxx_legitimate_google_token",
          refreshToken: "1//legitimate_google_refresh_token",
          scopes: ["https://www.googleapis.com/auth/calendar"],
        })
        .expect(201);

      const rows = await dbClient.db.execute<{
        access_token_encrypted: string | null;
        refresh_token_encrypted: string | null;
      }>(sql`
        SELECT access_token_encrypted, refresh_token_encrypted
        FROM connections WHERE id = ${res.body.connection.id}
      `);
      // Tokens stored (encrypted, but non-null is what matters here).
      expect(rows.rows[0]?.access_token_encrypted).not.toBeNull();
      expect(rows.rows[0]?.refresh_token_encrypted).not.toBeNull();
    });

    describe("Google email scope validation (tokeninfo)", () => {
      // Regression: the auth-callback page POSTs the *requested* scope
      // list from sessionStorage (`pending.scopes`), not the actually-
      // granted set. A user who unchecked "View your Gmail" on the
      // consent screen previously ended up with a row that claimed
      // gmail.readonly while the underlying token only granted
      // identity scopes. Step 5 (scan emails) then failed with
      // "could not load labels for gmail" because the cached token
      // lacked the scope. We now call Google's tokeninfo endpoint to
      // verify and either store the truth or reject the write.
      let fetchSpy: jest.SpyInstance;

      beforeEach(() => {
        fetchSpy = jest.spyOn(global, "fetch");
      });

      afterEach(() => {
        fetchSpy.mockRestore();
      });

      function mockTokeninfoScope(scope: string): void {
        fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
          const url = typeof input === "string" ? input : input.toString();
          if (url.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
            return new Response(JSON.stringify({ scope }), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          }
          throw new Error(`unexpected fetch in test: ${url}`);
        });
      }

      it("rejects google/email writes when tokeninfo says gmail.readonly was not granted", async () => {
        mockTokeninfoScope("openid email profile");

        const res = await request(app)
          .post("/api/v1/connections")
          .set("x-test-user-id", USER_ID)
          .send({
            provider: "google",
            capability: "email",
            accountEmail: "alice@gmail.com",
            accessToken: "ya29.a0AfH6SMxxxxx_token_without_gmail_scope",
            refreshToken: "1//refresh_token_without_gmail_scope",
            // Client claims gmail.readonly was requested — the auth-
            // callback sends `pending.scopes` from sessionStorage,
            // which is the REQUESTED set, not the granted one.
            scopes: [
              "openid",
              "email",
              "profile",
              "https://www.googleapis.com/auth/gmail.readonly",
            ],
          });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe("GMAIL_SCOPE_NOT_GRANTED");
        expect(res.body.error).toMatch(/Gmail/i);

        // No row should have been written.
        const rows = await dbClient.db.execute<{ count: string }>(sql`
          SELECT COUNT(*)::text AS count FROM connections WHERE user_id = ${USER_ID}
        `);
        expect(rows.rows[0]?.count).toBe("0");
      });

      it("accepts google/email writes when tokeninfo confirms gmail.readonly, and stores granted scopes (not client-supplied)", async () => {
        // Tokeninfo returns the *actually-granted* set. Note we
        // deliberately differ from the client-supplied list to lock
        // in that the server prefers truth over assertion.
        mockTokeninfoScope(
          "openid email profile https://www.googleapis.com/auth/gmail.readonly",
        );

        const res = await request(app)
          .post("/api/v1/connections")
          .set("x-test-user-id", USER_ID)
          .send({
            provider: "google",
            capability: "email",
            accountEmail: "alice@gmail.com",
            accessToken: "ya29.a0AfH6SMxxxxx_token_with_gmail_scope",
            refreshToken: "1//refresh_token_with_gmail_scope",
            // Client claims an extra scope it didn't actually get
            // (or fewer scopes than were granted, depending on the
            // round). The stored set should reflect tokeninfo, not
            // this list.
            scopes: [
              "openid",
              "email",
              "https://www.googleapis.com/auth/gmail.readonly",
              "https://www.googleapis.com/auth/calendar.events",
            ],
          })
          .expect(201);

        expect(res.body.connection.scopes).toEqual([
          "openid",
          "email",
          "profile",
          "https://www.googleapis.com/auth/gmail.readonly",
        ]);
      });

      it("falls through to client-supplied scopes when tokeninfo is unreachable (proceeds with warn)", async () => {
        // Network failure / Google API hiccup — the server logs a warn
        // and trusts the client-supplied list. Downstream's
        // GMAIL_SCOPE_REQUIRED 403 backstops the actual access check.
        fetchSpy.mockRejectedValue(new Error("network down"));

        const res = await request(app)
          .post("/api/v1/connections")
          .set("x-test-user-id", USER_ID)
          .send({
            provider: "google",
            capability: "email",
            accountEmail: "alice@gmail.com",
            accessToken: "ya29.a0AfH6SMxxxxx_token",
            refreshToken: "1//refresh_token",
            scopes: [
              "openid",
              "email",
              "https://www.googleapis.com/auth/gmail.readonly",
            ],
          })
          .expect(201);

        expect(res.body.connection.scopes).toEqual([
          "openid",
          "email",
          "https://www.googleapis.com/auth/gmail.readonly",
        ]);
      });

      it("skips validation when no access token is present (can't validate without one)", async () => {
        // Supabase sometimes elides `provider_token` for returning
        // users; without an access token we have nothing to call
        // tokeninfo with. Don't block the write — the row exists as
        // a "this user attempted to link" record and the downstream
        // resolver will return `EMAIL_NOT_CONNECTED` until a follow-
        // up Connect provides a real token.
        const res = await request(app)
          .post("/api/v1/connections")
          .set("x-test-user-id", USER_ID)
          .send({
            provider: "google",
            capability: "email",
            accountEmail: "alice@gmail.com",
            // No accessToken / refreshToken.
            scopes: [
              "openid",
              "email",
              "https://www.googleapis.com/auth/gmail.readonly",
            ],
          })
          .expect(201);

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(res.body.connection.scopes).toEqual([
          "openid",
          "email",
          "https://www.googleapis.com/auth/gmail.readonly",
        ]);
      });

      it("does not call Google's tokeninfo for microsoft/email writes", async () => {
        // The microsoft/email branch reads the `scp` claim off the
        // access-token JWT locally (no HTTP call), so the Google
        // tokeninfo spy stays untouched. A non-JWT MSA token falls
        // through to the client-supplied scopes — see the dedicated
        // Microsoft suite below for the JWT-shaped happy / sad paths.
        const res = await request(app)
          .post("/api/v1/connections")
          .set("x-test-user-id", USER_ID)
          .send({
            provider: "microsoft",
            capability: "email",
            accountEmail: "alice@outlook.com",
            accessToken: "M.R3_BAY.opaque-msa-token",
            refreshToken: "ms-rt",
            scopes: ["offline_access", "Mail.Read"],
          })
          .expect(201);

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(res.body.connection.provider).toBe("microsoft");
      });

      it("does not validate google/calendar writes (validation is gmail-specific)", async () => {
        const res = await request(app)
          .post("/api/v1/connections")
          .set("x-test-user-id", USER_ID)
          .send({
            provider: "google",
            capability: "calendar",
            accountEmail: "alice@gmail.com",
            accessToken: "ya29.calendar_token",
            refreshToken: "1//calendar_refresh",
            scopes: ["https://www.googleapis.com/auth/calendar.events"],
          })
          .expect(201);

        expect(fetchSpy).not.toHaveBeenCalled();
      });
    });

    describe("Microsoft email/calendar scope validation (scp claim)", () => {
      // Mirrors the Google branch: the auth-callback POSTs the
      // REQUESTED scope set (from sessionStorage), not the granted
      // one. A user who deselected Mail.Read / Calendars.ReadWrite on
      // Microsoft's consent screen previously ended up with a row
      // that claimed those scopes — the first Graph call then 401'd
      // and the UX showed "Connected" while every feature failed.
      // We now read the `scp` claim off the access-token JWT and
      // reject the write outright when the required scope is missing.
      function jwtWithScp(scp: string): string {
        const b64 = (obj: unknown): string =>
          Buffer.from(JSON.stringify(obj))
            .toString("base64")
            .replace(/=+$/, "")
            .replace(/\+/g, "-")
            .replace(/\//g, "_");
        return `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ scp })}.fake-sig`;
      }

      it("rejects microsoft/email writes when scp lacks Mail.Read", async () => {
        const res = await request(app)
          .post("/api/v1/connections")
          .set("x-test-user-id", USER_ID)
          .send({
            provider: "microsoft",
            capability: "email",
            accountEmail: "alice@outlook.com",
            accessToken: jwtWithScp("openid email profile User.Read"),
            refreshToken: "ms-rt",
            scopes: ["offline_access", "Mail.Read", "User.Read"],
          });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("MICROSOFT_MAIL_SCOPE_NOT_GRANTED");
        expect(res.body.error).toMatch(/Outlook/i);
      });

      it("rejects microsoft/calendar writes when scp lacks Calendars.ReadWrite", async () => {
        const res = await request(app)
          .post("/api/v1/connections")
          .set("x-test-user-id", USER_ID)
          .send({
            provider: "microsoft",
            capability: "calendar",
            accountEmail: "alice@outlook.com",
            accessToken: jwtWithScp("openid email profile"),
            refreshToken: "ms-rt",
            scopes: ["offline_access", "Calendars.ReadWrite"],
          });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("MICROSOFT_CALENDAR_SCOPE_NOT_GRANTED");
      });

      it("accepts and stores the granted scp set (not the client-supplied one)", async () => {
        const granted = "openid email profile Mail.Read offline_access";
        const res = await request(app)
          .post("/api/v1/connections")
          .set("x-test-user-id", USER_ID)
          .send({
            provider: "microsoft",
            capability: "email",
            accountEmail: "alice@outlook.com",
            accessToken: jwtWithScp(granted),
            refreshToken: "ms-rt",
            // Client claims an extra scope the token doesn't carry.
            // Stored set should reflect the scp claim.
            scopes: ["offline_access", "Mail.Read", "Calendars.ReadWrite"],
          })
          .expect(201);
        expect(res.body.connection.scopes).toEqual([
          "openid",
          "email",
          "profile",
          "Mail.Read",
          "offline_access",
        ]);
      });

      it("falls through with a warn when the token isn't a parseable JWT (MSA opaque)", async () => {
        // Personal Microsoft Accounts issue `M.R3_BAY.<opaque>` tokens
        // that aren't JWTs; we can't read scopes from them. Trust the
        // client-supplied list and rely on Graph 401 as the backstop —
        // same shape as Google's "tokeninfo unreachable" fallback.
        const res = await request(app)
          .post("/api/v1/connections")
          .set("x-test-user-id", USER_ID)
          .send({
            provider: "microsoft",
            capability: "email",
            accountEmail: "alice@outlook.com",
            accessToken: "M.R3_BAY.opaque",
            refreshToken: "ms-rt",
            scopes: ["offline_access", "Mail.Read"],
          })
          .expect(201);
        expect(res.body.connection.scopes).toEqual([
          "offline_access",
          "Mail.Read",
        ]);
      });

      it("does not validate microsoft/identity writes (no capability scope needed)", async () => {
        const res = await request(app)
          .post("/api/v1/connections")
          .set("x-test-user-id", USER_ID)
          .send({
            provider: "microsoft",
            capability: "identity",
            accountEmail: "alice@outlook.com",
            accessToken: jwtWithScp("openid email profile"),
            refreshToken: "ms-rt",
          })
          .expect(201);
        expect(res.body.connection.provider).toBe("microsoft");
      });
    });
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
