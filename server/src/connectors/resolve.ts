/**
 * Picks the right connector instance for an authenticated request.
 *
 * Phase 4a behaviour — preserves the legacy paths exactly:
 *   - Calendar → `GoogleCalendarConnector` bound to `req.accessToken`.
 *     Mirrors the old `req.accessToken ?? ""` pattern (missing-token
 *     case still falls through to the Google API and surfaces the
 *     same error shape as before; no early route-level 401).
 *   - Email → `GoogleEmailConnector` bound to `req.gmailAccessToken`
 *     (set by the existing `requireGmailAuth` middleware that reads
 *     the Gmail refresh token from `TokenStore` and refreshes it
 *     against the Gmail-only OAuth client).
 *
 * Phase 4b will extend each path to consult the `connections` table:
 * `provider=google, capability=email` → `GoogleEmailConnector` with
 * a refreshed Gmail token; `provider=microsoft, capability=email` →
 * `MicrosoftEmailConnector` against `/me/messages`. Same shape for
 * calendar. At that point the resolver also gains the "no connector
 * available — user hasn't linked anything" branch with a proper
 * 4xx error code; today every authed user has the legacy paths.
 */

import type { Request } from "express";
import { GoogleCalendarConnector } from "./google-calendar-connector";
import { GoogleEmailConnector } from "./google-email-connector";
import type { CalendarConnector } from "./calendar-connector";
import type { EmailConnector } from "./email-connector";

export function resolveCalendarConnector(req: Request): CalendarConnector {
  return new GoogleCalendarConnector(req.accessToken ?? "");
}

export function resolveEmailConnector(req: Request): EmailConnector {
  return new GoogleEmailConnector(req.gmailAccessToken ?? "");
}
