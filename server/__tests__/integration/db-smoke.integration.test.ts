/**
 * Phase 0 integration smoke test. Confirms the CI Postgres service is
 * reachable and the harness can roundtrip a query before phases 1+
 * start writing schema and contract tests against it.
 *
 * Locally: `DATABASE_URL=postgres://... pnpm test:integration` from the
 * server package. Without `DATABASE_URL` set, this test fails fast
 * rather than silently skipping — the integration target should always
 * have a real database.
 */
import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

describe("postgres smoke", () => {
  beforeAll(() => {
    if (!DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is required for integration tests. Set it to a " +
          "running Postgres (e.g. `postgres://postgres:postgres@localhost:5432/postgres`).",
      );
    }
  });

  it("connects, roundtrips a SELECT 1, and disconnects", async () => {
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
      const res = await client.query<{ ok: number }>("SELECT 1 AS ok");
      expect(res.rows[0].ok).toBe(1);
    } finally {
      await client.end();
    }
  });

  it("reports the running Postgres major version", async () => {
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
      const res = await client.query<{ server_version: string }>(
        "SHOW server_version",
      );
      const major = parseInt(res.rows[0].server_version.split(".")[0], 10);
      // We standardise on Postgres 16+ to match Supabase's default.
      expect(major).toBeGreaterThanOrEqual(15);
    } finally {
      await client.end();
    }
  });
});
