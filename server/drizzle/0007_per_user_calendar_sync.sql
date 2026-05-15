-- ─── Per-user calendar sync state ─────────────────────────────────────────
--
-- The legacy model stored one calendar sync per trip:
--   trips.calendar_id            — the calendar the owner picked
--   segments.calendar_event_id   — event id per segment after owner synced
--
-- This was owner-only by design. Recipients of a shared-edit trip can
-- push the same trip to their OWN Google / Outlook calendar without
-- this PR's new state table: collisions on the trip / segment columns
-- meant last writer wins, clobbering the owner's event ids and breaking
-- the owner's next "update" sync.
--
-- The new `trip_user_calendar_syncs` table holds one row per
-- (trip, user) — the user can be the trip owner OR any shared-edit
-- recipient. `segment_event_map` is a jsonb { [segmentId]: eventId }
-- so a single row carries the entire trip's sync state for that user.

CREATE TABLE IF NOT EXISTS "trip_user_calendar_syncs" (
  "id"                text PRIMARY KEY,
  "trip_id"           text NOT NULL REFERENCES "trips"("id") ON DELETE CASCADE,
  "user_id"           text NOT NULL,
  "calendar_id"       text NOT NULL,
  "segment_event_map" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "trip_user_calendar_syncs_trip_user_uniq"
  ON "trip_user_calendar_syncs" ("trip_id", "user_id");

CREATE INDEX IF NOT EXISTS "trip_user_calendar_syncs_user_idx"
  ON "trip_user_calendar_syncs" ("user_id");

-- ─── Backfill from legacy columns ─────────────────────────────────────────
--
-- Every trip with a `trips.calendar_id` set gets a row attributed to
-- the trip's owner (`trips.user_id`). The segment event map is built
-- by aggregating all `segments.calendar_event_id` values for that
-- trip into one jsonb object. Trips with calendar_id set but zero
-- synced segments yet → empty map (preserves the "user picked a
-- calendar" intent for a re-sync).
--
-- Idempotent via the unique index — if some user has already created
-- a row via the app before the migration runs, ON CONFLICT preserves
-- their newer state and skips the backfill for that pair.

INSERT INTO "trip_user_calendar_syncs"
  ("id", "trip_id", "user_id", "calendar_id", "segment_event_map", "created_at", "updated_at")
SELECT
  -- Composite id that's stable + reproducible from the source data,
  -- so re-running the backfill (during a migration retry) doesn't
  -- generate new ids.
  'tucs-' || t.id || '-' || t.user_id AS id,
  t.id                                AS trip_id,
  t.user_id                           AS user_id,
  t.calendar_id                       AS calendar_id,
  COALESCE(
    (
      SELECT jsonb_object_agg(s.id, s.calendar_event_id)
      FROM "segments" s
      WHERE s.trip_id = t.id AND s.calendar_event_id IS NOT NULL
    ),
    '{}'::jsonb
  )                                   AS segment_event_map,
  now()                               AS created_at,
  now()                               AS updated_at
FROM "trips" t
WHERE t.calendar_id IS NOT NULL
ON CONFLICT ("trip_id", "user_id") DO NOTHING;

-- ─── Row-level security (Supabase only) ──────────────────────────────────
--
-- Owner-only policy on the new table. `auth.uid()::text` matches the
-- row's `user_id` column. Wrapped in the pg_roles guard so the
-- vanilla-Postgres integration tests (no `authenticated` role, no
-- `auth.uid()` function) skip this block instead of failing at parse
-- time. Same pattern as `0004_email_scan_rls.sql`.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'ALTER TABLE "trip_user_calendar_syncs" ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "trip_user_calendar_syncs_owner_rw" ON "trip_user_calendar_syncs"';
    EXECUTE $policy$
      CREATE POLICY "trip_user_calendar_syncs_owner_rw" ON "trip_user_calendar_syncs"
        FOR ALL
        TO authenticated
        USING (auth.uid()::text = user_id)
        WITH CHECK (auth.uid()::text = user_id)
    $policy$;
  END IF;
END $$;
