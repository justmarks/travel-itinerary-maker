# Auto email-scan setup (Supabase pg_cron + Railway)

End-to-end wiring for the recurring email-scan feature. The Railway API
hosts the executor; Supabase pg_cron fires the tick.

---

## What gets created

- Two tables, migrated by drizzle alongside the rest of the schema
  (no manual SQL needed):
  - `email_scan_schedules` — one row per (user × provider × folder ×
    frequency) recurring scan
  - `email_scan_runs` — append-only run history, capped at the most
    recent 50 rows per schedule
- A pg_cron job inside your Supabase Postgres database that hits the
  Railway API once a minute on the `POST /email-scan-schedules/tick`
  endpoint.

The migration is checked in at
[`server/drizzle/0003_auto_email_scan.sql`](../server/drizzle/0003_auto_email_scan.sql);
it runs automatically the next time Drizzle migrates on the Railway
service.

---

## Step 1 — Set the cron secret

The tick endpoint is **not** behind user-auth — it's a process-level
fan-out call from the database. To stop random callers from triggering
scans, the endpoint compares the `X-Cron-Secret` header against the
`CRON_SECRET` env var. Generate one and set it on both sides:

```bash
openssl rand -hex 32
# example output: 8a3f7c91e0d6c8b4f9a2e1d7c5b9a4e3f8d2c6b1a5e9d3c7b8a1f4e6d2c5b7a8
```

- **Railway** (server): set `CRON_SECRET` on the service. Without it,
  the tick endpoint returns 503 in production and the cron job
  fails silently.
- **Supabase**: the value goes into Vault so the pg_cron SQL can read
  it without hard-coding the secret in plain SQL. See step 3 below.

In dev / CI the secret is optional — the tick endpoint runs open in
non-production so the test suite can exercise it without env setup.

---

## Step 2 — Enable pg_cron + pg_net

Both extensions ship with Supabase but are opt-in per project.

In the Supabase dashboard, open **Database → Extensions** and enable:

- **pg_cron** — schedules SQL on a recurring cadence
- **pg_net** — lets pg_cron call HTTP endpoints

No extra config; toggling them on is enough. Both are free-tier.

---

## Step 3 — Stash the secret + endpoint in Supabase Vault

Vault keeps the values out of plain SQL and out of dashboard logs.
From the Supabase SQL editor:

```sql
select vault.create_secret(
  '<your-cron-secret-from-step-1>',
  'itinly_cron_secret'
);

select vault.create_secret(
  'https://<your-railway-app>.up.railway.app',
  'itinly_api_base'
);
```

(Replace the Railway URL with whatever your production server lives at.)

You can sanity-check the writes with:

```sql
select name from vault.decrypted_secrets;
-- should include itinly_cron_secret and itinly_api_base
```

---

## Step 4 — Schedule the tick job

Still in the SQL editor:

```sql
select cron.schedule(
  'itinly-email-scan-tick',
  '0 * * * *',  -- every hour, on the hour; pg_cron honors standard cron expressions
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'itinly_api_base')
        || '/api/v1/email-scan-schedules/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'itinly_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) as request_id;
  $$
);
```

Hourly is the recommended cadence — the user-facing schedule
frequencies are daily/weekly/monthly, so a finer tick mostly just
burns Railway requests and Supabase quota on no-op selects. If
you've already scheduled this with `'* * * * *'` (every minute),
flip it to hourly without re-creating the job:

```sql
select cron.alter_job(
  (select jobid from cron.job where jobname = 'itinly-email-scan-tick'),
  schedule := '0 * * * *'
);
```

That's it — the job now fires every hour and the Railway endpoint
queries due schedules (`enabled AND next_run_at <= now()`) and runs
each one. Most ticks find zero due schedules and return in under a
second; the tick is cheap.

To inspect the recent jobs / latencies:

```sql
select * from cron.job;                -- the scheduled definition
select * from cron.job_run_details order by start_time desc limit 20;
select * from net.http_request_queue;  -- in-flight HTTP calls
```

---

## Step 5 — Verify

1. Sign in to the app and create a schedule from **Settings → Account
   → Scheduled scans**. Set the frequency to `daily`.
2. Bump the new schedule's `next_run_at` back to "now" so the next
   tick picks it up — easiest way is the SQL editor:

   ```sql
   update email_scan_schedules
   set next_run_at = now() - interval '1 minute'
   where user_id = '<your-user-id>';
   ```

3. Wait up to a minute. Look in `email_scan_runs` for a row with
   `status = 'succeeded'` (and ideally a non-zero `new_count` if your
   mailbox has unread travel confirmations).
4. The settings page's **Recent runs** dialog should show the same
   run; if anything was found, the `/m` and `/` banner pop with a
   pending-review pill.

---

## Pause / disable

- Stop the cron job entirely: `select cron.unschedule('itinly-email-scan-tick');`
- Pause a single user's schedule: flip its `enabled` boolean from the
  settings UI (the toggle row turns into a paused chip; the cron tick
  skips it on the index scan).

---

## What can go wrong

- **`http_request_queue` rows piling up with status 'PENDING'.**
  `pg_net` calls happen in a background worker; if Railway is asleep
  (free-tier idle suspends the API), the call times out after 30 s
  and the row records the failure. Next tick retries automatically.
- **Every run shows up as `failed` with "AI service not configured".**
  Set `ANTHROPIC_API_KEY` on Railway. The executor needs it to parse.
- **Every run shows up as `failed` with "isn't connected".**
  The user's `connections` row for that provider was revoked. They
  need to reconnect Gmail / Outlook from Settings; the schedule keeps
  trying but no run can succeed until the connection is back.
