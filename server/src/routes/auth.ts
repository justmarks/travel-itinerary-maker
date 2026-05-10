import { Router, type Request, type Response } from "express";
import { google } from "googleapis";
import { config } from "../config/env";
import { requireAuth } from "../middleware/auth";
import { createAuthRateLimiter } from "../middleware/rate-limit";
import type { TokenStore } from "../services/token-store";
import type { ShareRegistry } from "../services/share-registry";

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
 * the code-exchange response) when introspection fails — better to
 * over-report than to leave the user without their scope list because
 * of a single failed sub-request.
 *
 * Returns the source so callers know whether to trust the result as
 * authoritative (`tokeninfo` — the cumulative set Google currently
 * recognises) or as a "may be incomplete" fallback (`fallback` — the
 * code-exchange response's `scope` field, which only includes scopes
 * granted in *this* authorization round, not earlier consents). The
 * distinction matters when reconciling against previously-stored
 * scopes: trust tokeninfo and overwrite, but union when we fell back.
 */
async function fetchTokenScopes(
  oauth2Client: InstanceType<typeof google.auth.OAuth2>,
  accessToken: string | null | undefined,
  scopeFallback: string | null | undefined,
): Promise<{ scopes: string[]; source: "tokeninfo" | "fallback" }> {
  if (!accessToken) {
    return {
      scopes:
        typeof scopeFallback === "string"
          ? scopeFallback.split(/\s+/).filter(Boolean)
          : [],
      source: "fallback",
    };
  }
  try {
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const info = await oauth2.tokeninfo({ access_token: accessToken });
    if (typeof info.data.scope === "string") {
      return {
        scopes: info.data.scope.split(/\s+/).filter(Boolean),
        source: "tokeninfo",
      };
    }
  } catch (err) {
    console.warn(
      "[auth] tokeninfo failed, falling back to code-exchange scope field:",
      err instanceof Error ? err.message : err,
    );
  }
  return {
    scopes:
      typeof scopeFallback === "string"
        ? scopeFallback.split(/\s+/).filter(Boolean)
        : [],
    source: "fallback",
  };
}

export function createAuthRoutes(options: AuthRoutesOptions = {}): Router {
  const { tokenStore, shareRegistry } = options;
  const router = Router();
  // Build the limiter once and apply per-route below; building it
  // in the route registration line would create a fresh in-memory
  // counter on every call.
  const authRateLimit = createAuthRateLimiter();

  /**
   * POST /auth/google
   * Exchange a Google auth code for tokens.
   * Client sends the authorization code from Google Sign-In.
   */
  router.post("/google", authRateLimit, async (req: Request, res: Response) => {
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
      const newScopesResult = await fetchTokenScopes(
        oauth2Client,
        tokens.access_token,
        tokens.scope,
      );

      // Reconcile with any previously stored scopes for the user.
      //   - tokeninfo source: authoritative on what the access token
      //     CAN do right now. If the user revoked scopes in their
      //     Google Account, tokeninfo correctly omits them — so we
      //     trust it and overwrite, never preserve a stale grant.
      //   - fallback source: `tokens.scope` is incremental-only, so on
      //     a "user added Calendar to existing Drive grant" round it
      //     would shrink the recorded set down to just Calendar.
      //     Union with what we had to keep prior scopes alive when
      //     tokeninfo had a transient failure.
      const previousScopes =
        (tokenStore && userInfo.data.id
          ? tokenStore.get(userInfo.data.id)?.scopes
          : undefined) ?? [];
      const grantedScopes =
        newScopesResult.source === "tokeninfo"
          ? newScopesResult.scopes
          : Array.from(new Set([...previousScopes, ...newScopesResult.scopes]));

      // Store refresh token server-side for shared route access
      if (tokenStore && tokens.refresh_token && userInfo.data.id) {
        tokenStore.set(
          userInfo.data.id,
          tokens.refresh_token,
          userInfo.data.email || "",
          grantedScopes,
        );

        // Phase 2: ShareRegistry persists durably to Postgres
        // (`trip_shares` table), so the prior "rebuild on login by
        // scanning Drive" pre-warm is no longer needed. The registry
        // hydrates from Postgres at server startup; per-login
        // rescanning Drive is just wasted quota and latency once the
        // durable backing exists.
      }

      // Surface any existing Gmail link on the response so the frontend
      // can bootstrap its `auth.gmail` branch without an extra round-
      // trip. Persists across primary re-authentication because the
      // Gmail client's refresh token lives on a separate slot of the
      // entry. Returns null when the user has never linked Gmail.
      const gmailEntry = tokenStore?.get(userInfo.data.id || "");
      const gmail = gmailEntry?.gmailRefreshToken
        ? {
            scopes: gmailEntry.gmailScopes ?? [],
            linkedAt: gmailEntry.gmailUpdatedAt ?? null,
          }
        : null;

      res.json({
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: tokens.expiry_date,
        scopes: grantedScopes,
        gmail,
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
   * POST /auth/google/gmail
   * Exchange an authorization code from the *Gmail* OAuth client for a
   * refresh token, and attach it to the caller's existing primary entry
   * in the TokenStore.
   *
   * The Gmail OAuth client is a separate Google Cloud Console client
   * that holds the restricted `gmail.readonly` scope, kept off the
   * primary client so the primary doesn't trigger CASA. Users who opt
   * into email scanning go through this second consent dance after
   * they've signed in with the primary client.
   *
   * Requires primary auth. We compare the userId returned by the Gmail
   * consent screen against `req.userId` (the primary token's userId) —
   * if they don't match, the user authorized a different Google account
   * for the Gmail step and we refuse rather than silently linking the
   * wrong account.
   */
  router.post(
    "/google/gmail",
    authRateLimit,
    requireAuth,
    async (req: Request, res: Response) => {
      if (!config.googleGmail.clientId || !config.googleGmail.clientSecret) {
        res.status(503).json({
          error: "Gmail integration is not configured on this server",
          code: "GMAIL_CLIENT_NOT_CONFIGURED",
        });
        return;
      }

      const { code, redirectUri, codeVerifier } = req.body as {
        code: unknown;
        redirectUri?: string;
        codeVerifier?: string;
      };
      if (!code) {
        res.status(400).json({ error: "Authorization code is required" });
        return;
      }
      if (!tokenStore) {
        res.status(503).json({
          error: "Token persistence is not configured on this server",
        });
        return;
      }
      if (!req.userId) {
        res.status(401).json({ error: "Primary auth is required" });
        return;
      }

      const resolvedRedirectUri =
        typeof redirectUri === "string" && redirectUri
          ? redirectUri
          : "postmessage";

      try {
        const oauth2Client = new google.auth.OAuth2(
          config.googleGmail.clientId,
          config.googleGmail.clientSecret,
          resolvedRedirectUri,
        );

        const { tokens } = await oauth2Client.getToken({
          code: String(code),
          ...(codeVerifier ? { codeVerifier } : {}),
        });
        oauth2Client.setCredentials(tokens);

        const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
        const gmailUserInfo = await oauth2.userinfo.get();

        // Refuse to attach a Gmail link from a different Google account
        // than the one that owns the primary session. Without this, a
        // user who hits "Choose another account" on the Gmail consent
        // screen could silently link account B's inbox to account A's
        // trip data.
        if (gmailUserInfo.data.id !== req.userId) {
          res.status(400).json({
            error:
              "Gmail authorization is for a different Google account than your sign-in. Please re-try and choose the same account.",
            code: "GMAIL_ACCOUNT_MISMATCH",
          });
          return;
        }

        if (!tokens.refresh_token) {
          // Google omits a refresh token when the user has previously
          // granted these scopes and the request didn't force consent.
          // Frontend always sends `prompt=consent` for the Gmail flow,
          // but if the user revoked outside our app and re-granted
          // without consent prompt we'd land here. Surface a clear
          // error rather than silently storing a half-link.
          res.status(400).json({
            error:
              "Google did not return a refresh token. Try disconnecting in your Google Account and re-linking.",
            code: "GMAIL_REFRESH_TOKEN_MISSING",
          });
          return;
        }

        const gmailScopesResult = await fetchTokenScopes(
          oauth2Client,
          tokens.access_token,
          tokens.scope,
        );

        const linked = tokenStore.setGmail(
          req.userId,
          tokens.refresh_token,
          gmailScopesResult.scopes,
        );
        if (!linked) {
          res.status(409).json({
            error:
              "No primary entry found for this user — sign in first, then link Gmail.",
          });
          return;
        }

        const stored = tokenStore.get(req.userId);
        res.json({
          scopes: gmailScopesResult.scopes,
          linkedAt: stored?.gmailUpdatedAt ?? null,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Gmail authentication failed";
        res.status(401).json({ error: message });
      }
    },
  );

  /**
   * DELETE /auth/google/gmail
   * Drop the caller's Gmail link. Leaves the primary entry intact, so
   * the user keeps their Drive / Calendar access untouched. Idempotent
   * — no-op for users who never linked.
   */
  router.delete(
    "/google/gmail",
    requireAuth,
    async (req: Request, res: Response) => {
      if (tokenStore && req.userId) {
        tokenStore.clearGmail(req.userId);
      }
      res.json({ ok: true });
    },
  );

  /**
   * GET /auth/google/gmail
   * Return whether the caller has a Gmail link, plus its scopes and
   * timestamp. Lets the frontend bootstrap its gmail state when
   * localStorage is missing the field (legacy users / different device).
   */
  router.get(
    "/google/gmail",
    requireAuth,
    async (req: Request, res: Response) => {
      if (!tokenStore || !req.userId) {
        res.json({ linked: false });
        return;
      }
      const entry = tokenStore.get(req.userId);
      if (!entry?.gmailRefreshToken) {
        res.json({ linked: false });
        return;
      }
      res.json({
        linked: true,
        scopes: entry.gmailScopes ?? [],
        linkedAt: entry.gmailUpdatedAt ?? null,
      });
    },
  );

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

      const result = await fetchTokenScopes(
        oauth2Client,
        req.accessToken,
        null,
      );

      // Mirror the recorded set into the TokenStore so subsequent
      // server-side checks line up with what the client now knows.
      // Trust tokeninfo (authoritative — reflects revocations); only
      // union when we fell back. Same rationale as POST /google.
      if (tokenStore && req.userId) {
        const existing = tokenStore.get(req.userId);
        if (existing) {
          const reconciled =
            result.source === "tokeninfo"
              ? result.scopes
              : Array.from(new Set([...existing.scopes, ...result.scopes]));
          tokenStore.set(
            req.userId,
            existing.refreshToken,
            existing.email,
            reconciled,
          );
        }
      }

      res.json({ scopes: result.scopes });
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
  router.post("/refresh", authRateLimit, async (req: Request, res: Response) => {
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
