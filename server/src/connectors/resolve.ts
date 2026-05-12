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
import type { ConnectionsStore } from "../services/connections-store";

export interface ConnectorResolverDeps {
  /**
   * Optional — when unset, every request takes the legacy `req.accessToken`
   * path (Google-only). Phase 4b-2 production deploys configure this
   * via the same `ConnectionsStore` instance that powers the
   * `/api/v1/connections` route.
   */
  connectionsStore?: ConnectionsStore;
}

export interface ConnectorResolvers {
  resolveCalendarConnector(req: Request): Promise<CalendarConnector | null>;
  resolveEmailConnector(req: Request): Promise<EmailConnector | null>;
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
        if (ms) return new MicrosoftCalendarConnector(ms.accessToken);
        const google = await getActiveAccessToken(
          { store: deps.connectionsStore },
          req.userId,
          "google",
          "calendar",
        );
        if (google) return new GoogleCalendarConnector(google.accessToken);
        return null;
      }
      // Legacy path. Empty token still constructs a connector so dev /
      // memory-mode tests (where there's no req.accessToken) keep
      // working — same shape as before.
      return new GoogleCalendarConnector(req.accessToken ?? "");
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
        if (ms) return new MicrosoftEmailConnector(ms.accessToken);
        const google = await getActiveAccessToken(
          { store: deps.connectionsStore },
          req.userId,
          "google",
          "email",
        );
        if (google) return new GoogleEmailConnector(google.accessToken);
        return null;
      }
      return new GoogleEmailConnector(req.gmailAccessToken ?? "");
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
