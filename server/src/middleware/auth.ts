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
  } catch {
    res.status(401).json({ error: "Invalid or expired access token" });
  }
}
