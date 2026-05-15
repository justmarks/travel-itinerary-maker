-- ─── Add `time_of_day` + `day_of_week` to email_scan_schedules ────────────
--
-- Lets a scheduled scan anchor on a specific clock time (HH:MM UTC,
-- 24h) and — for weekly cadences — a specific UTC day of the week
-- (0 = Sunday, …, 6 = Saturday). Both nullable to preserve the legacy
-- behaviour for schedules created before this migration (no anchor →
-- the scheduler bumps `next_run_at` by a flat 24h/7d from the create
-- moment, the previous semantics).
--
-- Editor UI converts between the user's local-zone pick and UTC for
-- both fields together so a late-evening local pick that crosses
-- midnight UTC still lands on the correct day.

ALTER TABLE "email_scan_schedules"
  ADD COLUMN "time_of_day" text,
  ADD COLUMN "day_of_week" integer;
