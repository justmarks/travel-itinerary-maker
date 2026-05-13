/**
 * Routes for managing the per-user OAuth connections introduced in
 * phase 3. The frontend calls these after a Supabase Auth sign-in
 * (or when the user clicks "Connect Gmail" / "Connect Outlook" in
 * settings) to persist the resulting provider tokens.
 *
 *   GET    /api/v1/connections        — list this user's active connections
 *   POST   /api/v1/connections        — upsert a connection (tokens go in encrypted)
 *   DELETE /api/v1/connections/:id    — soft-delete (status='revoked')
 *
 * `requireAuth` runs upstream. Responses never include the encrypted
 * token columns — they only matter server-side (Phase 4 connectors).
 *
 * Auth source: writes require `req.authSource === 'supabase'`. Legacy
 * Google-token users keep using `TokenStore` for their refresh token
 * until phase 5 migrates them.
 */

import { Router, type Request, type Response } from "express";
import { generateId } from "@travel-app/shared";
import type {
  ConnectionsStore,
  Connection,
  ConnectionProvider,
  ConnectionCapability,
} from "../services/connections-store";

export interface ConnectionsRoutesOptions {
  store: ConnectionsStore;
}

const PROVIDERS: readonly ConnectionProvider[] = ["google", "microsoft"];
const CAPABILITIES: readonly ConnectionCapability[] = [
  "identity",
  "email",
  "calendar",
];

/**
 * `ya29.<base64>` is the unmistakable shape of a Google OAuth access
 * token. We saw this leak into a `microsoft+calendar` row in
 * production (the auth-callback page's link-flow path skips
 * `exchangeCodeForSession` to avoid swapping the session, then
 * reads `session.provider_token` which still carries the previous
 * OAuth round's Google token). Letting it through stores a Google
 * token under a Microsoft row; the first calendar-list call ends
 * up sending `ya29.…` to Graph and Graph rejects it with
 * `IDX14120: JWT is not well formed, there is only one dot (.)`.
 *
 * Detection is intentionally narrow — only the `ya29.` prefix —
 * because the inverse (a Microsoft token landing in a Google row)
 * is also possible but Microsoft's JWT shape collides with anyone
 * else's JWT, so we can't reliably reject from format alone.
 * Google tokens are uniquely fingerprinted, so we catch the most
 * common cross-provider leak.
 */
function isGoogleAccessToken(token: string): boolean {
  return token.startsWith("ya29.");
}

/**
 * Google refresh tokens are `1//<long base64>` (one slash-slash near
 * the start; no dots). Same defensive rationale as
 * `isGoogleAccessToken` — uniquely fingerprinted, so a Google
 * refresh-token slot leak into a Microsoft row is easy to catch
 * and reject. Microsoft refresh tokens (`0.AA…`/`M.…`) overlap with
 * other formats too much to detect the reverse confidently.
 */
function isGoogleRefreshToken(token: string): boolean {
  return token.startsWith("1//");
}

interface PublicConnection {
  id: string;
  provider: ConnectionProvider;
  capability: ConnectionCapability;
  accountEmail: string;
  scopes: string[];
  status: Connection["status"];
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Strip sensitive fields before returning to the client. Refresh and
 * access tokens never leave the server — they're for backend-side
 * use (Phase 4 connector packages) only.
 */
function publicView(c: Connection): PublicConnection {
  return {
    id: c.id,
    provider: c.provider,
    capability: c.capability,
    accountEmail: c.accountEmail,
    scopes: c.scopes,
    status: c.status,
    expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function createConnectionsRoutes(
  options: ConnectionsRoutesOptions,
): Router {
  const { store } = options;
  const router = Router();

  router.get("/", async (req: Request, res: Response) => {
    if (!req.userId) {
      // Defensive — `requireAuth` upstream should always set this.
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const list = await store.listForUser(req.userId);
    res.json({ connections: list.map(publicView) });
  });

  router.post("/", async (req: Request, res: Response) => {
    if (!req.userId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    // Only Supabase-authed users have connections rows — legacy users
    // keep their tokens in TokenStore (Redis) until phase 5. Refusing
    // here avoids cross-pollination during the coexistence window.
    if (req.authSource !== "supabase") {
      res.status(400).json({
        error:
          "Connections can only be created by Supabase-authenticated " +
          "requests. Legacy Google sessions use TokenStore.",
        code: "LEGACY_AUTH_PATH",
      });
      return;
    }

    const body = (req.body ?? {}) as {
      provider?: unknown;
      capability?: unknown;
      accountEmail?: unknown;
      refreshToken?: unknown;
      accessToken?: unknown;
      expiresAt?: unknown;
      scopes?: unknown;
    };

    const provider = body.provider;
    const capability = body.capability;
    const accountEmail = body.accountEmail;

    if (typeof provider !== "string" || !PROVIDERS.includes(provider as ConnectionProvider)) {
      res.status(400).json({
        error: `provider must be one of: ${PROVIDERS.join(", ")}`,
      });
      return;
    }
    if (
      typeof capability !== "string" ||
      !CAPABILITIES.includes(capability as ConnectionCapability)
    ) {
      res.status(400).json({
        error: `capability must be one of: ${CAPABILITIES.join(", ")}`,
      });
      return;
    }
    if (typeof accountEmail !== "string" || !accountEmail.includes("@")) {
      res.status(400).json({ error: "accountEmail must be a valid email" });
      return;
    }

    let refreshToken =
      typeof body.refreshToken === "string" ? body.refreshToken : undefined;
    let accessToken =
      typeof body.accessToken === "string" ? body.accessToken : undefined;

    // Cross-provider token leak guard. When the Microsoft row gets a
    // Google `ya29.*` token (the production failure mode we caught
    // via the `[ms-graph] 401 ... prefix=ya29 dots=1` diagnostic),
    // dropping it here is strictly better than storing it: the row
    // stays as a "provider is linked" record without poisoning the
    // cache. Next time `getActiveAccessToken` resolves this row it
    // falls back to the identity-row refresh token (Microsoft) and
    // mints a real Graph token from it. If that fallback also has
    // no token, the resolver returns null → frontend prompts a
    // reconnect, which (via flow="signin" now that the identity is
    // already linked) does a real `exchangeCodeForSession` and
    // captures the right tokens.
    if (provider === "microsoft" && accessToken && isGoogleAccessToken(accessToken)) {
      console.warn(
        `[connections] dropping access_token write — caller sent a Google-shaped token (ya29.*) for provider=microsoft (capability=${capability}, user=${req.userId}). Likely the auth-callback link flow leaked the previous OAuth round's token.`,
      );
      accessToken = undefined;
    }
    if (provider === "microsoft" && refreshToken && isGoogleRefreshToken(refreshToken)) {
      console.warn(
        `[connections] dropping refresh_token write — caller sent a Google-shaped refresh token (1//*) for provider=microsoft (capability=${capability}, user=${req.userId}).`,
      );
      refreshToken = undefined;
    }

    let expiresAt: Date | undefined;
    if (typeof body.expiresAt === "string") {
      const parsed = new Date(body.expiresAt);
      if (Number.isNaN(parsed.getTime())) {
        res.status(400).json({ error: "expiresAt must be a valid ISO date" });
        return;
      }
      expiresAt = parsed;
    } else if (accessToken) {
      // The auth-callback page only forwards `accessToken` and
      // `refreshToken` from the Supabase session — it has no access
      // to the provider's `expires_in`, so without a default the
      // row's `expiresAt` stays null. `getActiveAccessToken` then
      // treats the cached access token as expired-on-arrival and
      // tries to refresh on the first call, which fails when the
      // refresh_token was issued by Supabase's OAuth client (not
      // ours). Defaulting to 55 minutes from now gives the
      // resolver a cache window that matches Google's standard
      // 1-hour access-token lifetime (5-minute safety margin).
      expiresAt = new Date(Date.now() + 55 * 60 * 1000);
    }

    let scopes: string[] | undefined;
    if (Array.isArray(body.scopes)) {
      if (!body.scopes.every((s): s is string => typeof s === "string")) {
        res.status(400).json({ error: "scopes must be an array of strings" });
        return;
      }
      scopes = body.scopes;
    }

    const connection = await store.upsert({
      id: generateId(),
      userId: req.userId,
      provider: provider as ConnectionProvider,
      capability: capability as ConnectionCapability,
      accountEmail,
      refreshToken,
      accessToken,
      expiresAt,
      scopes,
    });
    // Tell apart "Connect button POST landed, row got the expected
    // scopes" from "POST failed silently / wrote a stale row" when
    // debugging calendar-sync issues. We log scope STRINGS (not
    // tokens) and presence flags — no PII / secrets leak.
    console.log(
      `[connections] upsert user=${req.userEmail} provider=${provider} capability=${capability} ` +
        `accountEmail=${accountEmail} hasAccessToken=${!!accessToken} hasRefreshToken=${!!refreshToken} ` +
        `scopes=[${(scopes ?? []).join(", ")}]`,
    );

    res.status(201).json({ connection: publicView(connection) });
  });

  router.delete("/:id", async (req: Request, res: Response) => {
    if (!req.userId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const id = req.params.id as string;
    const ok = await store.markRevoked(id, req.userId);
    if (!ok) {
      res.status(404).json({ error: "Connection not found" });
      return;
    }
    // 204 No Content — matches the pattern of other delete routes
    // in this codebase (see DELETE /trips/:id).
    res.status(204).send();
  });

  return router;
}
