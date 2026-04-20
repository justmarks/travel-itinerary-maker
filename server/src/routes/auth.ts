import { Router, type Request, type Response } from "express";
import { google } from "googleapis";
import { config } from "../config/env";
import type { TokenStore } from "../services/token-store";

export interface AuthRoutesOptions {
  tokenStore?: TokenStore;
}

export function createAuthRoutes(options: AuthRoutesOptions = {}): Router {
  const { tokenStore } = options;
  const router = Router();

  /**
   * POST /auth/google
   * Exchange a Google auth code for tokens.
   * Client sends the authorization code from Google Sign-In.
   */
  router.post("/google", async (req: Request, res: Response) => {
    const { code, redirectUri, codeVerifier } = req.body as {
      code: unknown;
      redirectUri?: string;
      codeVerifier?: string;
    };
    if (!code) {
      res.status(400).json({ error: "Authorization code is required" });
      return;
    }

    try {
      // Web clients use @react-oauth/google popup flow, which sets redirect_uri
      // to "postmessage". Native clients (e.g. mobile) pass their own URI and an
      // optional PKCE code verifier in the request body.
      const resolvedRedirectUri = typeof redirectUri === "string" && redirectUri
        ? redirectUri
        : "postmessage";

      const oauth2Client = new google.auth.OAuth2(
        config.google.clientId,
        config.google.clientSecret,
        resolvedRedirectUri,
      );

      const { tokens } = await oauth2Client.getToken({
        code: String(code),
        ...(codeVerifier ? { codeVerifier } : {}),
      });
      oauth2Client.setCredentials(tokens);

      // Get user info
      const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
      const userInfo = await oauth2.userinfo.get();

      // Store refresh token server-side for shared route access
      if (tokenStore && tokens.refresh_token && userInfo.data.id) {
        tokenStore.set(
          userInfo.data.id,
          tokens.refresh_token,
          userInfo.data.email || "",
        );
      }

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
