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
