/**
 * Verifies the phase 3 ConnectionsStore against a real Postgres:
 * upsert semantics, soft-delete, composite-key uniqueness, encrypted
 * round-trips, and multi-account / multi-capability rows.
 */
import path from "path";
import { Client } from "pg";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { randomBytes } from "crypto";
import { createDbClient, type DbClient } from "../../src/db/client";
import { ConnectionsStore } from "../../src/services/connections-store";

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

describe("ConnectionsStore (Postgres)", () => {
  let dbClient: DbClient;
  // 32-byte key for AES-256-GCM — same shape `loadEncryptionKey` would
  // return. Lets us assert real encryption rather than the plaintext
  // fallback.
  const encryptionKey = randomBytes(32);

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
    await dbClient.db.execute(sql`TRUNCATE TABLE connections CASCADE`);
  });

  describe("upsert + findByKey", () => {
    it("creates a new row when the composite key is unseen", async () => {
      const store = new ConnectionsStore(dbClient, encryptionKey);
      const result = await store.upsert({
        id: "c-1",
        userId: "u-1",
        provider: "google",
        capability: "identity",
        accountEmail: "alice@example.com",
        refreshToken: "rt-google-1",
        accessToken: "at-google-1",
        scopes: ["openid", "email", "profile"],
      });

      expect(result.userId).toBe("u-1");
      expect(result.refreshToken).toBe("rt-google-1");
      expect(result.accessToken).toBe("at-google-1");
      expect(result.scopes).toEqual(["openid", "email", "profile"]);
      expect(result.status).toBe("active");
    });

    it("normalizes account_email to lower-case on write", async () => {
      const store = new ConnectionsStore(dbClient, encryptionKey);
      await store.upsert({
        id: "c-1",
        userId: "u-1",
        provider: "google",
        capability: "identity",
        accountEmail: "Alice@Example.COM",
      });

      const found = await store.findByKey({
        userId: "u-1",
        provider: "google",
        capability: "identity",
        accountEmail: "alice@example.com",
      });
      expect(found?.accountEmail).toBe("alice@example.com");
    });

    it("updates an existing row when the composite key matches", async () => {
      const store = new ConnectionsStore(dbClient, encryptionKey);
      await store.upsert({
        id: "c-1",
        userId: "u-1",
        provider: "google",
        capability: "identity",
        accountEmail: "alice@example.com",
        refreshToken: "rt-old",
        scopes: ["openid"],
      });
      await store.upsert({
        // Note: id differs but composite key matches — the row should
        // be updated, not duplicated.
        id: "c-different-id",
        userId: "u-1",
        provider: "google",
        capability: "identity",
        accountEmail: "alice@example.com",
        refreshToken: "rt-new",
        scopes: ["openid", "email", "profile"],
      });

      const all = await dbClient.db.execute(sql`
        SELECT COUNT(*)::int AS count FROM connections
        WHERE user_id = 'u-1' AND account_email = 'alice@example.com'
      `);
      expect(all.rows[0]).toEqual({ count: 1 });

      const found = await store.findByKey({
        userId: "u-1",
        provider: "google",
        capability: "identity",
        accountEmail: "alice@example.com",
      });
      expect(found?.refreshToken).toBe("rt-new");
      expect(found?.scopes).toEqual(["openid", "email", "profile"]);
    });

    it("flips a revoked row back to active on re-connect", async () => {
      const store = new ConnectionsStore(dbClient, encryptionKey);
      const initial = await store.upsert({
        id: "c-1",
        userId: "u-1",
        provider: "google",
        capability: "identity",
        accountEmail: "alice@example.com",
      });
      await store.markRevoked(initial.id, "u-1");

      const reconnected = await store.upsert({
        id: "c-reconnect",
        userId: "u-1",
        provider: "google",
        capability: "identity",
        accountEmail: "alice@example.com",
        refreshToken: "rt-new",
      });

      expect(reconnected.status).toBe("active");
      expect(reconnected.refreshToken).toBe("rt-new");
    });

    it("returns null for a missing composite key", async () => {
      const store = new ConnectionsStore(dbClient, encryptionKey);
      const found = await store.findByKey({
        userId: "u-1",
        provider: "google",
        capability: "identity",
        accountEmail: "nobody@example.com",
      });
      expect(found).toBeNull();
    });
  });

  describe("listForUser", () => {
    it("returns only active rows for the given user", async () => {
      const store = new ConnectionsStore(dbClient, encryptionKey);
      await store.upsert({
        id: "c-a",
        userId: "u-1",
        provider: "google",
        capability: "identity",
        accountEmail: "alice@example.com",
      });
      await store.upsert({
        id: "c-b",
        userId: "u-1",
        provider: "google",
        capability: "email",
        accountEmail: "alice@gmail.com",
      });
      await store.upsert({
        id: "c-other",
        userId: "u-2",
        provider: "google",
        capability: "identity",
        accountEmail: "bob@example.com",
      });

      // Revoke one of u-1's rows.
      const revokedTarget = await store.findByKey({
        userId: "u-1",
        provider: "google",
        capability: "email",
        accountEmail: "alice@gmail.com",
      });
      await store.markRevoked(revokedTarget!.id, "u-1");

      const list = await store.listForUser("u-1");
      expect(list).toHaveLength(1);
      expect(list[0].capability).toBe("identity");
    });

    it("supports multiple accounts per (user, provider, capability)", async () => {
      const store = new ConnectionsStore(dbClient, encryptionKey);
      await store.upsert({
        id: "c-personal",
        userId: "u-1",
        provider: "google",
        capability: "email",
        accountEmail: "alice@gmail.com",
      });
      await store.upsert({
        id: "c-work",
        userId: "u-1",
        provider: "google",
        capability: "email",
        accountEmail: "alice@company.com",
      });

      const list = await store.listForUser("u-1");
      expect(list.map((c) => c.accountEmail).sort()).toEqual([
        "alice@company.com",
        "alice@gmail.com",
      ]);
    });
  });

  describe("markRevoked / soft delete", () => {
    it("flips status to revoked, removes from listForUser, keeps row queryable by id", async () => {
      const store = new ConnectionsStore(dbClient, encryptionKey);
      const initial = await store.upsert({
        id: "c-1",
        userId: "u-1",
        provider: "google",
        capability: "identity",
        accountEmail: "alice@example.com",
      });

      const ok = await store.markRevoked(initial.id, "u-1");
      expect(ok).toBe(true);

      expect(await store.listForUser("u-1")).toEqual([]);

      const byId = await store.getById(initial.id);
      expect(byId?.status).toBe("revoked");
    });

    it("returns false when revoking a row the user doesn't own", async () => {
      const store = new ConnectionsStore(dbClient, encryptionKey);
      const initial = await store.upsert({
        id: "c-1",
        userId: "u-1",
        provider: "google",
        capability: "identity",
        accountEmail: "alice@example.com",
      });

      const ok = await store.markRevoked(initial.id, "wrong-user");
      expect(ok).toBe(false);

      // Original row still active.
      const byId = await store.getById(initial.id);
      expect(byId?.status).toBe("active");
    });
  });

  describe("encryption", () => {
    it("stores refresh / access tokens encrypted at rest", async () => {
      const store = new ConnectionsStore(dbClient, encryptionKey);
      await store.upsert({
        id: "c-1",
        userId: "u-1",
        provider: "google",
        capability: "identity",
        accountEmail: "alice@example.com",
        refreshToken: "plaintext-rt",
        accessToken: "plaintext-at",
      });

      // Raw DB rows should not contain plaintext.
      const rows = await dbClient.db.execute<{
        refresh_token_encrypted: string;
        access_token_encrypted: string;
      }>(sql`
        SELECT refresh_token_encrypted, access_token_encrypted
        FROM connections WHERE id = 'c-1'
      `);
      expect(rows.rows[0].refresh_token_encrypted).toMatch(/^v1:/);
      expect(rows.rows[0].access_token_encrypted).toMatch(/^v1:/);
      expect(rows.rows[0].refresh_token_encrypted).not.toContain(
        "plaintext-rt",
      );

      // Store-level read decrypts them.
      const found = await store.findByKey({
        userId: "u-1",
        provider: "google",
        capability: "identity",
        accountEmail: "alice@example.com",
      });
      expect(found?.refreshToken).toBe("plaintext-rt");
      expect(found?.accessToken).toBe("plaintext-at");
    });

    it("stores plaintext when constructed without a key (dev fallback)", async () => {
      const store = new ConnectionsStore(dbClient, null);
      await store.upsert({
        id: "c-1",
        userId: "u-1",
        provider: "google",
        capability: "identity",
        accountEmail: "alice@example.com",
        refreshToken: "plain-rt",
      });

      const rows = await dbClient.db.execute<{
        refresh_token_encrypted: string;
      }>(sql`
        SELECT refresh_token_encrypted FROM connections WHERE id = 'c-1'
      `);
      // No version prefix; raw value as-is.
      expect(rows.rows[0].refresh_token_encrypted).toBe("plain-rt");
    });
  });
});
