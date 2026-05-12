/**
 * Given a `(userId, provider, capability)`, returns a usable access
 * token — refreshing against the provider if the cached one has
 * expired (or is missing). Persists the refreshed tokens back to
 * the `connections` row so subsequent calls can hit the cache.
 *
 * Returns `null` when no connection exists for that combination, or
 * when the refresh fails permanently (user revoked at provider,
 * refresh token aged out). The connector resolver translates `null`
 * into the "not connected — link in /settings/account" UX.
 *
 * Phase 4b-2 of the migration: the bridge between the
 * `connections` table (Phase 3 storage) and the per-provider
 * connector classes (Phase 4a foundation + 4b-1 implementations).
 */

import { generateId } from "@travel-app/shared";
import {
  refreshGoogleToken,
  refreshMicrosoftToken,
  OAuthRefreshError,
} from "./oauth-refresh";
import type {
  Connection,
  ConnectionCapability,
  ConnectionProvider,
  ConnectionsStore,
} from "./connections-store";

/**
 * How close to the access-token expiry we'll preemptively refresh.
 * 60 seconds covers clock skew + the time between checking the cache
 * and actually using the token on an upstream HTTP call — a token
 * that says "valid for 5 more seconds" will likely 401 by the time
 * Gmail / Graph receives it.
 */
const REFRESH_LEEWAY_MS = 60 * 1000;

export interface ConnectionsTokenResolverDeps {
  store: ConnectionsStore;
}

export interface ResolvedConnection {
  connection: Connection;
  accessToken: string;
}

/**
 * Resolves the most recent active access token for a user's
 * provider+capability link. Refreshes against the provider when
 * cached token is missing or near expiry. Persists rotated tokens
 * back to the store.
 *
 * Behaviour:
 *   - No matching connection → `null` (caller surfaces "not linked").
 *   - Cached access token still valid (with 60s leeway) → returns it.
 *   - Cached expired AND refresh token present → refresh + persist
 *     + return.
 *   - Cached expired AND no refresh token → null (user must re-link).
 *   - Refresh fails → null (caller surfaces "reconnect required";
 *     log the error). We intentionally don't propagate the underlying
 *     `OAuthRefreshError` here — connector consumers shouldn't need
 *     to know which provider failed.
 */
export async function getActiveAccessToken(
  deps: ConnectionsTokenResolverDeps,
  userId: string,
  provider: ConnectionProvider,
  capability: ConnectionCapability,
): Promise<ResolvedConnection | null> {
  const { store } = deps;
  // Find the most recently-updated active connection for this
  // (user, provider, capability). For multi-account users (e.g.
  // gmail-personal + gmail-work) Phase 4c will surface a picker;
  // today we deterministically pick the most recent.
  const candidates = (await store.listForUser(userId)).filter(
    (c) =>
      c.provider === provider &&
      c.capability === capability &&
      c.status === "active",
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const connection = candidates[0];

  const now = Date.now();
  const cached = connection.accessToken;
  const cachedExpiresAt = connection.expiresAt?.getTime() ?? 0;
  if (cached && cachedExpiresAt > now + REFRESH_LEEWAY_MS) {
    return { connection, accessToken: cached };
  }

  if (!connection.refreshToken) {
    console.warn(
      `[connections-token] ${provider}/${capability} for user ${userId} has no refresh token; needs re-link`,
    );
    return null;
  }

  let refreshed;
  try {
    refreshed =
      provider === "google"
        ? await refreshGoogleToken(
            connection.refreshToken,
            capability === "email" ? "gmail" : "primary",
          )
        : await refreshMicrosoftToken(connection.refreshToken, connection.scopes);
  } catch (err) {
    const code =
      err instanceof OAuthRefreshError ? err.code : "unknown";
    console.warn(
      `[connections-token] refresh failed for ${provider}/${capability} user=${userId}: ${code}`,
    );
    return null;
  }

  // Persist the refreshed access token + expiry. Refresh token may
  // rotate (Microsoft frequently does); keep whichever value the
  // provider returned, falling back to the existing one when the
  // response didn't include a new refresh token.
  const updated = await store.upsert({
    id: connection.id ?? generateId(),
    userId: connection.userId,
    provider: connection.provider,
    capability: connection.capability,
    accountEmail: connection.accountEmail,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? connection.refreshToken,
    expiresAt: refreshed.expiresAt,
    scopes: connection.scopes,
  });

  return { connection: updated, accessToken: refreshed.accessToken };
}
