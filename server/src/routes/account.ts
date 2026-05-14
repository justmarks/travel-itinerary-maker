/**
 * Routes for the signed-in user's own account. Today this is just the
 * hard-delete endpoint — everything else (linked providers, capability
 * rows) lives under `/api/v1/connections`.
 *
 *   DELETE /api/v1/account
 *
 * Wipes every Postgres row owned by the caller (trips with their
 * cascaded segments / todos / history / shares, share rules, processed
 * emails, user settings, push subscriptions, connections), revokes the
 * user's refresh tokens at Google + Microsoft on a best-effort basis,
 * and (when `SUPABASE_SERVICE_ROLE_KEY` is set) deletes the Supabase
 * Auth row so a fresh sign-in starts a brand-new account.
 *
 * Irreversible. Returns 204 on success — including when individual
 * upstream-revoke calls fail, because the local row deletions already
 * make the account unusable and re-running the endpoint doesn't fix
 * a failed remote revoke (the local refresh tokens are gone).
 *
 * Auth gate: the Supabase Auth row is only deleted when
 * `req.authSource === "supabase"`. Legacy Google-token users (where
 * `req.userId` is a Google `sub`, not a Supabase UUID) just have
 * their Postgres rows + tokens dropped — there's no Auth row to
 * remove.
 */

import { Router, type Request, type Response } from "express";
import { reportError } from "../services/monitoring";
import type { StorageResolver, StorageProvider } from "../services/storage";
import type {
  ConnectionsStore,
  Connection,
} from "../services/connections-store";
import { getActiveAccessToken } from "../services/connections-token";
import type { PushSubscriptionStore } from "../services/push-subscription-store";
import type { SupabaseAdmin } from "../services/supabase-admin";

export interface AccountRoutesOptions {
  resolveStorage: StorageResolver | StorageProvider;
  /**
   * Connection store + push store + Supabase admin client are all
   * optional so memory-mode dev / tests can call the route without
   * provisioning Postgres or a service-role key. When any is missing
   * the route just skips that cleanup step.
   */
  connectionsStore?: ConnectionsStore;
  pushStore?: PushSubscriptionStore;
  supabaseAdmin?: SupabaseAdmin | null;
}

export function createAccountRoutes(
  options: AccountRoutesOptions,
): Router {
  const { resolveStorage, connectionsStore, pushStore, supabaseAdmin } =
    options;
  const getStorage: StorageResolver =
    typeof resolveStorage === "function"
      ? resolveStorage
      : () => resolveStorage;

  const router = Router();

  router.delete("/", async (req: Request, res: Response) => {
    if (!req.userId) {
      // Memory-mode (anonymous) callers land here. Allow the request
      // through anyway — the storage call still wipes the singleton
      // in-memory store, which matches the test expectation.
      // Production routes mount this behind `requireAuth` so this
      // branch only fires in memory mode.
      await getStorage(req).deleteAllForUser("anonymous");
      res.status(204).send();
      return;
    }

    const userId = req.userId;

    // Step 1: revoke at the upstream provider FIRST, while the
    // refresh tokens are still resolvable from `connections`. After
    // the rows are gone we can't ask Google / Microsoft to revoke
    // anymore. Each call is best-effort — logged on failure, never
    // throws — because the local cleanup below makes the account
    // unusable regardless.
    if (connectionsStore) {
      const active = await connectionsStore.listForUser(userId);
      await Promise.allSettled(
        active.map((c) => revokeUpstream(c, connectionsStore, userId)),
      );
    }

    // Step 2: drop every Postgres row owned by `userId`. Storage
    // owns trips + cascades + share rules + processed emails + user
    // settings. Connections + push subs live outside StorageProvider
    // so they get explicit wipes too.
    try {
      await getStorage(req).deleteAllForUser(userId);
    } catch (err) {
      // A wiped account that left rows behind is the worst possible
      // partial state — surface it loud.
      reportError(err instanceof Error ? err : new Error(String(err)), {
        path: "/api/v1/account",
        method: "DELETE",
        userId,
        op: "storage.deleteAllForUser",
      });
      res.status(500).json({ error: "Failed to delete account data" });
      return;
    }

    if (pushStore) {
      try {
        await pushStore.deleteAllForUser(userId);
      } catch (err) {
        reportError(err instanceof Error ? err : new Error(String(err)), {
          path: "/api/v1/account",
          method: "DELETE",
          userId,
          op: "pushStore.deleteAllForUser",
        });
      }
    }

    if (connectionsStore) {
      try {
        await connectionsStore.hardDeleteForUser(userId);
      } catch (err) {
        reportError(err instanceof Error ? err : new Error(String(err)), {
          path: "/api/v1/account",
          method: "DELETE",
          userId,
          op: "connectionsStore.hardDeleteForUser",
        });
      }
    }

    // Step 3: delete the Supabase Auth row so a fresh sign-in starts
    // a new account. Only fire for Supabase-authed users — legacy
    // Google-token sessions have `req.userId === <google-sub>`, not
    // a Supabase UUID, and the admin endpoint would 404. When
    // `supabaseAdmin` is null (env var unset) we skip silently and
    // leave the Auth row for manual cleanup.
    if (supabaseAdmin && req.authSource === "supabase") {
      try {
        const result = await supabaseAdmin.deleteUser(userId);
        if (!result.ok) {
          console.warn(
            `[account-delete] supabase admin deleteUser returned ${result.status}` +
              (result.body ? ` body=${result.body.slice(0, 200)}` : ""),
          );
        }
      } catch (err) {
        // Don't fail the request — local cleanup is already done.
        // Log so an operator can drop the orphan Auth row manually.
        console.warn(
          "[account-delete] supabase admin deleteUser threw:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    res.status(204).send();
  });

  return router;
}

/**
 * Best-effort upstream revoke. Returns nothing — failures log and
 * swallow so the account-delete path stays on track.
 */
async function revokeUpstream(
  connection: Connection,
  store: ConnectionsStore,
  userId: string,
): Promise<void> {
  try {
    if (connection.provider === "google") {
      // Revoke either the refresh token (preferred) or the access
      // token. Google's revoke endpoint accepts both; revoking the
      // refresh token cascades to every access token minted from it.
      const token = connection.refreshToken ?? connection.accessToken;
      if (!token) return;
      const url = `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      if (!res.ok) {
        console.warn(
          `[account-delete] google revoke ${res.status} for ${connection.provider}/${connection.capability}`,
        );
      }
    } else if (connection.provider === "microsoft") {
      // Microsoft Graph has no documented refresh-token revoke; the
      // closest thing is `/me/revokeSignInSessions`, which forces a
      // re-auth on every Microsoft client signed in as that user. It
      // needs a valid access token to call. Resolve one (refreshes
      // if cached is expired) — if that returns null, the row was
      // already broken and there's nothing to revoke against.
      const resolved = await getActiveAccessToken(
        { store },
        userId,
        connection.provider,
        connection.capability,
      );
      if (!resolved) return;
      const res = await fetch(
        "https://graph.microsoft.com/v1.0/me/revokeSignInSessions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resolved.accessToken}`,
            "Content-Type": "application/json",
          },
        },
      );
      if (!res.ok) {
        console.warn(
          `[account-delete] microsoft revokeSignInSessions ${res.status} for ${connection.capability}`,
        );
      }
    }
  } catch (err) {
    console.warn(
      `[account-delete] upstream revoke threw for ${connection.provider}/${connection.capability}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
