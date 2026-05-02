# itinly

Auto-generate structured travel itineraries from email confirmations. Sign in with Google, and your trip data lives in your own Google Drive — no third-party database, no monthly hosting costs.

[![CI](https://github.com/justmarks/travel-itinerary-maker/actions/workflows/ci.yml/badge.svg)](https://github.com/justmarks/travel-itinerary-maker/actions/workflows/ci.yml)

**Live app:** [itinly.app](https://itinly.app) · **Demo (no sign-in):** [itinly.app/?demo=true](https://itinly.app/?demo=true) · **Marketing:** [/welcome](https://itinly.app/welcome) · **Legal:** [/privacy](https://itinly.app/privacy) · [/terms](https://itinly.app/terms)

---

## Features

- **Day-by-day itinerary view** — inline segment cards with editing, per-segment costs, and confirmation codes
- **Timeline view** — Hipmunk-style Gantt grid; toggle between swimlane rows (Transport / Hotel / Activities / Dining) and a single chronological row; hotel stays render as spanning bars; prints cleanly
- **Map view** — plot hotels, dining, activities, and transport endpoints as pins on an interactive Google Map; KML export for sharing with Google My Maps
- **Flight endpoints by IATA code** — flights store 3-letter airport codes (e.g. `JFK`, `NRT`) and render consistently as `City (CODE)` everywhere; the segment editor has a typeahead that searches 1,178 commercial airports by code, city, airport name, or alias (so "Tokyo" finds NRT) and the title auto-fills to `DEP → ARR (Carrier RouteCode)` once both endpoints are set
- **Google OAuth** — sign in with your Google account; no separate credentials needed
- **Google Drive storage** — trip data stored as JSON in your own Drive (you own your data)
- **Inline editing** — rename trips, add/edit/delete segments, manage TODOs and costs; one-click "Confirm all" for a whole batch of auto-parsed segments
- **Embedded costs** — each segment card shows cost and booking details inline, with a dedicated Costs tab
- **TODO tracking** — categorized checklist for meals, activities, research, and logistics
- **Sharing** — generate share links with configurable visibility (costs, TODOs)
- **Export** — download itineraries as Markdown, OneNote-compatible HTML, PDF, or **iCal (.ics)**; the iCal file is named after the trip, includes VTIMEZONE blocks for correct DST display in Outlook, and handles overnight flights (arrival date advances to the next calendar day when the flight crosses midnight UTC)
- **Google Calendar sync** — push all trip segments to any of your writable Google Calendars with one click; hotels and car rentals become all-day events; flights and trains carry the correct IANA time zone per city so events land at the right wall-clock time regardless of your device zone; re-sync updates existing events; unsync removes them; a calendar picker lets you choose which calendar before each sync
- **Dark mode** — Light / Dark / System theme toggle in the user menu (desktop + mobile); follows your OS preference by default and persists your choice across sessions
- **Demo mode** — try the app with sample data via `?demo=true` (no sign-in required)
- **Email parsing** — auto-extract flights, hotels, restaurants from Gmail confirmations using Claude AI
- **Email file import** — paste or upload a saved `.html` or `.eml` message and run it through the same Claude parser (unblocks non-Gmail users)
- **XLSX import** — one-shot import a complete trip from a OneNote-exported workbook; auto-detects column layouts (B=date vs. C=date) and parses the Costs sheet, attaching costs to matching lodging segments

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 · React 19 · TailwindCSS 4 · ShadCN UI |
| Mobile | Expo SDK 55 · React Native 0.77 · expo-auth-session |
| Backend | Express 5 · TypeScript · Google Drive API · Gmail API |
| AI | Claude API (Anthropic) for email parsing |
| Shared packages | Zod validators · TanStack React Query · typed API client |
| Auth | Google OAuth (auth-code flow + PKCE for native) |
| Monorepo | pnpm 10 workspaces · Turborepo |
| CI/CD | GitHub Actions · auto version bumping · Vercel deploy |
| Hosting | Vercel (web, SSR + Edge runtime for share unfurls) · Railway (API) · Upstash Redis (share-token persistence) — all free tier |

## Project Structure

```
travel-itinerary-maker/
├── apps/
│   ├── web/                  # Next.js 15 frontend (App Router)
│   └── mobile/               # Expo SDK 55 React Native app (Android)
├── packages/
│   ├── shared/               # Types, Zod schemas, utilities (framework-agnostic)
│   └── api-client/           # Typed fetch client + React Query hooks
├── server/                   # Express 5 REST API
│   ├── src/
│   │   │   ├── routes/           # trips, auth, shared, emails
│   │   ├── services/         # Google Drive, Gmail scanner, email parser, token store
│   │   └── middleware/       # Auth
│   └── __tests__/
├── .github/workflows/        # CI + auto version bump (Vercel handles deploys)
├── turbo.json                # Build pipeline
└── pnpm-workspace.yaml       # Workspace config
```

## Getting Started

### Prerequisites

- **Node.js** ≥ 20
- **pnpm** 10.33.0 — enable via corepack:
  ```bash
  corepack enable
  corepack prepare pnpm@10.33.0 --activate
  ```

### Setup

```bash
git clone https://github.com/justmarks/travel-itinerary-maker.git
cd travel-itinerary-maker
pnpm install

# Configure environment
cp server/.env.example server/.env
# Edit server/.env with your Google OAuth credentials
```

### Development

```bash
# Start everything (frontend + backend + shared packages)
pnpm dev

# Or run individually:
cd server && pnpm dev       # Express API → http://localhost:3001
cd apps/web && pnpm dev     # Next.js → http://localhost:3000
```

The backend runs in **memory mode** during development — no Google Drive credentials needed. Data resets on server restart.

### Build

```bash
pnpm build    # Builds all packages in dependency order via Turborepo
```

### Test

```bash
pnpm test     # Run all tests across the monorepo

# Run specific packages:
cd server && pnpm test
cd packages/shared && pnpm test

# Run a single test file:
cd server && pnpm test -- --testPathPattern="trips.test"
```

Current coverage: **561 tests** across 30 test suites.

| Package | Tests | What's tested |
|---------|-------|---------------|
| `packages/shared` | 220 | Validators (incl. `html` / `eml` import schema branch and XLSX import schema), date utils, currency formatting (including USD FX conversion), markdown + OneNote export, iCal export (VCALENDAR wrapper, TZID on flights, all-day hotels/car-rentals, VTIMEZONE DST offsets, overnight flight date advancement, floating datetimes, line folding, escaping), ID generation, segment label formatting, IATA airport lookup (code/city/name/keyword search, timezone resolution, normalisation), overlap detection, segment matching, meal suggestions, primary-location detection (bookend exclusion, asymmetric transfer days), trip schema migrations |
| `server` | 341 | Trip + segment + todo CRUD, sharing, costs, export (markdown + OneNote + PDF + iCal), email scanning + match detection, HTML + EML import pipeline, `EmailParser.htmlToText` + `emlToEmail`, XLSX trip importer (B/C column-layout auto-detection, day-of-month carry-forward, year-hint inference + year shift, Costs sheet → lodging attachment, import route), Google Calendar sync + unsync (all-day events for hotels/car rentals, timed events with TZID for flights), auth routes, shared route, contributor edit flow (resolveTripAccess + sharedWithEmail index), `requireAuth` middleware, CORS origin allow-list + preview-pattern matching, rate limiting on `/emails/scan`, `EmailParser` (time normalisation, cost/URL sanitisation, hotel defaults, cruise portsOfCall), DriveStorage, TokenStore, refresh-token AES-256-GCM encryption, ShareRegistry, ShareSnapshotStore (Edge-runtime unfurl previews) |

## Google OAuth Setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or select existing)
3. Enable **Google Drive API** and **Gmail API**
4. Go to **APIs & Services → Credentials** → Create **OAuth 2.0 Client ID**
5. Add authorized JavaScript origins:
   - `http://localhost:3000` (local dev)
   - Your Vercel origin (e.g., `https://project-yhbyn.vercel.app` or your custom domain)
6. Add authorized redirect URIs (Google bounces the user back here after consent):
   - `http://localhost:3000/auth/callback`
   - `https://project-yhbyn.vercel.app/auth/callback` (or your production origin)

   You don't need to register Vercel preview URLs — they relay through production. See [docs/vercel-setup.md](docs/vercel-setup.md#oauth-on-preview-deployments).
7. Copy credentials into `server/.env`:
   ```
   GOOGLE_CLIENT_ID=your-client-id
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```
8. Set the frontend env var in `apps/web/.env.local`:
   ```
   NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-client-id
   ```

## Environment Variables

| Variable | Where | Description |
|----------|-------|-------------|
| `PORT` | server | Express port (default: `3001`) |
| `NODE_ENV` | server | `development` / `production` / `test` |
| `CORS_ORIGIN` | server | Comma-separated list of allowed origins (default: `http://localhost:3000`) |
| `CORS_ORIGIN_PATTERN` | server | Optional regex (as a string) for dynamic origins. A request is allowed if its `Origin` matches any literal in `CORS_ORIGIN` **or** this pattern. Used to accept Vercel per-deploy preview URLs without re-listing every hash. Example: `^https://travel-itinerary-maker-[a-z0-9]+-justmarks-projects\.vercel\.app$`. Leave unset in dev. |
| `GOOGLE_CLIENT_ID` | server | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | server | Google OAuth client secret |
| `ANTHROPIC_API_KEY` | server | For Claude AI email parsing |
| `UPSTASH_REDIS_REST_URL` | server **and** apps/web | Upstash Redis REST URL. Server uses it for token/share registry persistence; web reads it on the Edge runtime to render share unfurl previews. |
| `UPSTASH_REDIS_REST_TOKEN` | server **and** apps/web | Upstash Redis REST token (server-only on web — set as a non-public Vercel env var). |
| `TOKEN_ENCRYPTION_KEY` | server | Hex-encoded 32-byte key (64 hex chars) for AES-256-GCM encryption of refresh tokens at rest. Generate with `openssl rand -hex 32`. Unset = plaintext storage (fine for dev/tests, not recommended in production). See `docs/redis-persistence.md` for the rotation story. |
| `NEXT_PUBLIC_API_URL` | apps/web | Backend URL (default: `http://localhost:3001/api/v1`) |
| `NEXT_PUBLIC_SITE_URL` | apps/web | Origin used by `metadataBase` for absolute OG image URLs. Set to the deployed origin (e.g. `https://travel-itinerary-maker.vercel.app`). |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | apps/web | Google OAuth client ID for frontend |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | apps/web | Google Maps API key (enables Map tab) |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` | apps/web | Cloud map ID for styled markers (optional; defaults to demo ID) |
| `NEXT_PUBLIC_PROD_ORIGIN` | apps/web | Production origin (e.g. `https://itinly.vercel.app`). Set in Vercel for both **Production and Preview**. Drives the OAuth preview-relay: previews send Google's `redirect_uri` here (the only value Google has registered) and are bounced back via `state.origin`. Leave unset locally. See [docs/vercel-setup.md](docs/vercel-setup.md#oauth-on-preview-deployments). |
| `NEXT_PUBLIC_PREVIEW_ORIGIN_PATTERN` | apps/web | Anchored regex matching allowed preview origins for the OAuth relay. Set on **Production only** — that's where the relay validates the `state.origin` before bouncing the OAuth code. Mirrors the server's `CORS_ORIGIN_PATTERN`. Example: `^https://travel-itinerary-maker-[a-z0-9]+-justmarks-projects\.vercel\.app$`. |

## API Overview

Base URL: `/api/v1`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/auth/google` | Exchange Google auth code for tokens |
| `GET` | `/trips` | List all trips |
| `POST` | `/trips` | Create a new trip |
| `POST` | `/trips/import-xlsx` | One-shot import a full trip from a OneNote-exported XLSX workbook |
| `GET` | `/trips/:id` | Get trip with days and segments |
| `PUT` | `/trips/:id` | Update trip metadata |
| `DELETE` | `/trips/:id` | Delete a trip |
| `POST` | `/trips/:id/segments` | Add a segment to a day |
| `PUT` | `/trips/:id/segments/:segId` | Update a segment |
| `DELETE` | `/trips/:id/segments/:segId` | Delete a segment |
| `POST` | `/trips/:id/segments/:segId/confirm` | Mark an auto-parsed segment as reviewed |
| `POST` | `/trips/:id/segments/confirm-all` | Confirm all pending auto-parsed segments on a trip in one call |
| `GET` | `/trips/:id/costs` | Aggregated cost summary (USD-normalized) |
| `POST` | `/trips/:id/todos` | Add a TODO |
| `PUT` | `/trips/:id/todos/:todoId` | Update a TODO |
| `DELETE` | `/trips/:id/todos/:todoId` | Delete a TODO |
| `POST` | `/trips/:id/share` | Create a share link |
| `GET` | `/trips/:id/shares` | List share links for a trip |
| `DELETE` | `/trips/:id/shares/:shareId` | Revoke a share link |
| `GET` | `/shared/:token` | View a shared trip (public) |
| `GET` | `/trips/:id/export/markdown` | Export as Markdown |
| `GET` | `/trips/:id/export/onenote` | Export as OneNote HTML |
| `GET` | `/trips/:id/export/pdf` | Export as PDF (pdfkit; day-by-day + costs summary) |
| `GET` | `/trips/:id/export/ical` | Export as iCal (.ics) with VTIMEZONE blocks and correct DST offsets |
| `GET` | `/trips/calendar/list` | List the user's writable Google Calendars |
| `POST` | `/trips/:id/calendar/sync` | Push all segments to a Google Calendar; pass `?calendarId=` to target a specific calendar |
| `DELETE` | `/trips/:id/calendar/sync` | Remove all previously synced events; uses the stored `calendarId` by default |
| `GET` | `/emails/labels` | List Gmail labels for scan filtering |
| `POST` | `/emails/scan` | Scan Gmail and parse with Claude AI |
| `POST` | `/emails/import-html` | Parse a raw HTML email through the same Claude pipeline |
| `GET` | `/emails/pending` | Return pending parse results from the last scan |
| `POST` | `/emails/apply` | Add parsed segments to a trip |
| `GET` | `/emails/processed` | List previously processed emails |
| `POST` | `/emails/dismiss/:emailId` | Dismiss an email (skip on re-scan) |

## Email Processing

The app scans your Gmail for travel confirmation emails and uses Claude AI to extract structured itinerary data.

**How it works:**
1. Click "Scan Emails" from the dashboard or a trip detail page
2. Optionally select a Gmail label to filter (e.g., "Travel") or scan all mail
3. The backend searches Gmail for travel-related keywords (confirmation, booking, reservation, itinerary, e-ticket)
4. Each email body is sent to Claude AI, which extracts segments (flights, hotels, restaurants, activities, etc.) as structured JSON
5. Extracted segments are validated with Zod and auto-matched to existing trips by date
6. Each parsed segment is compared against the existing itinerary and classified as **new**, **duplicate**, **enrichment** (fills empty fields), or **conflict** (disagrees on a non-empty field) so you can review and decide what to apply
7. You review the results, select which segments to add, and assign them to trips
8. Added segments appear with a yellow "Review" badge — click the green checkmark to confirm

**Requirements:**
- Gmail API enabled in your Google Cloud project
- `ANTHROPIC_API_KEY` set in `server/.env` (Claude API key from [Anthropic](https://console.anthropic.com/))
- User must grant Gmail read permission during OAuth sign-in

**Deduplication and recovery:**
- Processed email IDs are tracked, so re-scanning skips already-handled emails
- Dismissed emails are also skipped on subsequent scans
- Emails that previously failed Zod validation are auto-retried on the next scan
- A "Re-parse previously processed emails" toggle in the scan dialog forces a full re-scan (except for emails already applied to a trip)

## Demo Mode

The app supports a runtime demo mode for trying it without Google credentials. Append `?demo=true` to any URL:

- **Live demo**: [itinly.app/?demo=true](https://itinly.app/?demo=true)
- **Local**: http://localhost:3000/?demo=true

Demo mode uses a mock API client with sample trip data. No backend required. The demo and real login flow are served from the same build — toggle via the URL parameter.

## Conventions

**Times are wall-clock local to the segment's city.** A 09:00 flight out of Tokyo and a 09:00 dinner in Paris are both stored and displayed as `09:00` — the app does not display, convert, or annotate time zones in the UI, even on multi-country trips. This keeps the day-by-day view simple: the time you read is the time you'll see on the clock when you're there.

The one place times are zone-aware is **calendar export**. Both Google Calendar sync and iCal export attach the correct IANA time zone per segment so events land at the right wall-clock time regardless of the user's device zone. For flights, the timezone is derived from the departure / arrival IATA airport code via the static `airport-lookup` table; non-flight segments fall back to the city-name lookup. iCal files include `VTIMEZONE` blocks (with DST transition dates computed via `Intl`) so Outlook and other clients that look up timezone offsets from their own database get the correct summer/winter offset rather than always using standard time. Overnight flights (e.g. LA → Paris) have their `DTEND` advanced to the next calendar day when the arrival UTC time is earlier in the day than the departure UTC time.

## Contributing

All changes go through pull requests — no direct commits to main.

Use [conventional commits](https://www.conventionalcommits.org/):
- `feat:` — new feature (bumps minor version)
- `fix:` — bug fix (bumps patch version)
- `feat!:` or `BREAKING CHANGE` — breaking change (bumps major version)

Version is auto-incremented on merge to main via GitHub Actions. `vercel.json` at the repo root carries an `ignoreCommand` so Vercel skips the no-op build for the auto-generated `chore: bump version ... [skip ci]` commits — only real merges trigger a production deploy.

## Roadmap

**Foundation (shipped):**

- [x] **Phase 1** — Foundation: monorepo, types, Zod schemas, Express API, tests
- [x] **Phase 2** — Core UI: Next.js web app, itinerary table, segment cards, inline editing
- [x] **Phase 3** — Google OAuth: sign-in flow, auth middleware, protected routes
- [x] **Phase 4** — Google Drive storage: per-user Drive persistence, token store, share registry
- [x] **Phase 5** — Email processing: Gmail scanning + Claude AI parsing, segment match detection, USD cost normalization
- [x] **Phase 6** — UX & export: PDF export (pdfkit), Timeline tab (Hipmunk/Gantt with grouped + chronological views, print-ready), Map tab (Google Maps pins + KML export)
- [x] **Email file import** — paste or upload a saved `.html` or `.eml` message and run it through the same `EmailParser` pipeline (unblocks non-Gmail users)
- [x] **Multi-layout XLSX import** — auto-detects column layouts (B=date vs. C=date, with day-of-month carry-forward for week-grouped workbooks)
- [x] **Debt payoff batch** — Gmail scanner label resolution + body extraction tests, `schemaVersion` on trip JSON, Sentry error tracking, rate limiting on `/emails/scan`
- [x] **Google Calendar sync** — push trip segments to any writable Google Calendar; hotels and car rentals as all-day events; flights/trains carry the correct IANA time zone per city; re-sync updates existing events; unsync removes them; calendar picker lets you choose the target calendar; `calendarId` stored on trip so unsync always hits the right calendar
- [x] **iCal export** — download trip as a `.ics` file named after the trip; VTIMEZONE blocks with DST-aware transitions for Outlook compatibility; overnight flight `DTEND` advanced to next day when UTC arrival precedes UTC departure
- [x] **IATA airport codes for flights** — flight segments carry `departureAirport` / `arrivalAirport` (3-letter IATA) backed by a 1,178-entry shared lookup; render as `City (CODE)` everywhere; segment editor exposes a keyboard-navigable typeahead (search by code, city, airport name, or alias); title auto-fills to `DEP → ARR (Carrier RouteCode)` once both endpoints are set; calendar sync derives the per-leg IANA timezone from the airport code with city-name fallback for legacy data and other transport

**Mobile companion (web PWA at `/m`):**

A mobile-first parallel experience focused on consuming a planned trip rather than re-creating the desktop authoring UX. Lives under `/m/*` in the same Next.js bundle and is auto-served when the viewer hits the desktop URL on a phone.

- [x] **Phase 1 — Foundation** — `MobileFrame` (430px max-width on desktop preview), `/m/login` and `/m` trip list with hero images + country flags + grouped current/upcoming/past sections, `/m/trip` detail with day carousel + segment detail bottom sheet, mobile-aware redirect, share button entry point, mobile user menu with "Use desktop site" override
- [x] **Phase 2 — Costs and Todos** — bottom-sheet for costs (USD-normalised, totals by category) and todos (full CRUD with drag-aware dismissal); pills on the trip header replace a discoverability-poor footer
- [x] **Phase 3 — Offline / PWA** — installable web app (manifest with `start_url: /m`, theme color, iOS standalone meta), hand-rolled service worker that precaches the `/m` shell + Next static chunks (cache-first), runtime-caches trip JSON (network-first → cache fallback) and Wikipedia city images (stale-while-revalidate), React Query cache persisted to `localStorage` so a previously-loaded trip is available offline, "Add to Home Screen" entry in the mobile user menu (with iOS-Safari Share-sheet hint as fallback), offline banner in `MobileFrame` driven by `navigator.onLine`

**Sharing:**

A trip's owner can publish a read-only or contributor-edit link; recipients open it without signing in (view) or sign in to edit (contributor flow). Backed by a Redis-persisted share registry so links survive server restarts and Railway sleep cycles.

- [x] **Viewer + share creation** — desktop share dialog (`ShareTripDialog`) and mobile share sheet (`MobileShareSheet`); mobile uses `navigator.share` so the OS picks the channel (Messages, Mail, AirDrop, …); recipient lands at `/shared/[token]` (desktop) or `/m/shared` (mobile); per-share toggles for showing costs and todos
- [x] **Server hardening** — `ShareRegistry` self-heal on registry miss (rebuilds from the owner's Drive once any owner logs back in); Upstash Redis persistence for `TokenStore` + `ShareRegistry` so refresh tokens and share-token mappings survive process restarts
- [x] **Cross-browser demo shares** — demo-mode share tokens are self-describing (`demo:tripId:perm:costs:todos:nonce`) so a recipient on any other browser running `?demo=true` can resolve them from their local sample trips
- [x] **Per-trip unfurl previews** — `ShareSnapshotStore` writes a tiny title/dates snapshot to Redis on share creation; the public `/shared/[token]` page reads it on the Vercel Edge runtime in `generateMetadata` and renders a per-trip Open Graph card
- [x] **Contributor edit flow** — shared trips with `permission: "edit"` show up in the recipient's own trip list with a "shared with you" badge; the recipient can open and edit them in place (writes go back to the owner's Drive); read/write access is gated by a `resolveTripAccess(req, tripId, requiredPermission)` helper that checks owner-or-shared-with-edit-permission; `ShareRegistry` keeps an email index keyed on `sharedWithEmail` for fast lookup
- [ ] **Email invites + notifications** — Resend-powered email when a share is created; notifications when a shared trip is updated (later)

**Potential ideas for the future:**

- [ ] **Android native** — Expo SDK 55 + React Native; scaffold + Google auth shipped, offline/cached active trip view in progress (no push notifications in v1)
- [ ] **Later** — FCM push notifications, OneNote polish, mobile timeline view

## License

MIT
