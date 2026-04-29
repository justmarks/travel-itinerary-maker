# Redis persistence (Upstash)

The API server keeps two pieces of state in-memory:

- **`TokenStore`** — Google OAuth refresh tokens, keyed by user ID. Used
  by the public `/shared/:token` route to mint access tokens for trip
  owners on behalf of recipients.
- **`ShareRegistry`** — share token → trip-owner mapping. Used by the
  same route to find which user's Drive contains a shared trip.

Both default to plain `Map`s. That works for dev / tests but is fragile
in production: every restart wipes them, breaking existing share links
until owners log back in or the recovery scan rebuilds.

When the server detects `UPSTASH_REDIS_REST_URL` **and**
`UPSTASH_REDIS_REST_TOKEN`, it transparently switches both stores to a
write-through Redis backing:

- Reads still hit the in-memory cache (sync, fast).
- Writes update the cache and asynchronously persist to Redis.
- On startup, `createApp()` awaits a hydrate step that pulls every entry
  back into the cache via `HGETALL` (a single round-trip per hash).

If either env var is missing the stores stay pure in-memory. Tests pass
`disableRedis: true` to `createApp` so they never touch Upstash even if
those vars happen to be set in the developer's shell.

## One-time setup

1. **Sign up at <https://upstash.com>** (free tier is fine for our scale —
   500K commands/month, 256MB).
2. **Create a Redis database** in any region close to where the API
   server runs. Region matters for latency; pick the same region as
   Render if possible.
3. **Open the database → REST API tab.** Copy the two values:
   - `UPSTASH_REDIS_REST_URL` (e.g. `https://us1-flying-cat-12345.upstash.io`)
   - `UPSTASH_REDIS_REST_TOKEN` (long base64-ish string)
4. **Set them as env vars on the API server** (Render → service →
   Environment → Add variable).
5. **Redeploy.** On boot the server logs `Persistence: Upstash Redis
   (token store + share registry)`.

> ⚠️ These are per-database REST credentials. Do not use the account
> "Management API" key — that's for managing databases, not data plane
> reads/writes.

## What's stored

Two Redis hashes (small, predictable):

| Key | Field | Value |
|---|---|---|
| `tokens` | `{userId}` | `{ userId, refreshToken, email, updatedAt }` |
| `shares` | `{shareToken}` | `{ shareToken, tripId, ownerUserId, createdAt }` |

A typical trip yields one `shares` entry per share link. A typical user
yields one `tokens` entry total. Even at 10K users + 10K shares the
combined storage stays well under 1MB.

## Write-through reliability

Writes are fire-and-forget — the in-memory cache is updated
synchronously, the Redis write happens in the background. Failures are
logged with the prefix `[token-store]` or `[share-registry]` so they
show up in Render logs without blocking the user-facing request.

If a write to Redis fails, the running process keeps working off its
in-memory copy. Persistence resumes automatically on the next successful
write. The risk window is "data created during a temporary Redis
outage may not survive a server restart that follows it" — small
enough that we trade it for the simpler write path.

## Multi-instance considerations

Today the server runs as a single instance, so the in-memory cache is
authoritative. If you scale horizontally:

- A write on instance A propagates to Redis but doesn't invalidate
  instance B's cache. B will return stale data until a restart or
  explicit cache invalidation.
- The fix is either (a) read-through on every request (no cache —
  pay Redis latency on each lookup), or (b) pub/sub-based cache
  invalidation. Worth doing only if/when multi-instance becomes
  necessary.

## Cost

Upstash free tier: **500K commands/month, 256MB storage**. At our
volume each share creation = ~3 commands and each share lookup = 1
command, so this comfortably covers tens of thousands of monthly
events. Beyond the free tier, pay-as-you-go is roughly $0.20 per 100K
commands.
