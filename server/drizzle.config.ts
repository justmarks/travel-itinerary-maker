/**
 * drizzle-kit config — drives `pnpm db:generate` and `pnpm db:push`.
 * Migrations land under `server/drizzle/` and are checked into git;
 * Phase 1 will start applying them via `migrate()` at server boot.
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/itinly_dev",
  },
  // Migrations are reviewed manually before commit. Generated SQL is
  // small and human-readable; we want the diff in PRs.
  verbose: true,
  strict: true,
});
