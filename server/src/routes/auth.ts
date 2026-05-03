import { Router, type Request, type Response } from "express";
import { google } from "googleapis";
import { config } from "../config/env";
import { requireAuth } from "../middleware/auth";
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

/**
 * Returns the scopes a Google access token actually grants, using
 * Google's tokeninfo endpoint as the authoritative source. Falls back
 * to a caller-supplied `scopeFallback` (typically `tokens.scope` from
 * the code-exchange response) if introspection fails — better to over-
 * report than to leave the user without their scope list because of a
 * single failed sub-request.
 */
async function fetchTokenScopes(
  oauth2Client: InstanceType<typeof google.auth.OAuth2>,
  accessToken: string | null | undefined,
  scopeFallback: string | null | undefined,
): Promise<string[]> {
  if (!accessToken) {
    return typeof scopeFallback === "string"
      ? scopeFallback.split(/\s+/).filter(Boolean)
      : [];
  }
  try {
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const info = await oauth2.tokeninfo({ access_token: accessToken });
    if (typeof info.data.scope === "string") {
      return info.data.scope.split(/\s+/).filter(Boolean);
    }
  } catch (err) {
    console.warn(
      "[auth] tokeninfo failed, falling back to code-exchange scope field:",
      err instanceof Error ? err.message : err,
    );
  }
  return typeof scopeFallback === "string"
    ? scopeFallback.split(/\s+/).filter(Boolean)
    : [];
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

      // Discover what scopes the access token actually grants. We use
      // Google's tokeninfo endpoint instead of `tokens.scope` from the
      // code-exchange response because that field is unreliable in the
      // incremental-authorization flow (sometimes empty, sometimes only
      // the newly-requested scope) — `include_granted_scopes=true`
      // extends the access token to cover prior consents but doesn't
      // surface them in the response payload. tokeninfo introspects the
      // token directly and returns the cumulative set.
      const newScopes = await fetchTokenScopes(
        oauth2Client,
        tokens.access_token,
        tokens.scope,
      );

      // Union with any previously stored scopes for the user. Belt-and-
      // suspenders: if tokeninfo ever undercounts (rate limited, network
      // blip → fallback to `tokens.scope`), we don't shrink the recorded
      // set. Drive scopes can only be added by the user, so a wider
      // recorded set than reality is harmless — the API call will fail
      // and the UI will prompt for re-auth.
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
   * GET /auth/scopes
   * Returns the OAuth scopes the caller's access token actually grants.
   *
   * Lets the client bootstrap its scope list when it doesn't have one
   * — primarily users who signed in before scope tracking landed and
   * whose localStorage entry has an empty `scopes` field, but their
   * Google token already covers Gmail / Calendar from the old all-at-
   * once consent. Without this endpoint, those users would be prompted
   * to re-grant scopes they've already granted.
   */
  router.get("/scopes", requireAuth, async (req: Request, res: Response) => {
    try {
      const oauth2Client = new google.auth.OAuth2(
        config.google.clientId,
        config.google.clientSecret,
      );
      oauth2Client.setCredentials({ access_token: req.accessToken });

      const scopes = await fetchTokenScopes(
        oauth2Client,
        req.accessToken,
        null,
      );

      // Mirror the recorded set into the TokenStore so subsequent
      // server-side checks line up with what the client now knows.
      // Union, never shrink — same rationale as POST /google.
      if (tokenStore && req.userId) {
        const existing = tokenStore.get(req.userId);
        if (existing) {
          const merged = Array.from(
            new Set([...existing.scopes, ...scopes]),
          );
          tokenStore.set(
            req.userId,
            existing.refreshToken,
            existing.email,
            merged,
          );
        }
      }

      res.json({ scopes });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch scopes";
      res.status(500).json({ error: message });
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
