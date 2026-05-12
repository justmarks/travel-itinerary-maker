import type { Request, Response, NextFunction } from "express";
import { google } from "googleapis";
import { config } from "../config/env";
import type { TokenStore } from "../services/token-store";
import {
  looksLikeJwt,
  type SupabaseJwtValidator,
} from "../services/supabase-auth";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
      accessToken?: string;
      /**
       * Fresh access token minted from the user's *Gmail* OAuth client
       * refresh token. Populated by `requireGmailAuth` only — primary
       * routes leave this undefined.
       */
      gmailAccessToken?: string;
      /**
       * Authentication path that validated this request. Lets routes
       * surface "you're on the new auth flow, provider tokens come from
       * connections" vs "you're on legacy and req.accessToken is your
       * Google token" without re-running validation.
       */
      authSource?: "supabase" | "google-legacy";
    }
  }
}

/**
 * Module-level Supabase validator, set by `configureAuth` at app boot
 * when SUPABASE_URL is configured. `requireAuth` checks it first for
 * JWT-shaped tokens, falling back to the legacy Google access-token
 * path for opaque tokens or JWT-validation failures.
 *
 * Module-level rather than per-middleware-factory because that's how
 * the existing code imports `requireAuth` directly. Tests that need
 * deterministic state can call `configureAuth({ ... })` themselves.
 */
let supabaseValidator: SupabaseJwtValidator | undefined;

export function configureAuth(opts: {
  supabaseValidator?: SupabaseJwtValidator;
}): void {
  supabaseValidator = opts.supabaseValidator;
}

/**
 * Test helper. Restore module state to "no Supabase validator" so
 * tests don't bleed into each other.
 */
export function _resetAuthForTests(): void {
  supabaseValidator = undefined;
}

/**
 * Middleware that authenticates a Bearer-token request.
 *
 * Phase 3: accepts EITHER a Supabase Auth JWT (new path, configured
 * via `configureAuth` at startup) OR a Google OAuth2 access token
 * (legacy path, what every signed-in client passed before phase 3).
 * On success, sets `req.userId`, `req.userEmail`, and either
 * `req.accessToken` (legacy) or `req.authSource = "supabase"` so
 * downstream handlers can branch on the auth path.
 *
 * Routing logic:
 *   1. No Authorization header → 401.
 *   2. Token looks JWT-shaped AND we have a Supabase validator: try
 *      Supabase JWT validation. On success, set request fields and
 *      next().
 *   3. Otherwise (or on JWT failure): try Google userinfo. On
 *      success, set request fields and next().
 *   4. Both fail → 401.
 *
 * The fall-through from JWT failure to Google validation is
 * defensive — in practice Google tokens (`ya29.*`) never satisfy
 * `looksLikeJwt`, so a JWT-shaped token that fails Supabase
 * validation is genuinely invalid and the Google path will also
 * reject it. The fallback exists so a future provider with
 * JWT-shaped opaque tokens doesn't immediately break.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice(7);

  // Phase 3 path: try Supabase JWT first when configured.
  if (supabaseValidator && looksLikeJwt(token)) {
    try {
      const claims = await supabaseValidator(token);
      req.userId = claims.sub;
      req.userEmail = claims.email;
      req.authSource = "supabase";
      // Note: req.accessToken intentionally NOT set. Supabase users
      // fetch provider tokens from `connections` rather than passing
      // them on the request — routes that need a Google access token
      // (Drive / Gmail / Calendar) will need a Phase 4 lookup path.
      next();
      return;
    } catch (err) {
      // Defensive fall-through: see top comment. Logged at debug-ish
      // level so a steady stream of expired Supabase tokens doesn't
      // pollute prod logs.
      console.warn(
        "[auth] Supabase JWT validation failed, falling back to Google:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Legacy path — Google OAuth2 access token via userinfo endpoint.
  try {
    const oauth2Client = new google.auth.OAuth2(
      config.google.clientId,
      config.google.clientSecret,
    );
    oauth2Client.setCredentials({ access_token: token });

    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    req.userId = userInfo.data.id!;
    req.userEmail = userInfo.data.email!;
    req.accessToken = token;
    req.authSource = "google-legacy";

    next();
  } catch (err) {
    const status =
      (err as { response?: { status?: number } })?.response?.status ??
      (err as { code?: number | string })?.code;
    const isExpectedAuthFailure = status === 401 || status === "401";
    if (!isExpectedAuthFailure) {
      console.error(
        "Auth: token validation failed:",
        err instanceof Error ? err.message : err,
      );
    }
    res.status(401).json({ error: "Invalid or expired access token" });
  }
}

/**
 * Middleware factory: gate a route on the caller having linked their
 * Gmail OAuth client.
 *
 * Stacks on top of `requireAuth`: assumes `req.userId` is already set
 * by the primary auth check. Looks up the user's Gmail refresh token
 * in the TokenStore, refreshes against the Gmail OAuth client, and
 * attaches the fresh access token as `req.gmailAccessToken` for the
 * downstream handler to pass to `GmailScanner`.
 *
 * Returns 503 / `GMAIL_CLIENT_NOT_CONFIGURED` when the server has no
 * Gmail OAuth client wired up (env vars unset). Returns 403 /
 * `GMAIL_SCOPE_REQUIRED` when the user simply hasn't linked yet — the
 * frontend treats this as "show the Connect Gmail CTA".
 */
export function requireGmailAuth(tokenStore: TokenStore) {
  return async function gmailAuth(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!req.userId) {
      // requireAuth must have run first; this is a wiring bug, not a
      // user-facing error.
      res.status(500).json({ error: "requireGmailAuth requires requireAuth" });
      return;
    }
    // Phase 4c: Supabase-authed users keep their Gmail link in the
    // `connections` table, NOT TokenStore. The route's connector
    // resolver (resolveEmailConnector) refreshes from `connections`
    // and constructs the right connector class. Pass through here
    // so the resolver gets a chance — checking TokenStore for a
    // Supabase user would always 403 with GMAIL_SCOPE_REQUIRED and
    // the frontend would mis-route them to the legacy Connect
    // Gmail UI even when they're correctly linked via the new flow.
    if (req.authSource === "supabase") {
      next();
      return;
    }

    const result = await tokenStore.getGmailAccessToken(req.userId);
    if ("error" in result) {
      if (result.error === "not-configured") {
        res.status(503).json({
          error: "Gmail integration is not configured on this server",
          code: "GMAIL_CLIENT_NOT_CONFIGURED",
        });
        return;
      }
      // "not-linked" or "refresh-failed" both mean: user needs to (re-)
      // run the Gmail consent flow. We collapse them into the same
      // 403 + GMAIL_SCOPE_REQUIRED response so the frontend can treat
      // them identically (show "Connect Gmail" CTA).
      res.status(403).json({
        error: "Gmail access not granted",
        code: "GMAIL_SCOPE_REQUIRED",
      });
      return;
    }

    req.gmailAccessToken = result.accessToken;
    next();
  };
}
