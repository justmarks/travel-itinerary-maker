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
