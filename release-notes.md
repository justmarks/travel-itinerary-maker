# itinly v1.2.0

Schedule a scan once and let itinly check your inbox on its own. Send a confirmation straight from any iOS or Android share sheet without going through Gmail at all. Cruises and car rentals get their own multi-day bands on the timeline. The segment add/edit form trims down to its essentials, and a long list of accessibility, parity, and parsing fixes round out the release.

## Auto email-scan scheduler

- **Recurring scans** on a daily or weekly cadence — pick a folder or label per provider, anchor on a specific time of day (and day-of-week, for weekly), and itinly polls the mailbox on its own.
- **Multiple schedules per user** — one per (provider × folder × cadence) tuple, so a personal Gmail `Travel/` label and a work Outlook folder can run independently on different rhythms.
- **Include sub-folders / sub-labels** — a single "Travel" pick optionally fans out to every descendant (`Travel/Hotels`, `Travel/Flights/Confirmed`, …) so you don't have to enumerate them.
- **Findings land in the same review queue** as a manual scan — nothing is auto-applied, so a scheduled scan can't silently put a misparsed booking on a real trip.
- **Push notification + in-app banner** when a scheduled scan turns up something new, deep-linking straight to the review step on either desktop or mobile.
- **Pause / resume / edit / delete** each schedule from `/settings/account`, with a "Recent runs" history dialog (last 50 per schedule).
- **Backed by Supabase pg_cron + pg_net** firing a shared-secret-guarded tick endpoint; per-user row-level security on the new tables.

## PWA polish

- **"Send to itinly" share target** — pick itinly from any iOS or Android share sheet and the shared text / URL / page title goes straight into the parser. Forwarded confirmations from non-Gmail mailboxes work without leaving Mail.
- **"Create trip" app-icon shortcut** — long-press the installed PWA icon (Android) or right-click it (desktop) to jump straight into a new-trip sheet.
- **App-icon badge** on the installed PWA — incoming push notifications bump a numeric badge on the icon (Chromium / Edge / iOS 16.4+ Safari); cleared when you bring the app forward or tap the notification.

## Timeline + segment polish

- **Cruises render as multi-day bands on the Lodging lane** instead of a single-day pill under Activities — same visual treatment as a hotel block, but with the ship name + 🚢 + duration.
- **Car rentals get their own multi-day bands** on the Transport lane, packed onto the same row as the per-day flight / train / transfer pills so the rental window is visible at a glance.
- **Overlapping lodging bars no longer disappear** — hotels and cruises that overlap (e.g. a hotel on embarkation day plus the cruise that picks up from there) pack onto separate tracks instead of one bar silently clobbering the other.
- **Richer car rental titles** like "Hertz - Lihue", with pickup / dropoff cities and times in the calendar event description; the all-day event spans through the dropoff date inclusive.
- **Dedicated `shipName` field on cruises** — extracted automatically by the email parser, used in the timeline pill and calendar event title; ports of call render in the calendar description.
- **Cost displays always show 2 decimals** (`288.40` instead of `288.4`).

## Cleaner segment form

- **"More options" disclosure** at the bottom of the add/edit form gathers everything past the core booking fields — cabin class, baggage info, address, phone, breakfast included, free-form details, plus Cost and Confirmation # — into one collapsible section.
- **"N filled" hint** on the disclosure header so a rich parsed booking still telegraphs how much sits behind the fold without auto-expanding.
- **Whole desktop segment cards are clickable** to open the edit dialog (the pencil icon stays for discoverability); Enter / Space on a focused row works the same.
- **Clearing the cost field now persists** — previously the empty value silently no-op'd and the old cost stayed put.

## Email parsing

- **Prefers the plain-text part on noisy multipart confirmations** when the HTML alternative is dominated by marketing copy and image alt text. A Marriott Vacation Club receipt that previously parsed as "no travel content" now produces the right hotel + dates + total.
- **No-travel-content emails no longer report to Sentry** — promotional mail that Claude correctly skipped was creating false-positive operator alerts.

## Accessibility + parity pass

- **Screen-reader labels on icon-only buttons** — trip-card rename save/cancel, trip-card overflow menu, scheduled-scan row Pause / Edit / Delete, to-do panel add/cancel toggle, EditableCity save/cancel, share-link "ready" announcement.
- **Escape cancels EditableCity** to match the rest of the inline editors.
- **Segment row actions reveal on keyboard focus** (Edit / Confirm / Delete + the city-edit pencil) instead of being hover-only.
- **Empty days surface "Add the first activity" CTA** on desktop instead of a flat "No activities planned" placeholder.
- **Mobile to-do detail sheet renders a Markdown preview** under the Notes textarea, matching the desktop edit-todo dialog.
- **Dialog inputs stop clipping the focus ring** on the left (edit-todo, add/edit segment, html-import, suggest-meals).
- **Schedule editor stores correct UTC during DST** — a 9:15 AM PDT pick now writes 16:15 UTC, not 17:15.

## Trust and polish

- **RLS on every `email_scan_*` table** captured in migration 0004 — idempotent and guarded for vanilla Postgres so CI integration tests still pass on a non-Supabase container.
- **Routine `[auth] supabase token not used …` log gated behind `DEBUG_AUTH=1`** so steady-state Railway logs aren't drowned by Supabase JWT expiry / legacy Google access-token coexistence noise.
- **Trip-card rename input auto-focuses** when it appears.
- **Stale service workers unregister in dev mode** so a cached `/m` shell from a prior session doesn't masquerade as the live build.
- **Mobile / desktop parity** in costs editing and share-link error surfacing.

## Under the hood

- **Drizzle migrations 0003 – 0006** land the schedules + runs tables, RLS policies, the `include_sublabels` flag, and the time-of-day / day-of-week anchor columns.
- **`ts-node` is now an explicit devDependency** on `server` so a fresh install doesn't fail the migration runner.
- **Shared `expandLabelFilters` helper** keeps the manual `/emails/scan` route and the scheduled executor in agreement on how to expand a parent label/folder into its descendants.
- **`packIntoTracks` helper** centralises the timeline's overlap-aware lane packing for hotels, cruises, and rentals.
- **SSRF-guarded URL fetch** on the new `/emails/import-shared` endpoint — http(s) only, blocks loopback / RFC1918 / link-local / cloud-metadata hosts, 10s timeout, 1 MB cap, content-type filter.
- **Tests grew from 948 → 967** — new server coverage for schedules CRUD, the cron tick, share-target routes, plain-text-preference parsing, and the cost-clear contract.

## Thanks

Schedule one scan; never look at a confirmation email again. Onward to 1.2.x.

---

# itinly v1.1.0

The 1.1 release is mostly **plumbing under the floorboards** — but the floorboards are now sturdy enough to support Outlook + Microsoft accounts as first-class citizens alongside Google. Sign in with either provider, scan either inbox, sync to either calendar, and link both to the same account if you want to mix them.

## Multi-provider, end to end

- **Sign in with Microsoft or Google** via Supabase Auth. Both flows force the account picker so you never get silently signed in as the wrong identity.
- **Outlook email scan** alongside Gmail — point at a Mail folder (or nested folder like `Inbox > Travel`), the same Claude parser pulls flights, hotels, and reservations out. Inbox-only or all-mail toggle on both sides.
- **Outlook Calendar sync** alongside Google Calendar — push segments, all-day hotel blocks, IANA-typed flight events, and re-sync / unsync, with parity across desktop and mobile.
- **Link multiple accounts** on `/settings/account` — one Google + one Microsoft identity, with separate Mail + Calendar capability rows per provider. Disconnect cascades cleanly: unlinking a sign-in identity also removes its Mail/Calendar rows after an "are you sure" confirm.
- **Inline provider picker** on calendar + email sync dialogs when you've connected more than one — defaults to your most-recently-used and remembers per-feature.

## Backend rebuilt on Supabase

The product looks the same; underneath, it's a different system.

- **Storage moved from Google Drive to Supabase Postgres.** Trips, segments, todos, history, share-link metadata, push subscriptions, and OAuth refresh tokens now live in row-level-security-gated Postgres tables — not in a per-user Drive folder.
- **Token refresh on the server** — short-lived access tokens for Gmail, Microsoft Graph, and both calendars are minted from encrypted refresh tokens on demand, so a long-tabbed-open session doesn't fall over silently.
- **`InvalidAuthError`** as a typed signal across every connector — a revoked-at-Google or scope-stripped token surfaces a specific 4xx that the UI maps to the right reconnect screen, not a generic 500.
- **Storage + connector contract tests** — `SupabaseStorage`, `InMemoryStorage`, `GoogleCalendarConnector`, `MicrosoftCalendarConnector`, `GmailEmailConnector`, and `MicrosoftEmailConnector` all run the same shared test suites, so the two providers and the two storage backends can't drift apart.

## Email scan polish

- **Live progress** — "Found N emails → Parsing X of M" as the scan runs, instead of a single spinner.
- **Multi-trip auto-clustering** on desktop — scanning an inbox that spans several trips now groups proposals by destination/dates instead of dumping a flat list.
- **Better placeholder handling** — TBD / open-date items are skipped silently instead of producing zero-day "trips".
- **Layover-aware titles** — a SFO → NRT → BKK booking proposes "Bangkok", not "Tokyo".
- **Provider + account stored on each parsed email** so re-scans don't double-process the same thread across accounts.
- **Per-folder Outlook listing** including nested folders, so `Inbox > Travel > 2026` is reachable.
- **Anthropic 429 + Microsoft `MailboxConcurrency` retry** so a transient upstream blip doesn't fail the whole scan.

## Calendar sync polish

- **Provider-aware dialogs** that survive the dropdown-menu closing, no overlap, no mid-flow remount.
- **Orphaned-event reuse** on Outlook — if a calendar event lost its segment link, the next sync rebinds instead of duplicating.
- **Time-zone correctness** verified by wire-format tests: flights carry per-endpoint IANA zones, hotels stay all-day, update-resync preserves the event's existing extended properties.

## Mobile

- **Microsoft + Outlook everywhere** — mobile scan sheet, mobile calendar sync sheet, and the account-settings panel all carry the same multi-provider affordances as desktop.
- **Email-scan sheet** surfaces partial-results banners and stale-token recovery as step transitions, not silent failures.

## Trust and polish

- **Account settings page** at `/settings/account` — see linked identities + capability rows, with primary-email sort and live cross-panel state refresh.
- **Initials avatar fallback** for accounts without a provider photo; Microsoft Graph photo support added for Microsoft sign-in.
- **Diagnostic logging gated behind `DEBUG_EMAIL_SCAN` / `DEBUG_CONNECTIONS` / `DEBUG_CALENDAR`** — production Railway logs are quiet by default; real anomalies still always surface.
- **Hardened token writes** — the server now rejects a Google-shaped token written to a Microsoft row (and vice versa) instead of silently corrupting the connection.

## Under the hood

- **Workspace packages renamed** from `@travel-app/*` → `@itinly/*` (shared, api-client, server, web) with a one-shot localStorage key migration so existing browser state copies forward.
- **Node ≥ 22.13** required (pnpm 11's loader depends on `node:sqlite`).
- **Vercel build config** is now in a checked-in `vercel.json` instead of the dashboard UI.
- **`pnpm update-test-count`** keeps the README test count fresh; `pnpm check-test-count` runs in CI so it can't drift.
- **`server/.env.example` audited + split** — frontend-only `NEXT_PUBLIC_*` vars moved to `apps/web/.env.example`, the long-dead `STORAGE_BACKEND=drive` and `STORAGE_POSTGRES_USERS` paths removed.
- **DriveStorage path fully removed** (Phase 6 of the backend-migration plan) — `mode: "drive"`, the per-user Drive folder layout, and the partial Drive → Postgres importer are all gone from the tree.

## Thanks

The Drive era was good; the Postgres era is better. Onward.

---

# itinly v1.0.0

A year of work, dozens of releases, and a few hundred PRs later — itinly hits **1.0**. Sign in with Google, point it at a Gmail label, and get a clean day-by-day itinerary back in seconds. Your data lives in your own Google Drive, the mobile site installs as a PWA and reads offline, and you can sync the whole trip to Google Calendar with one tap.

## Plan a trip

- **Day-by-day view** with inline segment editing, per-segment costs, and confirmation codes
- **Timeline view** — Hipmunk-style Gantt grid with swimlane / chronological toggle, hotels rendered as spanning bars, prints cleanly
- **Map view** — hotels, dining, activities, and transport endpoints as pins on Google Maps; KML export for Google My Maps
- **Flight endpoints by IATA** — typeahead over 1,178 commercial airports (search by code, city, name, or alias); auto-fills titles like `JFK → NRT (JL 5)`
- **Embedded costs + dedicated Costs tab**; categorized **TODO** tracking (meals / activities / research / logistics)

## Auto-extract from email

- **Gmail scan** — point at a label, Claude parses confirmations into flights, hotels, restaurants, transport
- **Email file import** — paste or upload an `.html` / `.eml` for non-Gmail users
- **XLSX import** — one-shot import a complete trip from a OneNote-exported workbook (auto-detects column layouts, attaches Costs sheet entries to lodging segments)

## Share, sync, export

- **Per-trip share links** with configurable visibility (costs, TODOs)
- **Auto-share rules** — share every existing and future trip with someone in one tap
- **Google Calendar sync** — push segments to any writable calendar; hotels and car rentals become all-day events; flights and trains carry per-city IANA time zones; re-sync updates, unsync removes (with a choice to delete or just unlink); available on desktop **and** mobile
- **Export** as Markdown, OneNote-compatible HTML, PDF, or **iCal (.ics)** with VTIMEZONE blocks for correct DST in Outlook and overnight-flight handling

## Mobile (`/m`)

- End-to-end planning on mobile — create trips, edit metadata, add / edit / delete segments, edit day cities
- **Mobile email scan sheet** — Gmail → Claude → review → apply, with proposals for new trips when segments don't match an existing trip
- **Map view** and **timeline view** with rotation support
- **Installable PWA** — add to home screen on Android / iOS, launch standalone, read previously-loaded trips offline (mobile trip list dims trips not loaded on this device when offline)
- **Calendar sync** and **share** parity with desktop

## Trust and polish

- **Trip history (audit log)** — every change recorded in an append-only History tab (segments added / edited / deleted, todos checked, dates rolled, day cities edited, field-level diffs, shares created / revoked, XLSX or email-scan imports). Reverse-chrono, grouped by day, capped at 500 entries per trip. Available to owners and contributors.
- **Dark mode** — Light / Dark / System toggle on desktop + mobile, follows OS preference, persists across sessions
- **Demo mode** at [itinly.app/?demo=true](https://itinly.app/?demo=true) — try it without signing in
- **In-app confirm dialogs** (no more native `window.confirm`); first-time onboarding hints; dismissible intro tour on first sign-in
- **Optimistic mutations + Sonner toasts** on every user-triggered action
- **Locked brand palette** with WCAG AA-verified contrast across all token pairings

## Under the hood

- Next.js 15 + React 19 + TailwindCSS 4 + ShadCN UI on the frontend
- Express 5 + TypeScript on the backend; storage abstraction with Google Drive in production
- Claude API (`claude-sonnet-4-6`) for email parsing
- pnpm 10 monorepo orchestrated by Turborepo
- Google OAuth (auth-code + PKCE), with Gmail split onto a separate OAuth client to keep the primary client off CASA review
- Sentry on both web and server; per-user / per-trip log tagging on email-scan, calendar-sync, and trip routes
- Per-request CSP nonces, rate-limited auth + shared routes, pinned `Access-Control-Allow-Origin`
- Hosted on Vercel (web) + Railway (API) + Upstash Redis (share tokens) — all on free tiers

## Recent fixes since 0.81.0

- Mobile share supports an optional recipient email ([#236](https://github.com/justmarks/itinly/pull/236))
- Installed PWA rotates with the device; iPad portrait routes to `/m` ([#238](https://github.com/justmarks/itinly/pull/238), [#234](https://github.com/justmarks/itinly/pull/234))
- Mobile landscape timeline expands edge-to-edge; row labels stay on a single line ([#240](https://github.com/justmarks/itinly/pull/240), [#241](https://github.com/justmarks/itinly/pull/241))
- Slash-split city display + date range polish on mobile trip header ([#239](https://github.com/justmarks/itinly/pull/239))
- Auto-share rules + share / trip-list / auth polish ([#247](https://github.com/justmarks/itinly/pull/247))
- Version-bump workflow tolerates commit messages with shell metachars ([#248](https://github.com/justmarks/itinly/pull/248))
- Use Railway's documented `[skip-deploy]` marker on auto-bump commits ([#249](https://github.com/justmarks/itinly/pull/249))

## Thanks

Built on Claude Code with a lot of iteration, a lot of mobile-portrait testing, and an unreasonable number of segment-color decisions. Onward to 1.x.
