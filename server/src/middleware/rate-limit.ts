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
