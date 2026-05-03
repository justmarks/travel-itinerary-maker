import { Router, type Request, type Response } from "express";
import { google } from "googleapis";
import { config } from "../config/env";
import type { TokenStore } from "../services/token-store";
import type { ShareRegistry } from "../services/share-registry";
import { rebuildRegistryForUser } from "../services/registry-rebuild";

export interface AuthRoutesOptions {
  tokenStore?: TokenStore;
  /**
   * Optional. When provided, the login handler pre-warms the registry by
   * scanning the user's trips and re-registering every share they own.
   * Lets recipient share-URLs resolve immediately after a server restart
   * once any owner logs back in.
   */
  shareRegistry?: ShareRegistry;
}

export function createAuthRoutes(options: AuthRoutesOptions = {}): Router {
  const { tokenStore, shareRegistry } = options;
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

      // The `scope` field returned with the code exchange only reflects
      // the scopes requested in *this* authorization grant — not the
      // full set the access token can access. With
      // `include_granted_scopes=true`, the access token covers earlier
      // consents too, but the response's `scope` field doesn't list
      // them. Union with whatever we already had stored for this user
      // so an incremental grant adds to the recorded set instead of
      // shrinking it.
      const newScopes =
        typeof tokens.scope === "string"
          ? tokens.scope.split(/\s+/).filter(Boolean)
          : [];
      const previousScopes =
        (tokenStore && userInfo.data.id
          ? tokenStore.get(userInfo.data.id)?.scopes
          : undefined) ?? [];
      const grantedScopes = Array.from(
        new Set([...previousScopes, ...newScopes]),
      );

      // Store refresh token server-side for shared route access
      if (tokenStore && tokens.refresh_token && userInfo.data.id) {
        tokenStore.set(
          userInfo.data.id,
          tokens.refresh_token,
          userInfo.data.email || "",
          grantedScopes,
        );

        // Pre-warm the share registry: walk this user's trips and
        // re-register every share entry. After a server restart the
        // registry is empty, but as soon as any owner logs back in
        // their share links start working again. Fire-and-forget so the
        // login response isn't gated on a Drive scan.
        if (shareRegistry) {
          rebuildRegistryForUser(
            userInfo.data.id,
            shareRegistry,
            tokenStore,
          )
            .then((result) => {
              if (result && result.registered > 0) {
                console.log(
                  `[auth] pre-warmed registry: ${result.registered} share(s) re-registered for user ${userInfo.data.id}`,
                );
              }
            })
            .catch((err) => {
              console.warn(
                `[auth] registry pre-warm failed for ${userInfo.data.id}:`,
                err instanceof Error ? err.message : err,
              );
            });
        }
      }

      res.json({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expiry_date,
        scopes: grantedScopes,
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
