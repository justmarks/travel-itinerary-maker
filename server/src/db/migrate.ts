/**
 * Standalone migration runner. Used by Railway's `preDeployCommand` to
 * apply pending Drizzle migrations before each deploy goes live.
 *
 *   server/dist/db/migrate.js (compiled output)
 *
 * Safe to run unconditionally: if DATABASE_URL isn't set (e.g. while
 * Postgres is still off in production), the script logs and exits 0
 * rather than crashing the deploy.
 *
 * Uses `migrate()` from `drizzle-orm/node-postgres/migrator` (a runtime
 * dependency) so it doesn't pull in `drizzle-kit` (a devDep that
 * production builds may prune).
 */
import path from "path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("[migrate] DATABASE_URL not set — skipping (no-op)");
    return;
  }

  // After `tsc`, this file lives at `server/dist/db/migrate.js`, so
  // `../../drizzle` resolves to `server/drizzle` (the committed
  // migrations folder).
  const migrationsFolder = path.resolve(__dirname, "../../drizzle");
  console.log(`[migrate] applying migrations from ${migrationsFolder}`);

  const pool = new Pool({ connectionString: url });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder });
    console.log("[migrate] done");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
