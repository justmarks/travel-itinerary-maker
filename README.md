# ✈️ Travel Itinerary Maker

Auto-generate structured travel itineraries from email confirmations. Sign in with Google, and your trip data lives in your own Google Drive — no third-party database, no monthly hosting costs.

[![CI](https://github.com/justmarks/travel-itinerary-maker/actions/workflows/ci.yml/badge.svg)](https://github.com/justmarks/travel-itinerary-maker/actions/workflows/ci.yml)

**[Live Demo →](https://justmarks.github.io/travel-itinerary-maker/?demo=true)**

---

## Features

- **Day-by-day itinerary view** — 8-column table (city, day, date, transport, lodging, activities, lunch, dinner) with inline segment cards
- **Google OAuth** — sign in with your Google account; no separate credentials needed
- **Google Drive storage** — trip data stored as JSON in your own Drive (you own your data)
- **Inline editing** — rename trips, add/edit/delete segments, manage TODOs and costs
- **Embedded costs** — each segment card shows cost and booking details inline, with an on-demand cost summary view
- **TODO tracking** — categorized checklist for meals, activities, research, and logistics
- **Sharing** — generate share links with configurable visibility (costs, TODOs)
- **Export** — download itineraries as Markdown or OneNote-compatible HTML
- **Demo mode** — try the app with sample data via `?demo=true` (no sign-in required)
- **Email parsing** — auto-extract flights, hotels, restaurants from Gmail confirmations using Claude AI
- **XLSX import** — one-shot import a complete trip from a OneNote-exported workbook (itinerary + costs sheets)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 · React 19 · TailwindCSS 4 · ShadCN UI |
| Backend | Express 5 · TypeScript · Google Drive API · Gmail API |
| AI | Claude API (Anthropic) for email parsing |
| Shared packages | Zod validators · TanStack React Query · typed API client |
| Auth | Google OAuth (auth-code flow) |
| Monorepo | pnpm 10 workspaces · Turborepo |
| CI/CD | GitHub Actions · auto version bumping |
| Hosting | Vercel (web) · Railway (API) — all free tier |

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

Current coverage: **228 tests** across 11 test suites.

| Package | Tests | What's tested |
|---------|-------|---------------|
| `packages/shared` | 109 | Validators, date utils, currency formatting (including USD FX conversion), markdown export, IDs, overlap detection, segment matching |
| `server` | 119 | Route CRUD, sharing, costs, export, email scanning + match detection, DriveStorage, TokenStore, ShareRegistry, XLSX trip importer (parser + import route) |

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
| `GET` | `/emails/labels` | List Gmail labels for scan filtering |
| `POST` | `/emails/scan` | Scan Gmail and parse with Claude AI |
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

## Contributing

All changes go through pull requests — no direct commits to main.

Use [conventional commits](https://www.conventionalcommits.org/):
- `feat:` — new feature (bumps minor version)
- `fix:` — bug fix (bumps patch version)
- `feat!:` or `BREAKING CHANGE` — breaking change (bumps major version)

Version is auto-incremented on merge to main via GitHub Actions.

## Roadmap

**Completed:**

- [x] **Phase 1** — Foundation: monorepo, types, Zod schemas, Express API, tests
- [x] **Phase 2** — Core UI: Next.js web app, itinerary table, segment cards, inline editing
- [x] **Phase 3** — Google OAuth: sign-in flow, auth middleware, protected routes
- [x] **Phase 4** — Google Drive storage: per-user Drive persistence, token store, share registry
- [x] **Phase 5** — Email processing: Gmail scanning + Claude AI parsing, segment match detection, USD cost normalization

**Up next:**

- [ ] **Debt payoff batch** — tests for public shared route, Gmail scanner label resolution + body extraction, email parser fixture tests, `schemaVersion` on trip JSON, Sentry error tracking, rate limiting on `/emails/scan`
- [ ] **HTML import** — parse a saved `.html` email through the same `EmailParser` pipeline (unblocks non-Gmail users)
- [ ] **Sharing with email notifications** — view/edit permissions, email invites via Resend, notifications when a shared trip is updated
- [ ] **Google Calendar sync** — manually initiated, two-way, deduped in both directions
- [ ] **UX iteration** — tabular view, accessibility pass, keyboard navigation
- [ ] **PDF export** — thin shim over existing Markdown export
- [ ] **Android mobile** — Expo + React Native, offline/cached active trip for airport use (no push notifications in v1)
- [ ] **Later** — FCM push notifications, OneNote polish, visual timeline

## License

MIT
