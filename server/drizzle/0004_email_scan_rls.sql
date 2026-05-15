-- ─── Row-level security for the auto-email-scan tables ────────────────────
--
-- Migration 0003 created `email_scan_schedules` and `email_scan_runs`
-- without RLS, on the assumption that the server's `postgres` role
-- (BYPASSRLS) was the only consumer. That assumption is wrong for
-- Supabase: every public-schema table is exposed via the project's
-- managed PostgREST endpoint to both the `anon` and `authenticated`
-- roles by default. Without RLS enabled, any caller holding the anon
-- key shipped in the browser bundle could hit
--   GET https://<project>.supabase.co/rest/v1/email_scan_schedules
-- and read every user's schedule list (and run history).
--
-- This migration closes that off without disrupting server-side
-- access — `postgres` and `service_role` both have BYPASSRLS, so the
-- Express API's queries (which use the DATABASE_URL `postgres` user)
-- continue to read / write every row regardless of these policies.
-- The policies kick in only for `anon` and `authenticated` traffic
-- through PostgREST.
--
-- Auth shape: Supabase's `auth.uid()` returns the user's UUID; our
-- `user_id` columns store the same value as `text` (matches every
-- other user-scoped table in the schema), so the cast is explicit.
-- Both SELECT and write operations are gated by the same predicate
-- via `FOR ALL ... USING ... WITH CHECK ...`.
--
-- Idempotency: written so it's safe to run on a DB where someone
-- already enabled RLS or created the same-named policy out-of-band
-- (e.g. via the Supabase dashboard). `ENABLE RLS` is a no-op when
-- already on; the `DROP POLICY IF EXISTS` guards prevent the
-- `CREATE POLICY` from erroring on a duplicate name.
--
-- New user-scoped tables added in the future should follow this
-- same pattern IN THE SAME MIGRATION that creates them, not in a
-- follow-up. The schema-level reminder lives at the top of
-- `emailScanSchedules` in `server/src/db/schema.ts`; the project-
-- level reminder lives in `CLAUDE.md` so it's surfaced to every
-- contributor.

ALTER TABLE "email_scan_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "email_scan_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "email_scan_schedules_owner_rw" ON "email_scan_schedules";--> statement-breakpoint
CREATE POLICY "email_scan_schedules_owner_rw" ON "email_scan_schedules"
  FOR ALL
  TO authenticated
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);--> statement-breakpoint
DROP POLICY IF EXISTS "email_scan_runs_owner_rw" ON "email_scan_runs";--> statement-breakpoint
CREATE POLICY "email_scan_runs_owner_rw" ON "email_scan_runs"
  FOR ALL
  TO authenticated
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);
