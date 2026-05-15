# CLAUDE.md — Travel Itinerary Maker

AI assistant guide for understanding and developing this codebase.

---

## Project Overview

A travel itinerary management app that parses trip data from emails and presents it in a structured day-by-day format. Users authenticate via Supabase Auth (Google or Microsoft), and trip data lives in Supabase Postgres. Email scanning supports Gmail + Outlook; calendar sync supports Google Calendar + Outlook Calendar.

**Stack**: Next.js 15 frontend + Express 5 backend + shared TypeScript packages, managed as a pnpm monorepo with Turbo.

---

## Active migration plans

- [`docs/backend-migration-plan.md`](docs/backend-migration-plan.md) — Multi-phase plan to migrate from Google Drive storage + Google-only auth to Supabase Postgres + Supabase Auth + pluggable email/calendar connectors (Gmail, Microsoft Graph). Includes phased rollout, per-phase test deliverables, rollback strategy, and a list of decisions still needed before kickoff. Read this before doing any work on storage, auth, sharing, email scan, or calendar sync — those subsystems all change shape under this plan.
- [`docs/supabase-auth-setup.md`](docs/supabase-auth-setup.md) — One-time Supabase project + Azure AD app registration setup the Phase 3 backend depends on. Setting `SUPABASE_URL` in the server env flips `requireAuth` into "Supabase JWT or legacy Google access token" coexistence mode; until that env var is set, the new auth path is dormant and every client continues using the pre-phase-3 Google flow unchanged. **Phase 3b (frontend cutover)**: setting `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `apps/web` makes the login pages route both Google and Microsoft sign-in through Supabase Auth. The legacy custom Google OAuth flow stays in the bundle as a fallback (when those vars aren't set) and so in-flight legacy redirects still complete cleanly through the same `/auth/callback` page. Deletion of the legacy flow is a follow-up PR after the new path is verified working.

---

## Repository Structure

```
itinly/
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

- Node.js >= 22.13 (pnpm 11's loader uses `node:sqlite`, which is only built in to 22+)
- pnpm 11.1.1 (`corepack enable` then `corepack prepare pnpm@11.1.1 --activate`)

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

- **Every UX change must land in both the desktop site (`apps/web/src/app/trips/...` and the shared `components/`) and the mobile site at `apps/web/src/app/m/...`.** Hiding an action, adding a permission gate, surfacing a new piece of metadata, etc. — make the matching change on both sides in the same PR. Pulling a derivation into a hook (`useTripPermission`, `useShareLinkOwnerRedirect`) or a pure helper module (`lib/trip-buckets.ts` for the Now/Upcoming/Past trip-list grouping) is the easiest way to keep them in sync; if neither can be reused, mirror the prop / state contract at minimum.
- The mobile shell at `/m` is part of the same Next.js bundle, not a separate app. Don't ship an affordance to one and forget the other.

### Action feedback (toasts + responsiveness)

User-triggered actions — rename, delete, status cycle, todo check, segment add/edit/delete, share create/revoke, calendar sync, etc. — must:

- **Be optimistic.** Update the cache via `onMutate` so the UI reflects the change before the server responds. The user should be able to fire several actions back-to-back without each one feeling like a round-trip. This is already the convention for trip / segment / todo mutations in `packages/api-client/src/hooks.ts` — match it for new mutations.
- **Never appear as ghosts.** If a mutation rolls back on error, the optimistic update must be cleared from the cache in `onError` (use the `prevTrip` / `prevTrips` / etc. snapshot pattern). A failed delete must not leave the trip in a half-deleted state on screen.
- **Show a toast on failure.** Wire `toast.error("Couldn't <verb>", { description: describeError(err) })` (Sonner) on every mutation call site. `describeError` lives in `apps/web/src/lib/api-error.ts` and pulls a useful message out of `ApiError` / `Error`. For success, only toast when the action wasn't visually obvious — e.g. a successful Calendar sync is worth a toast, but a successful checkbox tick isn't.
- **Be tappable in rapid succession.** Don't disable buttons just because `isPending` is true; the optimistic update has already shown the result. The only time to disable is when the action is genuinely incompatible with the current state (e.g. Save while still validating). Check that toggling the same checkbox five times in a row works without the UI freezing.

### Errors, toasts, banners, and logging

The decision tree for "where should this error surface?" is:

| Situation | Surface |
|---|---|
| User triggered the action and the failure is actionable (rename rejected, share-link revoke 403, calendar sync timed out) | **Sonner toast** — `toast.error("Couldn't <verb>", { description: describeError(err) })` from `@/lib/api-error` |
| User-actionable failure that needs persistence (the toast would auto-dismiss before they could read / act on it) | **Inline banner** with `--status-warn` / `--status-danger` tokens, e.g. the partial-results banner in `MobileEmailScanSheet`'s review step |
| The user's auth/scope state is stale (401, 403, `GMAIL_SCOPE_REQUIRED`) | **Step transition** — drop them on the relevant connect screen, don't toast. Toasts auto-dismiss; a stale-token user needs to land somewhere they can fix it |
| Background side-effect failed (`dismissEmail.mutate(id)` in a fire-and-forget loop) — non-fatal, no UX | `console.warn(...)` via the mutation's `onError` so it shows up during local dev / Railway tail without yelling at the user |
| Server-side parser / pipeline failure that operators need aggregated signal on | **Sentry** via `reportError(err, ctx)` (caught exception) or `reportMessage(name, { level, tags, context })` (soft failure / interesting outcome with no exception). Both live in `server/src/services/monitoring.ts` and are no-ops when Sentry isn't configured |
| Auth probe that distinguishes "user revoked at Google" from "code error" so the API can return a custom 4xx and the client can branch | Throw a typed error with a `code` (e.g. `GMAIL_SCOPE_REQUIRED`); the route handler maps to a specific status |

**Don't `console.error` in client code that isn't a debugging breadcrumb.** It writes to Sentry (when wired) and surfaces in browser dev consoles. If the failure is user-facing, toast it; if it isn't, prefer `console.warn` or silence.

**Don't swallow errors.** If you `await mutateAsync` outside React Query's `onError` flow, wrap with `try/catch` and route via the table above — `await x.catch(() => undefined)` hides bugs that should be debuggable.

**Don't show generic descriptions.** `describeError(err)` already extracts `error` from `ApiError.body` (validator issues + custom server messages) and falls back to `err.message`. If the description is still generic ("Request failed (402)"), branch on `err.status` / `err.body.code` and write a specific message — see the 402 / 503 / `ANTHROPIC_OVERLOADED` handling in `MobileEmailScanSheet.handleStartScan` for the pattern.

**`console.warn` is for operators, not users.** Use it for: deprecated upstream APIs (model-deprecation warnings forwarded to Sentry already log here too), unrecoverable-but-non-fatal background failures (auto-dismiss email failed), and anything that future-you would want to grep Railway logs for. Add a tag prefix so they're greppable: `console.warn("[email-scan] ...")`. Don't use it for routine state — it's noise.

**Sentry tagging conventions.** When emitting `reportMessage`, tag with searchable kebab-case keys grouped by domain: `email.outcome`, `email.source`, `anthropic.model`. Free-form context goes in `context`. Never put PII (email subjects, body, addresses) in either; hash via `hashSubject` if you need to group repeated failures from the same template.

### Brand palette

Locked palette A (2026-05). Every color pairing has been verified to meet WCAG 2.1 AA — ≥4.5:1 for body text, ≥3:1 for non-text icon elements. When adding brand-colored UI, pick from this palette; do not introduce ad-hoc hex values.

**Token-to-role mapping** (light mode):

| Token | Hex | Role |
|---|---|---|
| `--background` | `#F8F9FA` | Page surface (Surface light) |
| `--foreground` | `#1A2B3C` | Body text & headlines (Primary navy) |
| `--primary` | `#008CCF` | CTA buttons, links, focus rings (Action azure). Default `<Button>`s pick this up. |
| `--brand` | `#D9501C` | Accent kickers, headline highlights, feature icons, highlighted segments (Secondary vermilion). Reserved for moments that earn attention. |
| `--card` | `#FFFFFF` | Card surfaces — one notch lighter than `--background` so cards lift off the page. |
| `--muted` | `#EEF2F6` | Muted pill / chip backgrounds. Cool blue-grey in the cyan hue family. |

**Why `--primary` is cyan, not orange:** cyan reads "action / link / proceed" — what every CTA needs. Orange (`--brand`) is the louder, scarcer accent reserved for moments that deserve attention but aren't the primary path forward. Both palette colors appear on every page; orange is rarer.

**Dark mode** uses `Surface · dark` `#0E1822` as `--background`, `Surface · light` `#F8F9FA` as `--foreground`, `--card` one notch lighter than the dark surface (so cards still elevate), and lifted variants of cyan (`oklch(0.7 0.135 230)`) and orange (`oklch(0.72 0.165 40)`) for accent legibility against navy.

**Verified contrast** (light mode, vs `--background`):

- `--foreground` on `--background`: **13.7:1** (AAA — body text)
- `--primary` on `--background`: **3.5:1** (AA non-text — buttons / icons)
- `--brand` on `--background`: **3.9:1** (AA non-text — accent text / icons)
- `--primary` on `--foreground`: **3.9:1** (icon over a navy panel)
- `--brand` on `--foreground`: **3.5:1** (icon over a navy panel)

Source-of-truth files: `apps/web/src/app/globals.css` (CSS tokens), `apps/web/src/app/icon.svg` (canonical icon SVG), `apps/web/src/components/{app-logo,app-wordmark}.tsx` (inline brand components), `branding/generate-brand-assets.mjs` (regenerates every PNG in `branding/` and the in-app wordmark PNGs from the same color values), `apps/web/scripts/generate-favicon.mjs` (regenerates `favicon.ico`). Re-run both scripts after any palette tweak.

### Segment-type colors

Each itinerary segment type (flight, hotel, dinner, …) carries a trio of CSS tokens defined in `globals.css`:

- `--seg-{type}-rail` — saturated accent for the left border / pill border
- `--seg-{type}-bg` — pastel tint for the icon-disc background and row tint
- `--seg-{type}-fg` — strong foreground for the icon glyph

The eight types in `itinly-design-system/colors_and_type.css` (flight, train, car, hotel, activity, dinner, lunch, breakfast) use the design-system values verbatim. Five product-specific extensions (transport, show, brunch, tour, cruise) follow the same Tailwind 50 / 600 / saturated pattern. Dark mode overrides each token to a translucent 950/60 background and a 300-weight foreground so icons stay legible on near-black surfaces.

When adding segment-type UI (icon discs, accent rails, status pills tied to a segment type), reference these tokens — never hardcode `text-blue-500` style classes. Both the desktop `SEGMENT_CONFIG` in `itinerary-day.tsx` and the mobile `SEGMENT_CONFIG` in `mobile-segment-card.tsx` are wired this way.

### Status palette + todo categories + kicker utility

Three smaller token families layered on top of the segment palette in `globals.css`:

- **`--status-{ok,warn,danger,info,attention,muted}-{rail,bg,fg}`** — semantic UI states. `ok` for confirmed / sync success / "copied". `warn` for review-needed banners and caution. `danger` for destructive errors. `info` for neutral attention (planning chip, "create new"). `attention` for "look here" colours that aren't a literal warning (enrichment, logistics). `muted` for completed/archived/duplicate. Each tone aliases to a segment-palette hue so dark-mode lifts come for free. Use these for any pill / badge / banner that signals a state — never hand-roll `bg-amber-50 text-amber-800 border-amber-300` class triples.
- **`--todo-{meals,activities,research,logistics}-{bg,fg}`** — to-do category chip colours. Aliased to status tones (meals→warn, activities→ok, research→info, logistics→attention) so the chip and the status banner share a hue when they sit next to each other.
- **`text-kicker`** — Tailwind v4 `@utility` shortcut for the design system's `--type-xs` shorthand (`500 11px/1.3 var(--font-sans)`) plus `text-transform: uppercase` and `letter-spacing: var(--tracking-kicker)`. Replaces the `text-[11px] font-medium uppercase tracking-wider` pattern that was sprinkled across mobile sheets and headers.

The same convention applies — when adding a status pill, status banner, or kicker eyebrow, reach for the token / utility, never raw 50/600 hex utilities.

### Design system sync

The brand and token system is iterated on in **Claude Designer** and exported as a gzipped handoff bundle. When the user passes a new bundle URL, follow [`branding/DESIGN-SYSTEM-SYNC.md`](branding/DESIGN-SYSTEM-SYNC.md) — it's the standing operating procedure that says which files to read, how to diff `colors_and_type.css` against `globals.css`, where consumers live, and how to verify. Keep that doc up to date as new token categories land.

### Component Library

- **ShadCN UI** (New York style, Zinc colors) with Lucide React icons.
- Add new components via: `pnpx shadcn@latest add <component>` from `apps/web/`.
- ShadCN components live in `apps/web/src/components/ui/` — do not hand-edit generated files.

### Dates and IDs

- Dates are **ISO 8601 strings** (`"YYYY-MM-DD"`), never `Date` objects in types.
- Times as `"HH:MM"` or `"HH:MM:SS"`.
- Parse dates with `new Date(date + "T00:00:00Z")` and read them with the `getUTC*` family (`getUTCDay`, `getUTCDate`, etc.) so the result doesn't shift on non-UTC hosts. Display-only paths that go straight to `toLocaleDateString` can use the local form (`"T00:00:00"`) — the local parse + local format round-trip cleanly. Any path that mixes local parsing with UTC extraction (`.toISOString()`, `getUTCDay`) is a TZ bug; use the `Z` suffix.
- IDs generated by `generateId()` in `packages/shared/src/utils/ids.ts` (timestamp-base36 + random-base36).

### Time zones

- **Times on segments are wall-clock local to the segment's city.** A 09:00 flight out of Tokyo and a 09:00 dinner in Paris are both stored as `09:00`. There is no time zone field on segments, and the UI does not display, convert, or annotate time zones — not on segment cards, not on the timeline, not on flights, not on multi-country trips. Do not add a TZ badge, dual-clock display, or "local vs. home" toggle; the simple UX is intentional.
- The exception is **calendar export** (Google Calendar sync): events must attach the correct IANA time zone per segment so they land at the right wall-clock time regardless of the attendee's device zone. Derive the zone from the segment's location at export time — do not persist a TZ field on the segment itself.

### Storage

- `StorageProvider` interface in `server/src/services/storage.ts` abstracts persistence.
- **InMemoryStorage** is used in development and all tests.
- **SupabaseStorage** (`server/src/services/supabase-storage.ts`) is the production backend — every authenticated user's trips/segments/todos/history live in Postgres tables, scoped by `userId`.
- Both impls share the same `StorageProvider` contract test suite at `server/__tests__/storage/contract.ts`.
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
- Route files in `src/routes/`: `trips.ts`, `auth.ts`, `shared.ts`, `calendar.ts`, `emails.ts`, `connections.ts`, `share-rules.ts`, `push.ts`.
- Google + Microsoft auth in `src/routes/auth.ts` + `src/services/supabase-auth.ts`. Connectors live under `src/connectors/`.
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
| `ANTHROPIC_API_KEY` | server | For planned AI email-parsing feature |
| `SENTRY_DSN` | server | Sentry error-reporting DSN. Unset in dev/CI disables Sentry entirely. |
| `DEBUG_EMAIL_SCAN` | server | Set to `1` to enable verbose per-step logs from the email-scan pipeline (Gmail fetch, parse, dedup, apply). Off by default to keep Railway logs quiet. |
| `DEBUG_CONNECTIONS` | server | Set to `1` to enable verbose `/api/v1/connections` upsert tracing — logs `prevHadRefreshToken` / `nowHasRefreshToken` so we can tell apart "row was always tokenless" from "we clobbered a working token" without dumping the DB. Adds one extra `findByKey` per POST when enabled; off in prod. |
| `DEBUG_CALENDAR` | server | Set to `1` to enable the `[calendar-list]` `tokeninfo` diagnostic — on Google calendar 403 scope errors, hits Google's `/tokeninfo` endpoint with the user's access token to dump the actual scopes the token carries. Off by default because the probe sends the token to an external endpoint; only enable when actively triaging a scopes-mismatch incident. |
| `NEXT_PUBLIC_API_URL` | apps/web | Backend base URL (default: `http://localhost:3001/api/v1`) |
| `NEXT_PUBLIC_SENTRY_DSN` | apps/web | Sentry browser DSN. Must be `NEXT_PUBLIC_` to be embedded in the static bundle. Unset disables Sentry. |
| `NEXT_PUBLIC_SUPABASE_URL` | apps/web | Supabase project URL (Phase 3b). When set together with the anon key, the login pages route Google + Microsoft sign-in through Supabase Auth instead of the legacy custom Google OAuth flow. Unset → legacy flow stays active. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | apps/web | Supabase project anon key (Phase 3b). Pair with `NEXT_PUBLIC_SUPABASE_URL`. The anon key is safe to ship in the public bundle — row-level-security policies on the Postgres side are what gate data access. |

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

**Add a new Postgres table:**

When you add a new `pgTable` in `server/src/db/schema.ts` AND it stores per-user data (i.e. has a `user_id` or `owner_user_id` column), the same migration that creates the table MUST also enable RLS and add an owner-only policy. Supabase exposes every `public`-schema table through its managed PostgREST endpoint by default; without RLS, the anon key shipped in the browser bundle can read every user's rows directly from `https://<project>.supabase.co/rest/v1/<table>`. The server's `postgres` role has `BYPASSRLS` so server queries are unaffected — the policies exist solely to gate the PostgREST surface.

In the migration file (alongside the `CREATE TABLE` statements). The RLS block MUST be wrapped in a `DO $$ ... END $$;` that checks for the `authenticated` role — otherwise the integration test runner (which uses a vanilla Postgres 16 container without Supabase Auth installed) fails with `role "authenticated" does not exist`:

```sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'ALTER TABLE "<table_name>" ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "<table_name>_owner_rw" ON "<table_name>"';
    EXECUTE $policy$
      CREATE POLICY "<table_name>_owner_rw" ON "<table_name>"
        FOR ALL
        TO authenticated
        USING (auth.uid()::text = user_id)
        WITH CHECK (auth.uid()::text = user_id)
    $policy$;
  END IF;
END $$;
```

The `EXECUTE` wrapping defers parsing of the `auth.uid()` reference — vanilla Postgres doesn't ship that function either, and a direct `CREATE POLICY` would fail at parse time. Inside the `IF EXISTS` branch it's only reached on Supabase environments, where both the role and function are present.

Tables that are only reachable via a parent (e.g. `email_scan_runs` joining through a `schedule_id` FK to `email_scan_schedules`) still need their own RLS — denormalize a `user_id` column on the child if necessary so the policy predicate stays a simple equality check rather than a cross-table join. See `server/drizzle/0004_email_scan_rls.sql` for the canonical pattern.

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