# ✈️ Travel Itinerary Maker

Auto-generate structured travel itineraries from email confirmations. Sign in with Google, and your trip data lives in your own Google Drive — no third-party database, no monthly hosting costs.

[![CI](https://github.com/justmarks/travel-itinerary-maker/actions/workflows/ci.yml/badge.svg)](https://github.com/justmarks/travel-itinerary-maker/actions/workflows/ci.yml)

**[Live Demo →](https://justmarks.github.io/travel-itinerary-maker/?demo=true)**

---

## Features

- **Day-by-day itinerary view** — inline segment cards with editing, per-segment costs, and confirmation codes
- **Timeline view** — Hipmunk-style Gantt grid; toggle between swimlane rows (Transport / Hotel / Activities / Dining) and a single chronological row; hotel stays render as spanning bars; prints cleanly
- **Map view** — plot hotels, dining, activities, and transport endpoints as pins on an interactive Google Map; KML export for sharing with Google My Maps
- **Google OAuth** — sign in with your Google account; no separate credentials needed
- **Google Drive storage** — trip data stored as JSON in your own Drive (you own your data)
- **Inline editing** — rename trips, add/edit/delete segments, manage TODOs and costs; one-click "Confirm all" for a whole batch of auto-parsed segments
- **Embedded costs** — each segment card shows cost and booking details inline, with a dedicated Costs tab
- **TODO tracking** — categorized checklist for meals, activities, research, and logistics
- **Sharing** — generate share links with configurable visibility (costs, TODOs)
- **Export** — download itineraries as Markdown, OneNote-compatible HTML, PDF, or **iCal (.ics)**; the iCal file is named after the trip, includes VTIMEZONE blocks for correct DST display in Outlook, and handles overnight flights (arrival date advances to the next calendar day when the flight crosses midnight UTC)
- **Google Calendar sync** — push all trip segments to any of your writable Google Calendars with one click; hotels and car rentals become all-day events; flights and trains carry the correct IANA time zone per city so events land at the right wall-clock time regardless of your device zone; re-sync updates existing events; unsync removes them; a calendar picker lets you choose which calendar before each sync
- **Demo mode** — try the app with sample data via `?demo=true` (no sign-in required)
- **Email parsing** — auto-extract flights, hotels, restaurants from Gmail confirmations using Claude AI
- **Email file import** — paste or upload a saved `.html` or `.eml` message and run it through the same Claude parser (unblocks non-Gmail users)
- **XLSX import** — one-shot import a complete trip from a OneNote-exported workbook; auto-detects column layouts (B=date vs. C=date) and parses the Costs sheet, attaching costs to matching lodging segments

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 · React 19 · TailwindCSS 4 · ShadCN UI |
| Backend | Express 5 · TypeScript · Google Drive API · Gmail API |
| AI | Claude API (Anthropic) for email parsing |
| Shared packages | Zod validators · TanStack React Query · typed API client |
| Auth | Google OAuth (auth-code flow) |
| Monorepo | pnpm 10 workspaces · Turborepo |
| CI/CD | GitHub Actions · auto version bumping · GitHub Pages deploy |
| Hosting | GitHub Pages (web, static export) · Railway (API) — all free tier |

## Project Structure

```
travel-itinerary-maker/
├── apps/
│   └── web/                  # Next.js 15 frontend (App Router)
├── packages/
│   ├── shared/               # Types, Zod schemas, utilities (framework-agnostic)
│   └── api-client/           # Typed fetch client + React Query hooks
├── server/                   # Express 5 REST API
│   ├── src/
│   │   │   ├── routes/           # trips, auth, shared, emails
│   │   ├── services/         # Google Drive, Gmail scanner, email parser, token store
│   │   └── middleware/       # Auth
│   └── __tests__/
├── .github/workflows/        # CI + auto version bump + GitHub Pages deploy
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

Current coverage: **465 tests** across 24 test suites.

| Package | Tests | What's tested |
|---------|-------|---------------|
| `packages/shared` | 181 | Validators (incl. `html` / `eml` import schema branch and XLSX import schema), date utils, currency formatting (including USD FX conversion), markdown + OneNote export, iCal export (VCALENDAR wrapper, TZID on flights, all-day hotels/car-rentals, VTIMEZONE DST offsets, overnight flight date advancement, floating datetimes, line folding, escaping), ID generation, segment label formatting, overlap detection, segment matching |
| `server` | 284 | Trip + segment + todo CRUD, sharing, costs, export (markdown + OneNote + PDF + iCal), email scanning + match detection, HTML + EML import pipeline, `EmailParser.htmlToText` + `emlToEmail`, XLSX trip importer (B/C column-layout auto-detection, day-of-month carry-forward, year-hint inference + year shift, Costs sheet → lodging attachment, import route), Google Calendar sync + unsync (all-day events for hotels/car rentals, timed events with TZID for flights), auth routes, shared route, `requireAuth` middleware, `EmailParser` (time normalisation, cost/URL sanitisation, hotel defaults, cruise portsOfCall), DriveStorage, TokenStore, ShareRegistry |

## Google OAuth Setup

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (or select existing)
3. Enable **Google Drive API** and **Gmail API**
4. Go to **APIs & Services → Credentials** → Create **OAuth 2.0 Client ID**
5. Add authorized JavaScript origins:
   - `http://localhost:3000` (local dev)
   - Your production domain (e.g., `https://justmarks.github.io`)
6. Add authorized redirect URIs:
   - `http://localhost:3001/api/v1/auth/google/callback`
7. Copy credentials into `server/.env`:
   ```
   GOOGLE_CLIENT_ID=your-client-id
   GOOGLE_CLIENT_SECRET=your-client-secret
   GOOGLE_REDIRECT_URI=http://localhost:3001/api/v1/auth/google/callback
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
| `CORS_ORIGIN` | server | Allowed origin (default: `http://localhost:3000`) |
| `GOOGLE_CLIENT_ID` | server | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | server | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | server | OAuth callback URL |
| `ANTHROPIC_API_KEY` | server | For Claude AI email parsing |
| `NEXT_PUBLIC_API_URL` | apps/web | Backend URL (default: `http://localhost:3001/api/v1`) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | apps/web | Google OAuth client ID for frontend |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | apps/web | Google Maps API key (enables Map tab) |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` | apps/web | Cloud map ID for styled markers (optional; defaults to demo ID) |

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

- **Live demo**: https://justmarks.github.io/travel-itinerary-maker/?demo=true
- **Local**: http://localhost:3000/?demo=true

Demo mode uses a mock API client with sample trip data. No backend required. The demo and real login flow are served from the same build — toggle via the URL parameter.

## Conventions

**Times are wall-clock local to the segment's city.** A 09:00 flight out of Tokyo and a 09:00 dinner in Paris are both stored and displayed as `09:00` — the app does not display, convert, or annotate time zones in the UI, even on multi-country trips. This keeps the day-by-day view simple: the time you read is the time you'll see on the clock when you're there.

The one place times are zone-aware is **calendar export**. Both Google Calendar sync and iCal export attach the correct IANA time zone per segment so events land at the right wall-clock time regardless of the user's device zone. iCal files include `VTIMEZONE` blocks (with DST transition dates computed via `Intl`) so Outlook and other clients that look up timezone offsets from their own database get the correct summer/winter offset rather than always using standard time. Overnight flights (e.g. LA → Paris) have their `DTEND` advanced to the next calendar day when the arrival UTC time is earlier in the day than the departure UTC time.

## Contributing

All changes go through pull requests — no direct commits to main.

Use [conventional commits](https://www.conventionalcommits.org/):
- `feat:` — new feature (bumps minor version)
- `fix:` — bug fix (bumps patch version)
- `feat!:` or `BREAKING CHANGE` — breaking change (bumps major version)

Version is auto-incremented on merge to main via GitHub Actions.

## Known Limitations

### In-memory TokenStore and ShareRegistry

`TokenStore` and `ShareRegistry` (in `server/src/services/`) are currently held in process memory. This means:

- **On redeploy or server restart**, all stored refresh tokens and share links are lost. Users will need to re-authenticate, and any existing share links will stop resolving.
- **On Railway free-tier sleep cycles**, the server process restarts on first request, wiping both stores.

The fix is to persist both stores to Google Drive (e.g., as JSON files in a dedicated app folder), the same way trip data is persisted. Until that's done, share links and seamless token refresh are best-effort in production.

Two related cleanups surfaced while auditing this area:

- `GET /shared/:token` returns **500 instead of 404** when the registry has no entry for a token. In drive mode, the fallback path in `server/src/routes/shared.ts` calls `getStorage(req)`, which throws because shared routes are unauthenticated and `req.accessToken` is undefined. Should be handled as a clean 404.
- `POST /auth/google` only stores a refresh token **when Google actually returns one**, which it does on first consent or when `access_type=offline` + `prompt=consent` are requested. Today the frontend uses the default `@react-oauth/google` popup flow, so returning users silently don't get a refresh token stored server-side. Tokens written to disk should also be encrypted at rest.

**Plan to harden:**

1. Add `DriveTokenStore` and `DriveShareRegistry` implementations alongside the existing in-memory classes.
2. On write, serialize to a known Drive file (`token-store.json` / `share-registry.json` in the app's root Drive folder), with refresh tokens encrypted at rest.
3. On read, lazy-load from Drive with a short in-process TTL cache to avoid a Drive API call on every request.
4. Wire them into `server/src/index.ts` behind an env flag (`PERSIST_TOKEN_STORE=true`) so local dev keeps the fast in-memory path.
5. Request `access_type=offline` + `prompt=consent` on the login flow so returning users reliably yield a refresh token.
6. Fix the shared-route fallback to return 404 (not 500) when a share token is unknown.
7. Add integration tests using a Drive API mock (or a dedicated test Drive folder), including a "server restart" scenario that verifies share links keep working.

## Roadmap

**Completed:**

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

**Up next:**
- [ ] **Persist TokenStore + ShareRegistry** — back in-memory token and share stores with Drive-persisted JSON so they survive redeploys; also request `access_type=offline`/`prompt=consent` so returning users yield a refresh token, fix the 500→404 on unknown share tokens, and encrypt stored refresh tokens at rest (see Known Limitations above)
- [ ] **Sharing with email notifications** — view/edit permissions, email invites via Resend, notifications when a shared trip is updated
- [ ] **Offline / PWA** — service worker that caches the active trip JSON for read-only access without signal; critical for day-of airport use
- [ ] **Android mobile** — Expo + React Native, offline/cached active trip for airport use (no push notifications in v1)
- [ ] **Later** — FCM push notifications, OneNote polish, mobile timeline view

## License

MIT
