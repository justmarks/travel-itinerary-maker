import rateLimit, { ipKeyGenerator, type Options } from "express-rate-limit";
import type { Request } from "express";

/**
 * Per-user key generator. Prefers the authenticated user ID so two users
 * sharing an IP (NAT, public WiFi) don't share a quota. Falls back to the
 * client IP via `ipKeyGenerator` so IPv6 gets /64 subnet bucketing rather
 * than every /128 counting as its own bucket.
 */
function userOrIpKey(req: Request): string {
  if (req.userId) return `u:${req.userId}`;
  return `ip:${ipKeyGenerator(req.ip ?? "unknown")}`;
}

const skipInTests = () => process.env.NODE_ENV === "test";

/**
 * Rate limiter for the Gmail scan endpoint.
 *
 * The scan endpoint is the most expensive call we expose — each request
 * fetches up to 100 emails from Gmail and fans them out to Claude for
 * parsing, which is both slow and costly. A single user (or a runaway
 * client) tapping the button repeatedly can easily burn through API
 * quotas for everyone. Rate limiting keeps that bounded.
 */
export function createEmailScanRateLimiter(overrides?: Partial<Options>) {
  return rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    limit: 20, // 20 scans per hour per user/IP
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: skipInTests,
    keyGenerator: userOrIpKey,
    message: {
      error:
        "Too many scan requests. Please wait before scanning again — Gmail and AI quotas are rate-limited to keep the app affordable.",
    },
    ...overrides,
  });
}

/**
 * Rate limiter for the Google Calendar sync endpoints.
 *
 * Sync/unsync fan out one Google Calendar API call per segment, so a single
 * request can issue dozens of calls. A rogue client hammering the button
 * could quickly exhaust the user's daily Calendar API quota. The limit is
 * generous relative to realistic use (one user will re-sync a handful of
 * times per day) but tight enough to cap the blast radius.
 */
export function createCalendarSyncRateLimiter(overrides?: Partial<Options>) {
  return rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    limit: 30, // 30 sync/unsync calls per hour per user/IP
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: skipInTests,
    keyGenerator: userOrIpKey,
    message: {
      error:
        "Too many calendar sync requests. Please wait before syncing again — Google Calendar quotas are limited.",
    },
    ...overrides,
  });
}

/**
 * IP-only key generator for routes that don't have an authenticated
 * user yet (the OAuth code-exchange flow). Reuses `ipKeyGenerator` so
 * IPv6 still buckets at /64 rather than per-/128.
 */
function ipOnlyKey(req: Request): string {
  return `ip:${ipKeyGenerator(req.ip ?? "unknown")}`;
}

/**
 * Rate limiter for OAuth token exchange + refresh.
 *
 * The auth endpoints accept untrusted input (an authorization code or
 * a refresh token) and call out to Google. A misbehaving or hostile
 * client looping on `/auth/google` or `/auth/refresh` could:
 *   - exhaust the server's outbound Google API quota, blocking real
 *     sign-ins for everyone
 *   - generate Sentry / log noise that masks real auth failures
 *   - in the refresh path, brute-force reused refresh tokens at scale
 *
 * Limit is keyed on IP because the request usually has no authenticated
 * user yet. 30 attempts per 15 min is well above any legitimate
 * refresh cadence (the access token is good for 1 hour) while shutting
 * down anything resembling an enumeration.
 */
export function createAuthRateLimiter(overrides?: Partial<Options>) {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: skipInTests,
    keyGenerator: ipOnlyKey,
    message: {
      error: "Too many auth requests. Please wait a few minutes and try again.",
    },
    ...overrides,
  });
}

/**
 * Rate limiter for auto-share-rule creation (`POST /api/v1/share-rules`).
 *
 * Each successful rule creation fans out a Postgres write per matching
 * trip AND fires a consolidated push notification to the recipient. A
 * single authenticated user creating rules in a tight loop can:
 *   - flood a victim email's recipient inbox with push notifications
 *     (one per rule × N trips fan-out), turning the share-rules endpoint
 *     into an unauthenticated abuse channel against any chosen email
 *   - amplify the per-call write cost across the whole trip set, which
 *     is fine for one call but spectacular for thousands
 *
 * Keyed per-user (or per-IP for the rare unauth path) so one user's
 * mistake doesn't blast everyone. 30/hour is well above any legitimate
 * "I'm setting up auto-share with my partner and parents" cadence.
 */
export function createShareRulesWriteRateLimiter(overrides?: Partial<Options>) {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: skipInTests,
    keyGenerator: userOrIpKey,
    message: {
      error:
        "Too many auto-share rule changes. Wait an hour before adding more — this limit protects recipients from being flooded with notifications.",
    },
    ...overrides,
  });
}

/**
 * Rate limiter for the public share-link resolver
 * (`GET /api/v1/shared/:token`).
 *
 * Share tokens are now 256-bit base64url so brute-forcing is
 * mathematically infeasible — but legacy tokens issued before the
 * \`crypto.randomBytes\` switch (#155) are only ~40 bits. Rate limiting
 * makes scanning legacy tokens impractical regardless of which
 * generation a token belongs to. It also caps the cost of someone
 * pointing a scraper at a known share URL.
 *
 * Keyed on IP. 60 requests per minute is generous enough for a family
 * group on the same NAT all opening the link at once, but well below
 * what a brute-force scanner would need.
 */
export function createShareLinkRateLimiter(overrides?: Partial<Options>) {
  return rateLimit({
    windowMs: 60 * 1000, // 1 minute
    limit: 60,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: skipInTests,
    keyGenerator: ipOnlyKey,
    message: {
      error: "Too many requests to this share link. Please slow down.",
    },
    ...overrides,
  });
}
