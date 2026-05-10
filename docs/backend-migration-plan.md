# Backend migration plan — Drive → Supabase

A multi-phase plan to migrate itinly from per-user Google Drive storage and
Google-only auth to centralized Supabase Postgres, Supabase Auth as the
identity layer, and pluggable email + calendar **connector** modules
(Gmail, Microsoft Graph). Apple sign-in is identity-only — no Apple Mail
or iCloud Calendar integration.

**Status:** Planning. Not started.
**Total effort:** ~9-10 weeks for one full-time engineer; parallelizable to
6-7 weeks with two.

---

## Goals

1. Replace per-user Google Drive storage with central Supabase Postgres.
2. Replace Google-only OAuth with Supabase Auth (Google + Microsoft + Apple
   sign-in providers; Apple is identity-only).
3. Decouple **identity** (who is this user) from **data sources** (which
   mailboxes / calendars are they letting us read). A user can sign in
   with one provider and connect mailboxes/calendars from others.
4. Make Outlook (Microsoft Graph) a first-class email + calendar provider.
5. Move sharing, push-subscription, and activity state off Upstash Redis
   into Postgres. Keep `TokenStore` on Redis only if latency demands.
6. Migrate existing Drive users without forcing re-onboarding.
7. **Zero functional regressions** at every phase, gated by automated
   tests run in CI.

## Non-goals

- Apple Mail / iCloud Calendar via IMAP / CalDAV. Sign-in only.
- Browser-direct queries via PostgREST / RLS. Server-mediated stays the
  model — `StorageProvider` continues to be the only DB-touching layer.
- Real-time collaboration via Supabase Realtime. Schema is designed to
  enable it later, but it's out of scope for this migration.
- Replacing Vercel for frontend hosting.

## Architecture, before and after

**Before:**

- `StorageProvider` impls: `InMemoryStorage` (dev/test) and `DriveStorage`
  (per-user Google Drive folder).
- Auth: custom Google OAuth flow; `requireAuth` validates Google access
  tokens; `TokenStore` (Upstash) holds encrypted refresh tokens.
- Sharing: `ShareRegistry`, `ShareSnapshotStore` (snapshots of owner's
  trips so contributors can read them), `share-fanout.ts`,
  `registry-rebuild.ts`. All Upstash-backed.
- Email scan: bound to Gmail. One Google account per user.
- Calendar sync: bound to Google Calendar.

**After:**

- `StorageProvider` impls: `InMemoryStorage` (tests) and `SupabaseStorage`
  (everything else).
- Auth: Supabase Auth issues JWTs; `requireAuth` validates JWTs against
  Supabase JWKS. Provider OAuth (Google / Microsoft) returns a refresh
  token that's stored as a row in a new `connections` table — one
  `connection` per (user, provider, capability, account).
- Sharing: `trip_shares` table replaces registry + snapshots. Contributors
  read owner trips directly via JOIN, gated by `trip_shares`.
- Email scan: provider-agnostic. Iterates **all** of a user's `email`
  connections; supports multiple Gmail accounts plus Outlook accounts in
  the same user.
- Calendar sync: same pattern. Per-trip user picks which connected
  calendar to sync to.

---

## Test strategy across all phases

This is the spine of the migration — without it, "no regression" is a wish.

### Test layers

| Layer | Tool | When |
|---|---|---|
| **Unit** (pure logic, `InMemoryStorage`) | Jest, existing pattern | Every commit; suite must stay <5s |
| **Integration** (real Postgres) | Jest + ephemeral Supabase via `supabase start` | PR CI |
| **Connector contract** (Gmail + Outlook fixtures) | Jest + `nock`-style HTTP fixtures | PR CI |
| **End-to-end** (full stack, real browser) | Playwright | Pre-merge on golden flows |
| **Performance regression** (p50 / p95 budgets per route) | Lightweight bench wrapping Supertest | Nightly on `main` |

### Cross-cutting rules

- **Don't migrate the existing 106 unit tests to a real DB.** They run in
  milliseconds against `InMemoryStorage`; that speed is worth keeping.
  Real-DB coverage goes in a parallel integration suite.
- **Extract a `StorageProvider` contract test suite** in
  `server/__tests__/storage/contract.ts`. Every backend
  (`InMemoryStorage`, `SupabaseStorage`, and during transition
  `DriveStorage`) must satisfy the same contract. Backends in, tests
  parameterized over them.
- **Snapshot every API response** for routes touched by the migration.
  Wire-format regressions get caught immediately.
- **Per-route latency budgets in CI.** Capture a baseline at phase 0 and
  fail PRs that regress p95 by >20% on any of the top-10 endpoints.
- **Don't delete legacy code or tests until phase 6.** Phases 1-5 are
  reversible via feature flags. Phase 6 is the one-way door.
- **CI matrix runs the integration suite at least once per PR**, against
  an ephemeral Supabase started in GitHub Actions. Failure blocks merge.

---

## Phases

### Phase 0 — Foundations (~1 week)

Decisions and scaffolding required before any user-visible code change.

**Build:**
- Choose ORM + migrations: **Drizzle** (pairs with existing Zod schemas
  via `drizzle-zod`, generates migrations, no proprietary types layer).
- Decide service boundary: **modules, not microservices.** Build email +
  calendar as separate workspace packages
  (`packages/email-connectors`, `packages/calendar-connectors`) deployed
  inside the same Express app. Splitting into separate processes is
  ops cost we don't need yet; the package boundary preserves modularity.
- Choose job queue: **`pg-boss`.** Postgres-backed, no extra infra.
- Schema design (normalize, don't blob): `trips`, `segments`, `todos`,
  `transit_options`, `share_rules`, `trip_shares`, `processed_emails`,
  `connections`, `push_subscriptions`, `share_activity`,
  `user_settings`, `user_tokens`. Composite indexes on
  `(user_id, start_date desc)`, `(trip_id, day_index)`,
  `(user_id, provider, account_email)`.
- Region pinning: Supabase project in the same AWS region as Railway.
  Get this right on day one — moving regions later requires dump/restore.

**Tests:**
- Set up `supabase start` in `.github/workflows/ci.yml`. Add a
  `pnpm test:integration` script alongside `pnpm test`.
- Extract the `StorageProvider` contract test suite skeleton; initially
  it runs only against `InMemoryStorage` (no behavior change, but the
  shape exists for phase 1 to plug into).
- Add latency benchmark harness (lightweight: wrap Supertest with
  timing). Capture **baseline numbers for top-10 routes** before any
  code changes and commit them as `docs/perf-baselines.json`.
- Add a Drizzle migration smoke test (`apply → rollback → reapply` on
  a clean DB) so schema changes are caught by CI.

**Done when:**
- CI green with the new integration job.
- Baseline latency numbers committed.
- Drizzle scaffolding present but no actual schema yet.

---

### Phase 1 — Postgres alongside Drive (~2 weeks)

Build the new storage path behind a feature flag. Existing users
unaffected.

**Build:**
- Implement `SupabaseStorage` as a third `StorageProvider` impl.
- Feature flag in `app.ts`: per-user `users.storage_backend` column
  (`drive | postgres | memory`) so we can dogfood on real data without a
  global switch.
- Drizzle migrations for the full schema except auth-specific tables
  (those land in phase 3).

**Tests:**
- `SupabaseStorage` passes the `StorageProvider` contract suite. Suite
  now runs against **all three** backends; identical semantics.
- Migration smoke tests: schema applies cleanly, indexes exist, foreign
  keys correct, rollback works.
- `Trip` round-trip tests: write → read → assert deep-equal across all
  three backends.
- Internal-user smoke test: log in, create trip, edit segment, share,
  verify Postgres rows for users with the flag enabled.
- Re-run latency harness against Postgres; expect `listTrips` to drop
  from ~1s to <50ms. Update budgets.

**Done when:**
- All existing 106 tests pass.
- Contract suite green on all three backends.
- 5+ internal users running on Postgres for ≥1 week with no incidents
  filed.

---

### Phase 2 — Sharing / push state off Redis (~1 week)

Most of today's Redis state exists only because Drive couldn't hold it.
With Postgres, it goes home.

**Build:**
- `ShareRegistry` → `trip_shares` table (`token`, `trip_id`,
  `owner_user_id`, `permission`, `created_at`, `expires_at`).
- `ShareSnapshotStore` → **delete entirely.** Snapshots existed only so
  contributor B could read owner A's Drive. Postgres makes JOINs
  possible.
- `PushSubscriptionStore` → `push_subscriptions` table.
- `ShareActivityTracker` → `share_activity` table.
- Keep `TokenStore` on Upstash for now — fires on every authed request,
  latency-sensitive.
- Delete `share-fanout.ts`, `registry-rebuild.ts`,
  `share-snapshot-store.ts` and their tests. ~400 LOC removed.

**Tests:**
- New unit tests for `trip_shares`, `push_subscriptions`,
  `share_activity` CRUD + permission gating.
- Refactor existing share-flow integration tests to use Postgres
  backing. Delete snapshot-store mocks.
- New end-to-end: contributor authenticates, opens shared trip URL,
  reads trip via central DB (no snapshot involved).
- Migration test: write a representative Redis state to a fixture,
  run the one-time sync into Postgres, assert rows match expected.
- Regression: every test in `share-rules.test.ts`, `shared.test.ts`,
  and the share-fanout suite (or its replacement) must pass.

**Done when:**
- `share-fanout.ts`, `registry-rebuild.ts`, `share-snapshot-store.ts`
  removed.
- Sharing flows end-to-end against Postgres.
- All Redis state except `TokenStore` removed from production.

---

### Phase 3 — Supabase Auth as identity layer (~2 weeks)

The trickiest phase: both auth systems need to coexist during cutover.

**Build:**
- Wire Supabase Auth with Google + Microsoft + Apple providers.
- Refactor `requireAuth` to validate Supabase JWTs (via `jose` against
  Supabase JWKS). Set `req.userId` from JWT `sub`. Drop
  `req.accessToken` from the protected-route path — provider tokens now
  live in `connections`, not on the request.
- New `connections` table:
  - `(id, user_id, provider, capability, account_email,
     refresh_token_encrypted, access_token_encrypted, expires_at,
     scopes, status, created_at)` with unique constraint on
    `(user_id, provider, capability, account_email)`.
- Build `/api/v1/connections` endpoints: `list`, `add` (returns
  provider-OAuth URL), `delete` (revokes provider token + soft-deletes
  row).
- On first Supabase sign-in via Google, write a `connections` row
  using the OAuth `provider_token` / `provider_refresh_token` Supabase
  exposes — so existing-user sign-in immediately has a working email +
  calendar capability.
- Decide and document **account-linking policy** (see Decisions Still
  Needed below). Implement it.

**Tests:**
- Middleware tests with a mocked Supabase JWKS endpoint: validates
  signed JWT, rejects expired, rejects bad signature, rejects missing.
- `connections` table CRUD tests, including unique-constraint
  violations on duplicate `(user, provider, capability, email)`.
- Account-linking edge cases:
  - Same email, different provider (Google then Microsoft) — assert
    chosen policy.
  - Email change at provider after first sign-in.
  - Two real users sharing an alias (`+work@gmail.com` vs
    `+personal@gmail.com`).
- Token refresh tests for Google **and** Microsoft, with mocked refresh
  responses including each provider's failure modes
  (Google 401 + revocation, Microsoft `AADSTS700082` /
  `AADSTS50173`).
- Coexistence: with feature flag set both ways, full auth test suite
  passes against legacy and new path. Same `req.userId` semantics
  either way.
- Regression: every existing auth test in
  `server/__tests__/routes/auth.test.ts` passes unchanged.

**Done when:**
- New users sign up via Supabase Auth and get a `connections` row.
- Existing users still authenticate via legacy flow (until phase 5
  migrates them).
- Both paths land at identical `req.userId` semantics.

---

### Phase 4 — Connector packages (~2 weeks)

The bulk of new code. Existing Google logic gets refactored, not
rewritten; new Microsoft Graph code is greenfield.

**Build:**
- `packages/email-connectors`: defines `EmailConnector` interface,
  exports `GmailConnector` (extracted from existing `routes/emails.ts`)
  and `OutlookEmailConnector` (Microsoft Graph `/me/messages`).
- `packages/calendar-connectors`: defines `CalendarConnector`
  interface, exports `GoogleCalendarConnector` (extracted from
  `routes/calendar.ts`) and `OutlookCalendarConnector` (Graph
  `/me/events`).
- Provider-agnostic normalized types (`NormalizedMessage`,
  `NormalizedEvent`) so the parser and sync logic don't reach into
  raw provider payloads.
- Refactor scan job to iterate **all** of a user's `email` connections
  in parallel-with-bounds, not just one Google account.
- Settings UI: "Connected accounts" page on both desktop and mobile
  showing each connection with revoke + reconnect buttons. Mirror at
  `/m` per the desktop+mobile parity rule.
- Trip-level calendar destination picker: "Sync this trip to → [Gmail
  Personal | Outlook Work]". Default to first calendar connected.
- Per-provider rate-limit / backoff inside each connector. Microsoft
  Graph throttling differs per tenant — handle in the connector layer.

**Tests:**
- New `EmailConnector` contract test suite
  (`packages/email-connectors/__tests__/contract.ts`). Both Gmail and
  Outlook implementations pass identical scenarios:
  - List recent messages with date filter.
  - Get message body (HTML + text + attachments).
  - Pagination correctness.
  - Rate-limit / 429 handling and backoff.
  - Auth failure → typed error (`InvalidAuthError`) the route can
    branch on.
- New `CalendarConnector` contract test suite — same shape:
  - List calendars.
  - Create event with attendees, description, location.
  - Update event preserves unmodified fields.
  - Delete event is idempotent.
  - **Time-zone correctness across DST and IANA edge cases** — both
    providers use different wire formats; both must round-trip.
- Recorded HTTP fixtures for Gmail and Microsoft Graph (`nock` or
  similar), checked into the repo. Re-record only on intentional
  behavior changes.
- Multi-account scan E2E: user with two `email` connections gets
  dedup'd messages from both providers in one scan.
- Calendar destination UX test: user with two `calendar` connections
  sees the picker, selection persists, sync writes only to the chosen
  calendar.
- Regression: existing email-parsing pipeline tests (Anthropic-based
  extraction) pass against **both** Gmail and Outlook normalized
  inputs, unchanged. Proves the parser is provider-agnostic.

**Done when:**
- Both connector packages export their interface + ≥2 implementations.
- Contract suites green for all impls.
- Existing email-parse tests pass without modification.
- Connected-accounts UI shipped on desktop and mobile.

---

### Phase 5 — Migration tool for existing users (~1.5 weeks)

The user-facing migration experience. This is what real existing users
see; the bar for correctness is highest here.

**Build:**
- Background job (`pg-boss`-scheduled): on first login post-cutover,
  detect a user has a Drive folder but no Postgres rows, kick off
  `importFromDrive(userId)`.
- Importer is **idempotent** and **resumable** — read
  `Itinly/trips/*.json` and `settings.json`, write to Postgres in
  one transaction per trip, mark `connections.imported_from_drive_at`.
- UI banner during import on desktop and mobile: "Importing your trips
  from Google Drive… 12 of 30." Polls a status endpoint.
- Read-only view of Drive data for **90 days post-import** as a safety
  net — keep `DriveStorage` reachable but mark imported trips
  immutable from that source.
- Email migration to all users 30 days before legacy-flow shutoff:
  "We're moving your trips off Drive. Sign in here to migrate."

**Tests:**
- **Idempotency:** run importer twice on same Drive folder, assert no
  duplicate rows.
- **Resumability:** simulate kill mid-import, resume, assert all data
  lands and no double-writes.
- Edge cases:
  - User with 0 trips.
  - User with 500 trips (perf benchmark).
  - Trip with malformed JSON in Drive.
  - Trip with shared rules and active share tokens.
  - Trip with calendar-sync history.
  - User who has both old Drive data **and** has been using new flow
    simultaneously (conflict resolution policy must be explicit).
- Status endpoint test: progress reporting accurate at each step.
- UAT against an anonymized copy of real production Drive data on
  staging before any production user touches the importer.
- Performance: 100-trip import completes in <60s.

**Done when:**
- Importer green on all test cases.
- Status banner on both desktop and mobile.
- Run against staging copy of prod data with zero errors.

---

### Phase 6 — Cutover and cleanup (~1 week)

The one-way door.

**Build:**
- Final notice email + 7-day grace.
- Disable legacy auth flow (delete the alternate path in `app.ts`).
- Remove `DriveStorage`, drop `drive.file` scope from OAuth client
  config in Google Cloud Console.
- Delete: `drive-storage.ts`, `drive-error.ts`,
  `share-snapshot-store.ts`, `share-fanout.ts`,
  `registry-rebuild.ts`, related tests.
- If `TokenStore` is the only remaining Upstash consumer **and**
  latency is acceptable, move it to Postgres too and drop Upstash
  entirely. Otherwise keep Upstash for that one purpose.
- Update privacy policy. Add hard-delete account endpoint that wipes
  all rows + revokes all stored provider tokens at Google + Microsoft.

**Tests:**
- **Full regression sweep:** unit + integration + E2E suites green.
- **Account deletion E2E:** create user with trips, segments, share
  rules, push subs, connections; delete account; assert all rows
  gone, all provider refresh tokens revoked at the providers (verify
  via mocked revocation endpoints).
- Post-cutover smoke tests: every API endpoint hit with realistic
  payload, response shape unchanged from phase-0 baseline.
- Code audit: `grep -r "DriveStorage\|drive\.file\|share-fanout"` in
  `src/` returns nothing outside `git log`.
- Performance regression: latencies meet or beat phase-0 baseline on
  every measured route.

**Done when:**
- Drive code paths removed from prod.
- Privacy policy updated.
- Account-deletion endpoint live.
- Phase-0 baseline beaten on every measured route.

---

## What's missing / things to plan around

1. **Background job queue.** `pg-boss` chosen above. Without it,
   multi-account scanning + calendar sync + import jobs will time out
   route handlers under real load.
2. **Account linking policy.** Same email across Google + Microsoft
   sign-ins: merge or forbid? Decide before phase 3.
3. **Privacy + legal.** Privacy policy update, DPA available on
   request, hard-delete endpoint, data export endpoint, breach
   notification process. Once data leaves Drive we're a controller —
   non-negotiable.
4. **Microsoft-specific operational concerns.** Azure AD app
   registration (free, ~30 min). Publisher verification eventually.
   Per-tenant Graph throttling rules.
5. **Webhooks vs polling.** Gmail Pub/Sub and Microsoft Graph
   subscriptions both let providers tell us "new mail." Multi-account
   polling scales badly. Wire webhooks in phase 4 if time allows;
   otherwise schedule for a phase 7.
6. **Per-provider Sentry tags.** Add `provider`, `connection_id`,
   `account_email_hash` tags on every scan/sync error so we can filter
   "all Microsoft failures last week" in the dashboard. Existing
   `monitoring.ts` already supports `tags` on `reportMessage`.
7. **Rollback plan.** Phases 1, 3, 5 are reversible via feature flags.
   Phase 2 (deleting share-fanout) is harder — keep deleted code in a
   git branch and don't delete branch until phase 6 completes.
8. **Test suite during migration.** Keep `InMemoryStorage` for unit
   tests. Add ephemeral Supabase for integration. Don't migrate the
   existing 106 tests to a real DB — perf regression on dev loop.
9. **Monorepo organization.** New packages: `packages/email-connectors`,
   `packages/calendar-connectors`. Possibly `packages/auth` if we
   extract Supabase JWT validation. Keep `packages/shared`
   framework-free.
10. **Push subscriptions move with sharing.** Easy to overlook —
    `PushSubscriptionStore` is currently Redis. Part of phase 2.
11. **Demo mode.** `?demo=true` (`apps/web/src/lib/mock-client.ts`) is
    frontend-only and unaffected. Confirm during phase 1.
12. **Time zones for Outlook Calendar sync.** Microsoft Graph's event
    model handles TZ slightly differently from Google
    (`originalStartTimeZone` vs inline `dateTime` + `timeZone` object).
    Existing IANA-zone-from-location logic still applies; per-provider
    serializer in `CalendarConnector` handles wire format. ~1 day,
    easy to forget.
13. **Rate-limit recovery on import.** Drive→Postgres importer reads
    files at Drive's API limits. Hundreds of trips can hit quotas.
    Resumable via `connections.imported_from_drive_at` partial state.
14. **Email forwarding fallback (optional).** Generate a per-user
    `scan-<id>@itinly.com` address; users on unsupported providers
    forward booking confirmations to it. Cheap to add (one inbound MX
    route + parser hook), high optionality. Skip in v1.
15. **CI cost.** Ephemeral Supabase per-PR adds ~30s + a few cents to
    every CI run. Worth it; budget for it.

---

## Rollback strategy per phase

| Phase | Reversible? | How |
|---|---|---|
| 0 | Yes | Drop test infra, no prod impact. |
| 1 | Yes | Per-user `storage_backend = drive` flag. Postgres rows remain harmlessly. |
| 2 | Hard but possible | Restore deleted services from git branch, re-enable Redis writes. Snapshot data must be re-built from Postgres state. |
| 3 | Yes | Per-user `auth_backend = legacy` flag. Both paths kept until phase 6. |
| 4 | Yes | New code is additive. Disable Outlook connector if it misbehaves. |
| 5 | Yes | Importer is idempotent — re-run after fixes. |
| 6 | **No.** One-way door. | Hold last-known-good Postgres backup; revert via full restore + git revert + re-deploy. Have a rehearsed runbook before triggering. |

---

## Cost progression during migration

| Phase | New monthly cost incurred |
|---|---|
| 0 | $0 (CI infra only, Supabase ephemeral on free tier) |
| 1 | Supabase Free → Pro ($25/mo) once internal users move |
| 2-4 | No incremental — same Supabase Pro tier |
| 5 | Cron worker compute on Railway (~$5/mo) |
| 6 | Drop Upstash if fully migrated (-$0-10/mo) |

Steady-state at 0-1k users: ~$50/mo (Vercel Pro + Railway + Supabase
Pro). Compared to today: small absolute increase, with substantially
better perf and product capability.

---

## Decisions still needed before kickoff

1. **Account linking policy.** Same email across Google + Microsoft
   sign-in: merge with email verification, or forbid duplicate emails
   across providers?
2. **Calendar destination default.** First-connected wins, or prompt
   on every trip create?
3. **Push subscription expiry.** Today they live forever — should we
   expire after N days of inactivity?
4. **Retention of Drive data post-import.** 90 days read-only, then
   archive? Permanent until user deletes account?
5. **`processed_emails` schema.** Keep raw provider message JSON for
   re-parse, or only normalized fields?
6. **Apple sign-in worth $99/yr.** Apple Developer Program is required
   in production. Do we believe Apple-first users will sign up if
   they have to use Sign In With Google instead?

---

## Owner and updates

This document is the source of truth for the migration plan while
work is in progress. Update it as decisions land and phases complete.
Once phase 6 ships, archive (don't delete) — the rationale is useful
context for future architecture conversations.
