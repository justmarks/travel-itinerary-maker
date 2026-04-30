# Cloudflare Pages setup

The web app deploys to Cloudflare Pages instead of GitHub Pages so the
share-link route (`/shared/[token]`) can run `generateMetadata` on the
Edge runtime — that's what produces a per-trip Open Graph preview when
someone pastes a share URL into Slack, iMessage, etc. (Snapshot data is
written by the backend to Upstash Redis at share-creation time; the
Edge `generateMetadata` reads it.)

The deploy is wired through Cloudflare's native Git integration rather
than a GitHub Action, because CF Pages' built-in framework support
handles the `@cloudflare/next-on-pages` build internally and avoids the
monorepo path-doubling that breaks `vercel build` in CI.

## One-time setup (in the Cloudflare dashboard)

1. **Create a Pages project.**
   - Cloudflare dashboard → **Workers & Pages** → **Create application**
     → **Pages** → **Connect to Git** → select `justmarks/travel-itinerary-maker`.
   - Project name: `travel-itinerary-maker` (this becomes the
     `*.pages.dev` subdomain).

2. **Build configuration.**
   - **Framework preset:** `Next.js`.
   - **Build command:**
     ```
     pnpm install --frozen-lockfile && pnpm --filter @travel-app/shared build && pnpm --filter @travel-app/api-client build && pnpm --filter @travel-app/web build
     ```
   - **Build output directory:** `apps/web/.next`.
   - **Root directory:** _(leave blank — workspace root)_.
   - **Node version:** `22`.

3. **Environment variables.** Set both **Production** and **Preview**.
   - `NEXT_PUBLIC_API_URL` — your Railway API base URL (e.g.
     `https://travel-itinerary-maker.up.railway.app/api/v1`).
   - `NEXT_PUBLIC_GOOGLE_CLIENT_ID` — Google OAuth client ID.
   - `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — Google Maps API key.
   - `NEXT_PUBLIC_SITE_URL` — your Pages origin (e.g.
     `https://travel-itinerary-maker.pages.dev`). Used by `metadataBase`
     to absolutise OG image URLs.
   - `UPSTASH_REDIS_REST_URL` — Upstash REST URL. **Server-side only —
     do not prefix with `NEXT_PUBLIC_`.** Read by the Edge runtime in
     `app/shared/[token]/page.tsx` to fetch the share snapshot.
   - `UPSTASH_REDIS_REST_TOKEN` — Upstash REST token. Same — server-only.

4. **Deploy.** Push to `main` (or trigger a redeploy from the dashboard).
   The first build takes ~3–5 minutes.

## Updating Google OAuth

After the first deploy, add the new origin to the Google Cloud Console
OAuth client:

- **Authorized JavaScript origins:** add the Pages URL
  (`https://travel-itinerary-maker.pages.dev` and any custom domain).
- **Authorized redirect URIs:** still the Railway backend's
  `/api/v1/auth/google/callback`; that doesn't change.

## Updating the backend (Railway)

- Set `CORS_ORIGIN` on the Railway service to the new Pages origin
  (comma-separate to allow both old and new during cutover, then
  trim once retired).
- Confirm `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are
  already set there (they're how the server writes the share-snapshot
  hash that the edge reads).

## Verifying the unfurl

After a real share is created on the deployed app:

1. Copy the share URL.
2. Run it through Slack's preview tester (paste in any channel) or
   inspect the headers via `curl -A "Slackbot 1.0" -I <url>`.
3. The `og:title` should be the trip title and `og:description` the
   date range — not the site-wide fallback.

If the unfurl shows the fallback ("Auto-generate travel itineraries
from email confirmations"), check:

- Pages env vars include both Upstash secrets (without
  `NEXT_PUBLIC_` prefix).
- The share token actually exists in the `share-snapshots` Redis hash
  (visible in the Upstash console).
- The route is built as **Dynamic** in the build log
  (`ƒ /shared/[token]`), not static.

## Removing the old GitHub Pages deploy

The previous `pages.yml` and `pr-preview*.yml` workflows have been
deleted along with this migration. After a successful Cloudflare cutover
you can also delete the `gh-pages` branch and disable Pages in the repo
settings — they won't be updated by anything anymore.
