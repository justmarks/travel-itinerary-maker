import rateLimit, { ipKeyGenerator, type Options } from "express-rate-limit";
import type { Request } from "express";

/**
 * Rate limiter for the Gmail scan endpoint.
 *
 * The scan endpoint is the most expensive call we expose — each request
 * fetches up to 100 emails from Gmail and fans them out to Claude for
 * parsing, which is both slow and costly. A single user (or a runaway
 * client) tapping the button repeatedly can easily burn through API
 * quotas for everyone. Rate limiting keeps that bounded.
 *
 * Keyed by authenticated `req.userId` when available (preferred — multiple
 * users may share a public IP), falling back to the client IP otherwise
 * (dev mode bypasses auth, so `userId` isn't populated there).
 *
 * Test mode (`NODE_ENV === "test"`) skips the limiter entirely so suites
 * that exercise the route don't trip it.
 */
export function createEmailScanRateLimiter(overrides?: Partial<Options>) {
  return rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    limit: 20, // 20 scans per hour per user/IP
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: () => process.env.NODE_ENV === "test",
    keyGenerator: (req: Request) => {
      // Prefer the authenticated user ID so two users sharing an IP (NAT,
      // public WiFi) don't share a quota. Fall back to the client IP via
      // express-rate-limit's `ipKeyGenerator` helper so IPv6 addresses get
      // normalised (/64 subnet bucketing) rather than each /128 counting
      // as its own bucket.
      if (req.userId) return `u:${req.userId}`;
      return `ip:${ipKeyGenerator(req.ip ?? "unknown")}`;
    },
    message: {
      error:
        "Too many scan requests. Please wait before scanning again — Gmail and AI quotas are rate-limited to keep the app affordable.",
    },
    ...overrides,
  });
}
