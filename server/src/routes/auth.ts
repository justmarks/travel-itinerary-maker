import { Router, type Request, type Response } from "express";
import { google } from "googleapis";
import { config } from "../config/env";

export function createAuthRoutes(): Router {
  const router = Router();

  /**
   * POST /auth/google
   * Exchange a Google auth code for tokens.
   * Client sends the authorization code from Google Sign-In.
   */
  router.post("/google", async (req: Request, res: Response) => {
    const { code } = req.body;
    if (!code) {
      res.status(400).json({ error: "Authorization code is required" });
      return;
    }

    try {
      const oauth2Client = new google.auth.OAuth2(
        config.google.clientId,
        config.google.clientSecret,
        config.google.redirectUri,
      );

      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);

      // Get user info
      const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
      const userInfo = await oauth2.userinfo.get();

      res.json({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expiry_date,
        user: {
          id: userInfo.data.id,
          email: userInfo.data.email,
          name: userInfo.data.name,
          picture: userInfo.data.picture,
        },
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Authentication failed";
      res.status(401).json({ error: message });
    }
  });

  /**
   * POST /auth/refresh
   * Refresh an expired access token using a refresh token.
   */
  router.post("/refresh", async (req: Request, res: Response) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(400).json({ error: "Refresh token is required" });
      return;
    }

    try {
      const oauth2Client = new google.auth.OAuth2(
        config.google.clientId,
        config.google.clientSecret,
      );
      oauth2Client.setCredentials({ refresh_token: refreshToken });

      const { credentials } = await oauth2Client.refreshAccessToken();

      res.json({
        accessToken: credentials.access_token,
        expiresAt: credentials.expiry_date,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Token refresh failed";
      res.status(401).json({ error: message });
    }
  });

  return router;
}
