import type { Request, Response, NextFunction } from "express";
import { google } from "googleapis";
import { config } from "../config/env";
import type { TokenStore } from "../services/token-store";

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
    }
  }
}

/**
 * Middleware that validates Google OAuth2 access tokens.
 * Extracts user info and attaches to request.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    // Don't log at error level — this fires on OPTIONS preflight and other unauthenticated requests
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  const accessToken = authHeader.slice(7);

  try {
    const oauth2Client = new google.auth.OAuth2(
      config.google.clientId,
      config.google.clientSecret,
    );
    oauth2Client.setCredentials({ access_token: accessToken });

    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    req.userId = userInfo.data.id!;
    req.userEmail = userInfo.data.email!;
    req.accessToken = accessToken;

    next();
  } catch (err) {
    // A 401 from Google means the access token is expired/revoked/invalid — the
    // expected failure mode, not worth logging. Anything else (network failure,
    // 5xx, quota, etc.) is unexpected and worth surfacing.
    const status =
      (err as { response?: { status?: number } })?.response?.status ??
      (err as { code?: number | string })?.code;
    const isExpectedAuthFailure = status === 401 || status === "401";
    if (!isExpectedAuthFailure) {
      console.error("Auth: token validation failed:", err instanceof Error ? err.message : err);
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
