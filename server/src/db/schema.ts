/**
 * Drizzle schema. Phase 0 ships only a scaffold table to prove the
 * generate / apply / smoke pipeline works end-to-end. Phase 1 replaces
 * `phase0Scaffold` with the real domain tables (trips, segments, todos,
 * share_rules, trip_shares, processed_emails, connections, etc.).
 *
 * Why a scaffold table at all: drizzle-kit needs a non-empty schema to
 * generate a migration, and the migration smoke test needs at least
 * one user-defined table to assert against. Once phase 1 ships real
 * tables, this file's contents disappear and the scaffold migration
 * stays in the migrations folder as historical record (Drizzle replays
 * migrations in order regardless of whether the table still exists in
 * the current schema).
 */
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const phase0Scaffold = pgTable("_phase0_scaffold", {
  id: text("id").primaryKey(),
  note: text("note"),
  capturedAt: timestamp("captured_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
