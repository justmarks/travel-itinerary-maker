# CLAUDE.md — Travel Itinerary Maker

AI assistant guide for understanding and developing this codebase.

---

## Project Overview

A travel itinerary management app that parses trip data from emails and presents it in a structured day-by-day format. Users authenticate via Google OAuth, and data is stored in their own Google Drive account (no third-party database).

**Stack**: Next.js 15 frontend + Express 5 backend + shared TypeScript packages, managed as a pnpm monorepo with Turbo.

---

## Repository Structure

```
travel-itinerary-maker/
├── apps/
│   └── web/                    # Next.js 15 frontend (React 19, TailwindCSS 4, ShadCN UI)
├── packages/
│   ├── shared/                 # Types, Zod validators, pure utility functions
│   └── api-client/             # TanStack React Query hooks + typed fetch client
├── server/                     # Express 5 backend (REST API, Google OAuth, storage)
├── .github/workflows/          # CI (ci.yml) + auto version bumping (version-bump.yml)
├── turbo.json                  # Task pipeline: build → test, dev, lint, clean
├── pnpm-workspace.yaml         # Workspace: apps/*, packages/*, server
└── tsconfig.base.json          # Shared TS config (ES2022, strict, ESNext modules)
```

---

## Development Workflows

### Prerequisites

- Node.js >= 20
- pnpm 10.33.0 (`corepack enable` then `corepack prepare pnpm@10.33.0 --activate`)

### Setup

```bash
pnpm install
cp server/.env.example server/.env   # fill in credentials
```

### Running

```bash
pnpm dev          # starts all packages in dev mode via Turbo
# or individually:
cd server && pnpm dev       # Express on port 3001
cd apps/web && pnpm dev     # Next.js on port 3000
```

### Building

```bash
pnpm build        # Turbo builds in dependency order (shared → api-client → server/web)
```

### Testing

```bash
pnpm test         # all tests via Turbo (106 total: 72 shared, 34 server)
cd server && pnpm test
cd packages/shared && pnpm test
```

**No frontend tests exist yet** — only `server/` and `packages/shared/` have test suites.

### Linting

```bash
pnpm lint         # ESLint across the workspace via Turbo
cd apps/web && pnpm lint
```

- Only `apps/web` has a lint task. Config lives in `apps/web/eslint.config.mjs` (ESLint 9 flat config, extending `next/core-web-vitals` + `next/typescript` via `FlatCompat`).
- `pnpm lint` must be **clean (zero warnings, zero errors)** before committing or opening a PR. Treat warnings as errors — fix or justify every one.
- Unused-variable rule: `argsIgnorePattern: "^_"`. Prefix intentionally-unused parameters, destructured values, and caught errors with `_` (e.g. `_req`, `_err`) rather than disabling the rule.
- Prefer deleting dead imports/state over suppressing. Only reach for `// eslint-disable-next-line <rule>` when the lint is genuinely wrong for the situation, and always add a comment above it explaining why.
- Do **not** commit new `<img>` tags unless Next/Image is truly unsuitable — in that case, disable `@next/next/no-img-element` on that line with a justification (see `user-menu.tsx` for the pattern).

---

## Key Conventions

### TypeScript

- **Strict mode** everywhere (`tsconfig.base.json`). No `any` unless unavoidable.
- Target ES2022, module ESNext.
- Server compiles to CommonJS (`dist/`); shared/api-client compile to ESM.
- Use `type` keyword for type-only imports: `import type { Trip } from '@travel/shared'`.
- Infer types from Zod schemas: `type CreateTripInput = z.infer<typeof createTripSchema>`.

### Validation

- All API input validated with **Zod** in `packages/shared/src/validators/trip.ts`.
- Use `.safeParse()`, never `.parse()` in route handlers.
- Error responses return `400` with `error.issues` for validation failures.
- Add validators alongside types — every DTO has a corresponding Zod schema.

### API Design

- Base URL: `/api/v1`
- Standard HTTP semantics: `201` for POST (create), `200` for PUT/GET, `404` for missing, `400` for validation.
- Response body: direct JSON (no envelope wrapper).
- Auth middleware in `server/src/middleware/auth.ts` — apply to all protected routes.

### React / Frontend

- Client components need `"use client"` directive at the top.
- **React Query** for all server state — no manual `useEffect` fetching.
- Query keys in `packages/api-client/src/hooks.ts` use nested arrays: `["trips", id]`.
- Invalidate related queries after mutations for cache coherency.
- Access the API client via `useApiClient()` hook from `ApiClientProvider`.
- Components use TailwindCSS utility classes. Do not add custom CSS.

### Desktop + mobile parity

- **Every UX change must land in both the desktop site (`apps/web/src/app/trips/...` and the shared `components/`) and the mobile site at `apps/web/src/app/m/...`.** Hiding an action, adding a permission gate, surfacing a new piece of metadata, etc. — make the matching change on both sides in the same PR. Pulling a derivation into a hook (`useTripPermission`, `useShareLinkOwnerRedirect`, etc.) is the easiest way to keep them in sync; if a hook can't be reused, mirror the prop / state contract at minimum.
- The mobile shell at `/m` is part of the same Next.js bundle, not a separate app. Don't ship an affordance to one and forget the other.

### Action feedback (toasts + responsiveness)

User-triggered actions — rename, delete, status cycle, todo check, segment add/edit/delete, share create/revoke, calendar sync, etc. — must:

- **Be optimistic.** Update the cache via `onMutate` so the UI reflects the change before the server responds. The user should be able to fire several actions back-to-back without each one feeling like a round-trip. This is already the convention for trip / segment / todo mutations in `packages/api-client/src/hooks.ts` — match it for new mutations.
- **Never appear as ghosts.** If a mutation rolls back on error, the optimistic update must be cleared from the cache in `onError` (use the `prevTrip` / `prevTrips` / etc. snapshot pattern). A failed delete must not leave the trip in a half-deleted state on screen.
- **Show a toast on failure.** Wire `toast.error("Couldn't <verb>", { description: describeError(err) })` (Sonner) on every mutation call site. `describeError` lives in `apps/web/src/lib/api-error.ts` and pulls a useful message out of `ApiError` / `Error`. For success, only toast when the action wasn't visually obvious — e.g. a successful Calendar sync is worth a toast, but a successful checkbox tick isn't.
- **Be tappable in rapid succession.** Don't disable buttons just because `isPending` is true; the optimistic update has already shown the result. The only time to disable is when the action is genuinely incompatible with the current state (e.g. Save while still validating). Check that toggling the same checkbox five times in a row works without the UI freezing.

### Component Library

- **ShadCN UI** (New York style, Zinc colors) with Lucide React icons.
- Add new components via: `pnpx shadcn@latest add <component>` from `apps/web/`.
- ShadCN components live in `apps/web/src/components/ui/` — do not hand-edit generated files.

### Dates and IDs

- Dates are **ISO 8601 strings** (`"YYYY-MM-DD"`), never `Date` objects in types.
- Times as `"HH:MM"` or `"HH:MM:SS"`.
- Parse dates with `new Date(date + "T00:00:00")` for UTC-safe handling.
- IDs generated by `generateId()` in `packages/shared/src/utils/ids.ts` (timestamp-base36 + random-base36).

### Time zones

- **Times on segments are wall-clock local to the segment's city.** A 09:00 flight out of Tokyo and a 09:00 dinner in Paris are both stored as `09:00`. There is no time zone field on segments, and the UI does not display, convert, or annotate time zones — not on segment cards, not on the timeline, not on flights, not on multi-country trips. Do not add a TZ badge, dual-clock display, or "local vs. home" toggle; the simple UX is intentional.
- The exception is **calendar export** (Google Calendar sync): events must attach the correct IANA time zone per segment so they land at the right wall-clock time regardless of the attendee's device zone. Derive the zone from the segment's location at export time — do not persist a TZ field on the segment itself.

### Storage

- `StorageProvider` interface in `server/src/services/storage.ts` abstracts persistence.
- **InMemoryStorage** is used in development and all tests.
- Production will use **Google Drive** (DriveStorage) — not yet implemented.
- Tests call `storage.clear()` in `beforeEach` to reset state.

### Naming

- Files: `kebab-case.ts`
- Components: `PascalCase` (filename and export)
- Hooks: `camelCase` with `use` prefix
- Types/interfaces: `PascalCase`
- Zod schemas: `camelCase` ending in `Schema` (e.g., `createTripSchema`)
- Utility functions: `camelCase`

---

## Package Responsibilities

### `packages/shared`

- **No framework dependencies** — pure TypeScript + Zod only.
- Houses all domain types (`src/types/trip.ts`) and Zod validators (`src/validators/trip.ts`).
- Utility functions: dates, IDs, currency formatting, markdown export.
- Consumed by both server and frontend — keep it lean and framework-agnostic.
- Export everything through `src/index.ts`.

### `packages/api-client`

- Typed `ApiClient` class in `src/client.ts` — wraps `fetch`, throws `ApiError` on failures.
- React Query hooks in `src/hooks.ts` — one hook per logical operation.
- Provides `ApiClientProvider` context; configure via `NEXT_PUBLIC_API_URL`.
- Peer dependencies: React 18 or 19, `@travel/shared`.

### `server`

- Express 5 with TypeScript, compiled to CommonJS.
- Route files in `src/routes/`: `trips.ts`, `auth.ts`, `shared.ts`.
- Google OAuth flow in `src/routes/auth.ts` + `src/services/google-drive/`.
- Environment config in `src/config/env.ts` — reads `process.env` with defaults, no external config library.
- All tests in `__tests__/` using Jest + Supertest.

### `apps/web`

- Next.js 15 App Router. Pages in `src/app/`.
- Shared layout and providers in `src/app/layout.tsx` and `src/app/providers.tsx`.
- Feature components in `src/components/` (not in `ui/` — that's ShadCN only).

---

## Environment Variables

| Variable | Package | Description |
|---|---|---|
| `PORT` | server | Express port (default: `3001`) |
| `NODE_ENV` | server | `development` / `production` / `test` |
| `CORS_ORIGIN` | server | Allowed origin (default: `http://localhost:3000`) |
| `GOOGLE_CLIENT_ID` | server | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | server | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | server | OAuth callback URL |
| `ANTHROPIC_API_KEY` | server | For planned AI email-parsing feature |
| `SENTRY_DSN` | server | Sentry error-reporting DSN. Unset in dev/CI disables Sentry entirely. |
| `NEXT_PUBLIC_API_URL` | apps/web | Backend base URL (default: `http://localhost:3001/api/v1`) |
| `NEXT_PUBLIC_SENTRY_DSN` | apps/web | Sentry browser DSN. Must be `NEXT_PUBLIC_` to be embedded in the static bundle. Unset disables Sentry. |

---

## Git Workflow

- **Conventional commits** required — auto version bump runs on merge to `main`:
  - `feat!:` or `BREAKING CHANGE` → major bump
  - `feat:` → minor bump
  - `fix:` → patch bump
- CI runs on all PRs and pushes to `main` (`.github/workflows/ci.yml`).
- Version bumps are automated — do not manually edit version fields in `package.json`.
- Add `[skip ci]` to commit messages to bypass version bump workflow.

---

## Testing Practices

- Follow TDD — write tests before implementation where practical.
- Use fresh storage/app instances in `beforeEach`.
- Test file location mirrors source: `server/__tests__/routes/trips.test.ts` tests `server/src/routes/trips.ts`.
- Use Supertest for HTTP-level server tests — do not test Express internals directly.
- Shared utilities get unit tests in `packages/shared/__tests__/`.

---

## Common Tasks

**Add a new API endpoint:**
1. Add Zod validator to `packages/shared/src/validators/trip.ts`
2. Add types to `packages/shared/src/types/trip.ts`
3. Export from `packages/shared/src/index.ts`
4. Implement route in `server/src/routes/`
5. Add typed method to `packages/api-client/src/client.ts`
6. Add React Query hook to `packages/api-client/src/hooks.ts`
7. Write tests in `server/__tests__/`

**Add a new UI component:**
1. Run `pnpx shadcn@latest add <component>` from `apps/web/` if it's a ShadCN primitive
2. Create feature component in `apps/web/src/components/`
3. Use `useApiClient()` + React Query hooks for data fetching

**Run a single test file:**
```bash
cd server && pnpm test -- --testPathPattern="trips.test"
cd packages/shared && pnpm test -- --testPathPattern="validators"
```

**Keep demo data in sync:**

The Vercel deployment uses `apps/web/src/lib/mock-client.ts` to serve sample data instead of a real backend. Whenever you add or change API/data structures, update this file to match:

1. **New field on an existing type** — add it to the relevant objects in `SAMPLE_TRIPS` so the demo renders real-looking values rather than `undefined`.
2. **New segment type** — add an entry to `SEGMENT_CONFIG` in `itinerary-day.tsx` (icon, label, colour) and a representative segment to at least one sample trip day.
3. **New top-level resource** (e.g. a new relation on `Trip`) — add the corresponding override method to `MockApiClient` following the same pattern as existing methods (return `Promise.resolve(...)` for queries, mutate in-memory state for mutations).
4. **New API endpoint** — add a matching `override` method to `MockApiClient`; if it adds data to `Trip`, extend `SAMPLE_TRIPS` with plausible values.
5. **Renamed or removed field** — update `SAMPLE_TRIPS` and any `MockApiClient` method that references the old name.

The mock client lives entirely in the frontend package and has no effect on local development or server tests. Demo mode is activated at runtime by adding `?demo=true` to the URL — there is no build-time flag. The Vercel deployment serves both the real login flow and demo content from the same build.

**Keep readme in sync:**

The readme should reflect the current reality of the project that's checked into GitHub.