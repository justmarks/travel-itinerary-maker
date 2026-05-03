import type { Request, Response, NextFunction } from "express";
import { google } from "googleapis";
import { config } from "../config/env";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
      accessToken?: string;
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
