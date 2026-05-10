# Vercel setup

The web app deploys to Vercel so the share-link route
(`/shared/[token]`) can run `generateMetadata` on the Edge runtime —
that's what produces a per-trip Open Graph preview when someone pastes
a share URL into Slack, iMessage, etc. (Snapshot data is written by the
backend to Upstash Redis at share-creation time; the Edge route reads
it.)

We picked Vercel after hitting an `@vercel/next` builder bug that
double-prefixes monorepo paths when running `next-on-pages` against a
pnpm workspace. Vercel itself handles its own builder correctly, so
this whole class of issue evaporates when Vercel is the host.

## One-time setup (in the Vercel dashboard)

1. **Import the repo.**
   - Vercel dashboard → **Add New → Project** → select
     `justmarks/itinly`.

2. **Project configuration.**
   - **Framework Preset:** `Next.js` (auto-detected).
   - **Root Directory:** `apps/web`. *This is the critical setting* — it
     tells Vercel the Next.js app lives in a subdirectory; without it
     Vercel tries to build from the workspace root and fails.
   - **Build Command:** *Override* with
     ```
     cd ../.. && pnpm turbo build --filter=@travel-app/web
     ```
     This runs Turbo from the monorepo root and builds the shared
     workspace packages (`@travel-app/shared`, `@travel-app/api-client`)
     before `@travel-app/web`. The default `next build` would skip those
     and fail.
   - **Install Command:** leave default — Vercel auto-detects pnpm and
     installs the whole workspace.
   - **Output Directory:** leave default (`.next`).
   - **Node Version:** `22.x` (Project Settings → General → Node.js
     Version).

3. **Environment variables.** Set on **Production**, **Preview**, and
   **Development** unless noted. (Project Settings → Environment
   Variables.)
   - `NEXT_PUBLIC_API_URL` — your Railway API base URL. **Use
     different values per scope** so Vercel previews hit Railway's
     preview env, not production:
     - **Production:** `https://itinly.up.railway.app/api/v1`
     - **Preview:** `https://itinly-preview.up.railway.app/api/v1`
     - **Development:** `http://localhost:3001/api/v1`
   - `NEXT_PUBLIC_GOOGLE_CLIENT_ID` — Google OAuth client ID.
   - `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — Google Maps API key.
   - `NEXT_PUBLIC_SITE_URL` — your Vercel deployment origin (e.g.
     `https://itinly.vercel.app` or your custom domain like
     `https://itinly.app`). Used by `metadataBase` to absolutise OG
     image URLs.
   - `NEXT_PUBLIC_PROD_ORIGIN` — your **production** Vercel origin
     (e.g. `https://project-yhbyn.vercel.app`). Set on **Production
     and Preview** with the same value. Drives the OAuth preview
     relay (see below).
   - `NEXT_PUBLIC_PREVIEW_ORIGIN_PATTERN` — anchored regex matching
     allowed preview origins. Include the per-deploy Vercel hostname
     pattern AND any stable preview alias (see "Stable preview alias"
     below). Example:
     `^(https://itinly-[a-z0-9-]+-justmarks-projects\.vercel\.app|https://preview\.itinly\.app)$`.
     The character class on the per-deploy pattern includes `-` so
     branch-alias URLs (`itinly-git-feat-foo-...`) match alongside
     per-deploy hash URLs (`itinly-7a3lt52rq-...`). Set on
     **Production only** — that's where the relay runs.
   - `UPSTASH_REDIS_REST_URL` — Upstash REST URL. **Server-only — do
     not prefix with `NEXT_PUBLIC_`.** Read by the Edge runtime in
     `app/shared/[token]/page.tsx` to fetch the share snapshot.
   - `UPSTASH_REDIS_REST_TOKEN` — Upstash REST token. Same — server-only.

4. **Deploy.** Push to `main` (or click **Deploy** in the dashboard).
   First build takes ~3–5 minutes. Subsequent builds are faster thanks
   to Vercel's automatic caching of `node_modules`, `.next/cache`, and
   the Turbo cache.

## Updating Google OAuth

After the first deploy, add the new origin to the Google Cloud Console
OAuth client:

- **Authorized JavaScript origins:** add the Vercel **production** URL
  (e.g. `https://project-yhbyn.vercel.app`) and any custom domain.
- **Authorized redirect URIs:** add `<origin>/auth/callback` for each
  origin you sign in from. The web flow does a full-page redirect to
  Google with `redirect_uri=<origin>/auth/callback` (the
  `prompt=consent` flow needed to reliably issue refresh tokens), and
  Google rejects any URI not in this list with `redirect_uri_mismatch`.
  Production: `https://project-yhbyn.vercel.app/auth/callback`. Local
  dev: `http://localhost:3000/auth/callback`. **Do not register
  preview URLs** — Google doesn't support wildcards, and Vercel
  preview hostnames change per deploy. Previews relay through
  production instead (see below).

## OAuth on preview deployments

Google's OAuth client only allows a fixed set of redirect URIs (no
wildcards), but every Vercel preview gets a unique
`<project>-<hash>-<owner>.vercel.app` hostname. To make sign-in work
on previews without re-registering URIs every deploy, the web app
relays the OAuth round-trip through production.

How it works:

1. **Preview** (`branch-foo-yhbyn.vercel.app`) sets Google's
   `redirect_uri` to **production**'s `/auth/callback` — the only URI
   registered with Google. The OAuth `state` carries
   `{ csrf, origin: <preview-origin> }` (base64url-encoded JSON).
2. **Google** authenticates the user and redirects to
   `https://project-yhbyn.vercel.app/auth/callback?code=...&state=...`.
3. **Production**'s callback decodes `state`, sees `state.origin !==
   window.location.origin`, validates the origin against
   `NEXT_PUBLIC_PREVIEW_ORIGIN_PATTERN`, and does a
   `window.location.replace()` to
   `<state.origin>/auth/callback?code=...&state=...` — passing the
   query string through unchanged.
4. **Preview**'s callback decodes `state`, finds `state.origin ===
   window.location.origin`, validates `state.csrf` against the token
   stashed in `sessionStorage` at sign-in time, and POSTs the code to
   the backend. The `redirectUri` it sends to the backend matches what
   Google saw — production's URL — so the code exchange succeeds.

Required env vars (already listed in the One-time setup section
above):

- `NEXT_PUBLIC_PROD_ORIGIN` on **Production and Preview**, same value
  on both — the production origin URL.
- `NEXT_PUBLIC_PREVIEW_ORIGIN_PATTERN` on **Production only** — an
  anchored regex (string form) matching every origin you trust to
  receive a relayed OAuth code. The relay refuses to bounce to
  anything that doesn't match, so this is the bit that prevents the
  callback from becoming an open redirect that leaks codes. Mirror
  the pattern you use for the server's `CORS_ORIGIN_PATTERN`.

Localhost auto-skips the relay — the helper recognises
`http://localhost:*` and `http://127.0.0.1:*` and uses the local
callback directly.

If `NEXT_PUBLIC_PROD_ORIGIN` is unset on a preview deployment, the
preview will try its own origin as `redirect_uri` and Google will
reject it with `redirect_uri_mismatch` — same failure mode as before
this was wired up.

## Updating the backend (Railway)

Railway runs **two long-lived environments** for this project:

- **`production`** — deploys from `main`. Vercel production points
  here.
- **`preview`** — deploys from a dedicated `preview` branch you
  fast-forward when you want to test full-stack changes. Vercel
  preview deployments point here. Created once via Railway dashboard
  → **+ New Environment → Duplicate Environment** with `production`
  as the source, then set the duplicated service's **Settings →
  Source → Deploy Branch** to `preview`.

Seed the `preview` branch once (creates it on the remote from `main`,
no force needed since the ref doesn't exist yet):

```
git push origin main:preview
```

After that, push any local branch into the preview env (substitute
`<your-branch>` with the actual local branch name — e.g.
`claude/foo-bar`):

```
git push origin <your-branch>:preview --force-with-lease
```

CORS supports both a literal list and a regex pattern so Vercel
preview URLs work without re-listing every per-deploy hash. Set these
on **both** Railway environments (the preview env clones values from
prod when you duplicate, but verify after):

- **`CORS_ORIGIN`** — comma-separated list of literal origins. Set to:
  ```
  https://project-yhbyn.vercel.app,http://localhost:3000
  ```
  (substitute your real production URL). The localhost entry keeps
  local dev working from Railway-hosted backends if you ever need it.
- **`CORS_ORIGIN_PATTERN`** — optional regex (string form) for dynamic
  origins. For this project's previews:
  ```
  ^https://itinly-[a-z0-9-]+-justmarks-projects\.vercel\.app$
  ```
  The character class includes `-` so branch-alias URLs
  (`itinly-git-feat-foo-...`) match alongside per-deploy hash URLs
  (`itinly-7a3lt52rq-...`). An incoming `Origin` header is allowed if
  it matches any literal in `CORS_ORIGIN` OR this pattern.

Variables that **should** match across envs:

- **`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`** — Upstash's
  free tier is one database per account, so preview shares prod's
  Redis. Trade-off: share-snapshots and refresh tokens written from
  the preview env land in the same `share-snapshots` / `tokens`
  hashes prod reads. In practice this is benign — share tokens are
  random IDs (no collisions) and refresh tokens key on the user's
  Google subject (preview overwriting prod just refreshes the same
  user's token). The cost is that test data accumulates in prod's
  Redis and counts against free-tier storage / daily commands. If
  you ever upgrade Upstash, give preview its own database and move
  these to the "should not share" list.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — preview OAuth still
  relays through the prod origin (see "OAuth on preview deployments"
  above), so the preview backend needs to recognise codes minted
  against the prod redirect URI. Same client = same code exchange.
- `ANTHROPIC_API_KEY`, `VAPID_*`, `TOKEN_ENCRYPTION_KEY` — fine to
  share unless you specifically want to isolate quota / rotate keys.

Per-environment variables you should **not** share between prod and
preview:

- **`SENTRY_DSN`** — optional, but using a separate Sentry project (or
  unsetting it on preview) keeps test-driven errors out of the prod
  alert stream.

After saving these, restart the Railway service so the new env values
take effect.

## Stable preview alias

The per-deploy `*-vercel.app` URLs change every commit, which is fine
for one-off previews but awkward to share or bookmark. To get a stable
URL that always points at the latest commit on the `preview` branch,
assign a custom domain as a Vercel **branch domain**:

1. **DNS.** Add a CNAME at your domain provider:
   `preview.itinly.app → cname.vercel-dns.com`. Vercel issues TLS
   automatically once propagation finishes.
2. **Vercel domain.** Project → Settings → Domains → add
   `preview.itinly.app`. In the same row set **Git Branch = `preview`**.
   This is the bit that re-targets the alias to the preview branch
   instead of production; without it, Vercel attaches new domains to
   the production branch by default.
3. **OAuth relay.** Extend `NEXT_PUBLIC_PREVIEW_ORIGIN_PATTERN` on the
   **Production** scope so the relay will bounce OAuth codes back to
   the alias. Anchored alternation, e.g.
   `^(https://itinly-[a-z0-9-]+-justmarks-projects\.vercel\.app|https://preview\.itinly\.app)$`.
4. **Railway preview env CORS.** Add `https://preview.itinly.app` to
   `CORS_ORIGIN` (literal list) on the Railway `preview` service so
   browser calls from the alias to the preview backend pass CORS.
5. **(Optional) Google OAuth.** Because the alias is now stable, you
   *can* register `https://preview.itinly.app/auth/callback` directly
   as an Authorized redirect URI in Google Cloud Console — that lets
   the alias skip the production-relay round-trip and sign in
   directly. Not required; the relay still works once step 3 is done.

Pushing to the `preview` branch (`git push origin <your-branch>:preview
--force-with-lease`) triggers Vercel to redeploy the alias.

## Per-PR previews

Vercel automatically builds a preview deployment for every commit on
every branch and adds a comment to the PR with the URL. No GitHub
Actions workflow needed — the `pr-preview.yml` we deleted in this PR is
replaced by Vercel's native preview system.

Each preview gets a unique URL (`<branch-slug>-<project>.vercel.app`
plus an immutable per-deploy URL). Preview deployments use the
**Preview** environment variables you set above, so make sure all six
are populated for both Production and Preview — note that
`NEXT_PUBLIC_API_URL` deliberately differs between scopes so previews
hit Railway's `preview` env (see above) instead of prod.

To test a full-stack PR (frontend changes that depend on unmerged
server changes), push the same branch to Railway's `preview` env
(substitute your real local branch name for `<your-branch>`):

```
git push origin <your-branch>:preview --force-with-lease
```

Railway redeploys `preview` from your branch; the existing Vercel
preview will now hit the matching backend without any reconfiguration.
Once the PR merges to `main`, prod redeploys; the `preview` branch can
stay where it is until the next full-stack PR overwrites it.

## Verifying the unfurl

After a real share is created on the deployed app:

1. Copy the share URL.
2. Run it through Slack's preview tester (paste in any channel) or
   inspect the headers via `curl -A "Slackbot 1.0" -I <url>`.
3. The `og:title` should be the trip title and `og:description` the
   date range — not the site-wide fallback.

If the unfurl shows the fallback ("Auto-generate travel itineraries
from email confirmations"), check:

- Vercel env vars include both Upstash secrets (without `NEXT_PUBLIC_`
  prefix) for the matching environment (Production vs. Preview).
- The share token actually exists in the `share-snapshots` Redis hash
  (visible in the Upstash console).
- The route is built as **Dynamic / Edge** in the build log
  (`ƒ /shared/[token]`), not static.
