/**
 * Picks the right connector instance for an authenticated request.
 *
 * Phase 4b-2 (this revision): the resolver is now a factory bound to
 * a `ConnectionsStore`. For Supabase-authed users it consults the
 * `connections` table and refreshes the access token before
 * constructing the connector. Legacy Google-authed users (still on
 * `req.accessToken` / `req.gmailAccessToken` set by middleware) keep
 * working unchanged.
 *
 * Per-request dispatch:
 *   1. If `req.authSource === "supabase"` AND a `connectionsStore`
 *      is configured → look up a matching active connection. Provider
 *      preference is **Microsoft first, then Google** — Microsoft is
 *      the newer path and most Supabase users with mail/calendar
 *      linked will be on it. When both exist, the picker logic stays
 *      this simple until Phase 4c surfaces a default-account picker.
 *   2. Otherwise → legacy path: `GoogleCalendarConnector` /
 *      `GoogleEmailConnector` bound to `req.accessToken` /
 *      `req.gmailAccessToken`. Matches the pre-Phase-4 behaviour
 *      exactly — empty token still falls through (the underlying
 *      Google API call surfaces the same error it always did).
 *
 * Returns `null` when a Supabase user has no relevant `connections`
 * row — route handlers translate this into a 401 with a stable error
 * code (`CALENDAR_NOT_CONNECTED` / `EMAIL_NOT_CONNECTED`) that the
 * frontend uses to reroute the user to /settings/account.
 */

import type { Request } from "express";
import { GoogleCalendarConnector } from "./google-calendar-connector";
import { GoogleEmailConnector } from "./google-email-connector";
import { MicrosoftCalendarConnector } from "./microsoft-calendar-connector";
import { MicrosoftEmailConnector } from "./microsoft-email-connector";
import type { CalendarConnector } from "./calendar-connector";
import type { EmailConnector } from "./email-connector";
import { getActiveAccessToken } from "../services/connections-token";
import type {
  ConnectionProvider,
  ConnectionsStore,
} from "../services/connections-store";

export interface ConnectorResolverDeps {
  /**
   * Optional — when unset, every request takes the legacy `req.accessToken`
   * path (Google-only). Phase 4b-2 production deploys configure this
   * via the same `ConnectionsStore` instance that powers the
   * `/api/v1/connections` route.
   */
  connectionsStore?: ConnectionsStore;
}

/**
 * Resolved email-connector + the metadata the route handler may need
 * to stamp on downstream records (which provider / which mailbox the
 * scan ran against, for the `processed_emails` row).
 */
export interface ResolvedEmailConnector {
  connector: EmailConnector;
  provider: ConnectionProvider;
  /** The email address of the mailbox this connector is bound to.
   *  Empty string for the legacy Gmail path when we don't have the
   *  account email plumbed yet — falls back to `req.userEmail` at
   *  the call site. */
  accountEmail: string;
}

/**
 * Resolved calendar-connector + the access token it was bound to.
 * Exposed so route handlers can run targeted diagnostics (hit
 * Google's tokeninfo endpoint on 403, etc.) without re-resolving.
 */
export interface ResolvedCalendarConnector {
  connector: CalendarConnector;
  accessToken: string;
}

export interface ConnectorResolvers {
  resolveCalendarConnector(req: Request): Promise<ResolvedCalendarConnector | null>;
  resolveEmailConnector(req: Request): Promise<ResolvedEmailConnector | null>;
}

export function createConnectorResolvers(
  deps: ConnectorResolverDeps,
): ConnectorResolvers {
  return {
    async resolveCalendarConnector(req) {
      if (
        deps.connectionsStore &&
        req.authSource === "supabase" &&
        req.userId
      ) {
        const ms = await getActiveAccessToken(
          { store: deps.connectionsStore },
          req.userId,
          "microsoft",
          "calendar",
        );
        if (ms) {
          return {
            connector: new MicrosoftCalendarConnector(ms.accessToken),
            accessToken: ms.accessToken,
          };
        }
        const google = await getActiveAccessToken(
          { store: deps.connectionsStore },
          req.userId,
          "google",
          "calendar",
        );
        if (google) {
          return {
            connector: new GoogleCalendarConnector(google.accessToken),
            accessToken: google.accessToken,
          };
        }
        return null;
      }
      // Legacy path. Empty token still constructs a connector so dev /
      // memory-mode tests (where there's no req.accessToken) keep
      // working — same shape as before.
      const accessToken = req.accessToken ?? "";
      return {
        connector: new GoogleCalendarConnector(accessToken),
        accessToken,
      };
    },

    async resolveEmailConnector(req) {
      if (
        deps.connectionsStore &&
        req.authSource === "supabase" &&
        req.userId
      ) {
        const ms = await getActiveAccessToken(
          { store: deps.connectionsStore },
          req.userId,
          "microsoft",
          "email",
        );
        if (ms) {
          return {
            connector: new MicrosoftEmailConnector(ms.accessToken),
            provider: "microsoft",
            accountEmail: ms.connection.accountEmail,
          };
        }
        const google = await getActiveAccessToken(
          { store: deps.connectionsStore },
          req.userId,
          "google",
          "email",
        );
        if (google) {
          return {
            connector: new GoogleEmailConnector(google.accessToken),
            provider: "google",
            accountEmail: google.connection.accountEmail,
          };
        }
        return null;
      }
      // Legacy Gmail path — no connections row, so we can only fill
      // provider deterministically. `accountEmail` is best-effort:
      // route handlers fall back to `req.userEmail` (the Supabase
      // JWT's email claim) when needed.
      return {
        connector: new GoogleEmailConnector(req.gmailAccessToken ?? ""),
        provider: "google",
        accountEmail: req.userEmail ?? "",
      };
    },
  };
}

// ── Backwards-compatible thin wrappers ─────────────────────────────────────
//
// Phase 4a shipped `resolveCalendarConnector(req)` / `resolveEmailConnector(req)`
// as free functions returning `Connector` (not `Connector | null`). The
// calendar + emails routes haven't been re-wired to use the factory
// yet — they get migrated alongside this commit. Keeping the old names
// available as legacy-path-only fallbacks (no connections-store
// lookup) means routes that haven't been rewired yet still compile.
//
// Tests + new code should call `createConnectorResolvers(deps)` and use
// the returned object's methods.

export function resolveCalendarConnector(req: Request): CalendarConnector {
  return new GoogleCalendarConnector(req.accessToken ?? "");
}

export function resolveEmailConnector(req: Request): EmailConnector {
  return new GoogleEmailConnector(req.gmailAccessToken ?? "");
}
