-- ─── Add `include_sublabels` to email_scan_schedules ──────────────────────
--
-- Lets a scheduled scan widen its label/folder filter to descendants:
-- picking "Travel" with this flag set also scans "Travel/Hotels",
-- "Travel/Flights/Confirmed", etc. Expansion happens at execute time
-- (see `email-scan-executor.ts`) by walking the connector's label
-- list and finding entries whose name starts with `<parent>/`.
--
-- Defaults to false to preserve the previous semantics for existing
-- schedules — "Travel" by itself matched only that exact label
-- (Gmail's flat-label model). Users opt in via a checkbox in the
-- schedule editor.

ALTER TABLE "email_scan_schedules"
  ADD COLUMN "include_sublabels" boolean DEFAULT false NOT NULL;
