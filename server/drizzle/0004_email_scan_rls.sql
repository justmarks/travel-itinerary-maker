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
-- Portability: the integration test runner uses a vanilla Postgres 16
-- container that doesn't have the Supabase-managed `authenticated`
-- role (Supabase creates it as part of GoTrue setup) or the
-- `auth.uid()` function. Running `CREATE POLICY ... TO authenticated`
-- against such a Postgres errors with `role "authenticated" does not
-- exist`. We guard the whole RLS block on the role's existence so the
-- migration is a no-op on vanilla Postgres (where there's nothing for
-- the policies to gate against anyway — no PostgREST exposure) and
-- the full policy set lands on real Supabase environments.
--
-- The `auth.uid()` reference is wrapped in `EXECUTE` for the same
-- reason: Postgres parses CREATE POLICY's predicate at definition
-- time and would complain about an unknown function on vanilla
-- Postgres. Defering through EXECUTE means the parse happens only
-- inside the `IF EXISTS` branch, which never runs without the role.
--
-- Idempotency: `ENABLE RLS` on an already-enabled table is a no-op,
-- and `DROP POLICY IF EXISTS` guards CREATE POLICY against
-- duplicate-name failures — so this migration is safe to re-run on
-- a database where the policy was already created (e.g. manually via
-- the Supabase dashboard).
--
-- New user-scoped tables added in the future should follow this
-- same pattern IN THE SAME MIGRATION that creates them, not in a
-- follow-up. The schema-level reminder lives at the top of
-- `emailScanSchedules` in `server/src/db/schema.ts`; the project-
-- level reminder lives in `CLAUDE.md` so it's surfaced to every
-- contributor.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'ALTER TABLE "email_scan_schedules" ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE "email_scan_runs" ENABLE ROW LEVEL SECURITY';

    EXECUTE 'DROP POLICY IF EXISTS "email_scan_schedules_owner_rw" ON "email_scan_schedules"';
    EXECUTE $policy$
      CREATE POLICY "email_scan_schedules_owner_rw" ON "email_scan_schedules"
        FOR ALL
        TO authenticated
        USING (auth.uid()::text = user_id)
        WITH CHECK (auth.uid()::text = user_id)
    $policy$;

    EXECUTE 'DROP POLICY IF EXISTS "email_scan_runs_owner_rw" ON "email_scan_runs"';
    EXECUTE $policy$
      CREATE POLICY "email_scan_runs_owner_rw" ON "email_scan_runs"
        FOR ALL
        TO authenticated
        USING (auth.uid()::text = user_id)
        WITH CHECK (auth.uid()::text = user_id)
    $policy$;
  END IF;
END $$;
