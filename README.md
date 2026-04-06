# Travel Itinerary Maker

Auto-generate travel itineraries from Gmail confirmation emails. Monitors your inbox for flight, hotel, restaurant, and activity confirmations, then builds a structured day-by-day itinerary you can view, edit, share, and export.

## Features

- **Email-powered** - Scans Gmail (entire inbox or a specific folder) and uses AI to extract travel details from confirmation emails
- **Day-by-day itinerary** - 8-column table: City, Day, Date, Transport, Lodging, Activities, Lunch, Dinner
- **Embedded costs** - Each segment card shows cost and booking details inline, with an on-demand cost summary view
- **TODO tracking** - Categorized checklist for meals, activities, research, and logistics still to book
- **Sharing** - Generate read-only links with configurable visibility (hide costs/TODOs from shared viewers)
- **Export** - Markdown, email (plans only, no prices), and OneNote (planned)
- **Manual editing** - Inline editing for all segments; changes persist alongside auto-generated content
- **Hyperlinks** - Every hotel, restaurant, and venue links to its website or booking page
- **Cross-platform** - Web + Android from the same codebase
- **Your data, your account** - Trip data stored in your own Google Drive, not a third-party database

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend (web) | Next.js + TailwindCSS + ShadCN UI |
| Frontend (mobile) | Expo + React Native + NativeWind |
| Cross-platform | Solito 5 |
| Backend | Node.js + Express + TypeScript |
| Auth | Google OAuth |
| Storage | Google Drive API (user's own account) |
| Email parsing | Claude API (Anthropic) |
| Notifications | Firebase Cloud Messaging |
| Testing | Jest + Supertest + React Testing Library |
| CI/CD | GitHub Actions |
| Hosting | Vercel (web) + Railway (API) |

## Project Structure

```
travel-itinerary-maker/
├── apps/
│   ├── web/                    # Next.js web app
│   └── mobile/                 # Expo Android app
├── packages/
│   ├── shared/                 # Types, validators, utilities
│   ├── ui/                     # Shared UI components
│   └── api-client/             # Typed API client
├── server/                     # Express backend
│   ├── src/
│   │   ├── routes/             # API endpoints
│   │   ├── services/
│   │   │   ├── email-parser/   # Gmail + Claude AI parsing
│   │   │   └── google-drive/   # Trip data storage
│   │   └── middleware/         # Auth
│   └── __tests__/
└── examples/                   # Reference itinerary PDFs
```

## Getting Started

### Prerequisites

- Node.js >= 20
- pnpm (`npm install -g pnpm`)
- Google Cloud project with OAuth credentials and Gmail API enabled

### Setup

```bash
# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env
# Edit .env with your Google OAuth credentials and Anthropic API key

# Build shared packages
pnpm --filter @travel-app/shared build

# Run the API server (development mode with in-memory storage)
pnpm --filter @travel-app/server dev

# Run all tests
pnpm turbo run test
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL |
| `ANTHROPIC_API_KEY` | Anthropic API key for email parsing |
| `PORT` | Server port (default: 3001) |
| `CORS_ORIGIN` | Allowed frontend origin (default: http://localhost:3000) |

## API

Base URL: `/api/v1`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/google` | Exchange Google auth code for tokens |
| POST | `/auth/refresh` | Refresh access token |
| GET | `/trips` | List all trips (summaries) |
| POST | `/trips` | Create a new trip |
| GET | `/trips/:id` | Get full trip with days and segments |
| PUT | `/trips/:id` | Update trip metadata |
| DELETE | `/trips/:id` | Delete a trip |
| GET | `/trips/:id/segments` | List segments (filterable by type) |
| POST | `/trips/:id/segments` | Add a segment to a day |
| PUT | `/trips/:id/segments/:segId` | Update a segment |
| DELETE | `/trips/:id/segments/:segId` | Delete a segment |
| POST | `/trips/:id/segments/:segId/confirm` | Confirm auto-parsed segment |
| GET | `/trips/:id/costs` | Aggregated cost summary |
| GET/POST/PUT/DELETE | `/trips/:id/todos` | TODO CRUD |
| POST | `/trips/:id/share` | Create a share link |
| GET | `/shared/:token` | Access a shared trip (public) |
| GET | `/trips/:id/export/markdown` | Export as markdown |

## Testing

Tests follow TDD red/green methodology. Run the full suite:

```bash
pnpm turbo run test
```

Current coverage: **106 tests** across 5 test suites.

| Package | Tests | Coverage |
|---------|-------|----------|
| `packages/shared` | 72 | Validators, date utils, currency formatting, markdown export |
| `server` | 34 | All CRUD routes, sharing permissions, cost aggregation, export |

## Contributing

All changes go through pull requests — no direct commits to main.

Use [conventional commits](https://www.conventionalcommits.org/):
- `feat:` - new feature (bumps minor version)
- `fix:` - bug fix (bumps patch version)
- `feat!:` - breaking change (bumps major version)

Version is auto-incremented on merge to main via GitHub Actions.

## Roadmap

- [x] **Phase 1** - Monorepo, types, backend API, tests
- [ ] **Phase 2** - Core UI (Next.js web app with itinerary table)
- [ ] **Phase 3** - Email processing (Gmail + Claude AI parsing)
- [ ] **Phase 4** - Sharing + export
- [ ] **Phase 5** - Mobile app (Expo Android)
- [ ] **Phase 6** - OneNote export, visual timeline, PDF export
- [ ] **Phase 7** - Google Calendar sync

## License

Private project.
