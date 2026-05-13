import { Router, type Request, type Response } from "express";
import type { StorageProvider, StorageResolver } from "../services/storage";
import { createCalendarSyncRateLimiter } from "../middleware/rate-limit";
import {
  createConnectorResolvers,
  type ConnectorResolvers,
} from "../connectors/resolve";
import type { ConnectionProvider } from "../services/connections-store";

/**
 * Parses an optional `?provider=google|microsoft` query param. Used
 * by every calendar route to let the UI override the resolver's
 * auto-pick when the user has both providers connected. Unknown /
 * missing values resolve to undefined, which preserves the default
 * Microsoft-first auto-pick.
 */
function parseProviderQuery(req: Request): ConnectionProvider | undefined {
  const raw = req.query.provider;
  if (raw === "google" || raw === "microsoft") return raw;
  return undefined;
}

/**
 * Diagnostic hook fired only when Google returns 403 "insufficient
 * scopes" on the calendar-list call. Hits Google's tokeninfo
 * endpoint with the access token the resolver just handed us and
 * logs the ACTUAL scopes baked into it.
 *
 * Lets us tell apart:
 *  - "user never granted Calendar" (token has only identity scopes
 *    — Supabase's signInWithOAuth `scopes` param didn't take effect)
 *  - "user granted Calendar but we're using a stale token" (token
 *    has identity scopes despite user re-consenting recently)
 *
 * Best-effort — any failure here is logged and swallowed so the
 * diagnostic itself doesn't mask the original 403.
 */
async function diagnoseScopes(
  req: Request,
  accessToken: string,
): Promise<void> {
  const tag = `[calendar-list ${req.userEmail ?? "?"}]`;
  if (!accessToken) {
    console.warn(`${tag} tokeninfo diagnostic: empty access token`);
    return;
  }
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`,
  );
  if (!res.ok) {
    console.warn(`${tag} tokeninfo returned ${res.status}`);
    return;
  }
  const info = (await res.json()) as { scope?: string; expires_in?: string };
  console.warn(
    `${tag} stored access token scopes="${info.scope ?? "(none)"}" expires_in=${info.expires_in ?? "?"}`,
  );
}

export interface CalendarRoutesOptions {
  resolveStorage: StorageResolver | StorageProvider;
  /**
   * Phase 4b-2: pre-built connector resolvers bound to the
   * ConnectionsStore. When omitted (tests, memory mode), falls back
   * to a default factory with no store — every request takes the
   * legacy Google path via `req.accessToken`.
   */
  connectorResolvers?: ConnectorResolvers;
}

export function createCalendarRoutes(
  options: CalendarRoutesOptions,
): Router {
  const { resolveStorage } = options;
  const resolvers =
    options.connectorResolvers ?? createConnectorResolvers({});

  const getStorage: StorageResolver =
    typeof resolveStorage === "function"
      ? resolveStorage
      : () => resolveStorage;

  const router = Router();
  const syncRateLimiter = createCalendarSyncRateLimiter();

  /**
   * Sends the stable `CALENDAR_NOT_CONNECTED` shape when a Supabase
   * user hits a calendar route without a linked calendar
   * connection. The frontend branches on `code` to reroute to
   * /settings/account.
   */
  function notConnected(res: Response): void {
    res.status(401).json({
      error: "Calendar not connected",
      code: "CALENDAR_NOT_CONNECTED",
    });
  }

  /**
   * GET /trips/calendar/list
   * Return the authenticated user's writable calendars from whichever
   * provider their session resolves to (Google today; Microsoft once
   * Phase 4b adds the `MicrosoftCalendarConnector`).
   *
   * Failures (Graph 401, Google scope revoked mid-session, network
   * blip) come back as a structured `CALENDAR_LIST_FAILED` 502 with
   * the provider's message instead of an unhandled 500. The frontend
   * surfaces this inline so the user sees "Outlook rejected the
   * request: …" rather than the misleading "No writable calendars
   * found."
   */
  router.get("/calendar/list", async (req: Request, res: Response) => {
    const preferProvider = parseProviderQuery(req);
    const tag = `[calendar-list ${req.userEmail ?? "?"}]`;
    const resolved = await resolvers.resolveCalendarConnector(req, preferProvider);
    if (!resolved) {
      console.warn(
        `${tag} no calendar connector resolved (preferProvider=${preferProvider ?? "(auto)"})`,
      );
      notConnected(res);
      return;
    }
    try {
      const calendars = await resolved.connector.listCalendars();
      // Useful when the dialog shows "No writable calendars" — lets
      // us tell "auth worked but list was empty" apart from "auth
      // failed" in Railway logs. Provider tag makes it clear which
      // backend actually answered (matters when the user has both
      // Outlook and Gmail connected and is debugging a mismatch).
      console.log(
        `${tag} provider=${resolved.provider} returned ${calendars.length} calendar(s)`,
      );
      res.json(calendars);
    } catch (err) {
      // Surface the underlying error code (status + message) so we
      // can diagnose 401/403/scope failures instead of guessing from
      // an empty list at the UI.
      const status = (err as { status?: number; code?: number }).status ??
        (err as { code?: number }).code ?? 500;
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `${tag} provider=${resolved.provider} listCalendars failed status=${status}: ${message}`,
      );
      // On insufficient-scopes 403 (Google's "Request had insufficient
      // authentication scopes"), hit Google's tokeninfo endpoint with
      // the stored access token directly — earlier attempts tried to
      // pull it from `err.config.headers.Authorization` but the
      // GaxiosError shape varies and the extraction missed.
      if (status === 403 && message.toLowerCase().includes("scope")) {
        await diagnoseScopes(req, resolved.accessToken).catch((e) => {
          console.warn(
            `${tag} tokeninfo diagnostic failed: ${
              e instanceof Error ? e.message : "unknown"
            }`,
          );
        });
      }
      res.status(500).json({
        error: message,
        code: status === 401 || status === 403 ? "CALENDAR_AUTH_FAILED" : "CALENDAR_LIST_FAILED",
      });
    }
  });

  /**
   * POST /trips/:tripId/calendar/sync
   * Push all trip segments to the user's calendar.
   * Creates new events for un-synced segments; updates existing ones.
   * Responds with counts and persists calendarEventId on each segment.
   */
  router.post("/:tripId/calendar/sync", syncRateLimiter, async (req: Request, res: Response) => {
    const storage = getStorage(req);
    const trip = await storage.getTrip(req.params.tripId as string);
    if (!trip) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }

    const calendarId = (req.query.calendarId as string | undefined) ?? "primary";

    const { resolveTripTimezones } = await import("../utils/timezone-lookup");
    await resolveTripTimezones(trip);
    const resolved = await resolvers.resolveCalendarConnector(req, parseProviderQuery(req));
    if (!resolved) {
      notConnected(res);
      return;
    }
    const result = await resolved.connector.syncTrip(trip, calendarId, req.userEmail);

    // Persist the returned event IDs back onto each segment
    for (const day of trip.days) {
      for (const segment of day.segments) {
        const eventId = result.eventMap[segment.id];
        if (eventId) {
          segment.calendarEventId = eventId;
        }
      }
    }
    trip.calendarId = result.calendarId;
    trip.updatedAt = new Date().toISOString();
    await storage.saveTrip(trip);

    res.json({
      created: result.created,
      updated: result.updated,
      failed: result.failed,
      calendarId: result.calendarId,
    });
  });

  /**
   * POST /trips/:tripId/segments/:segId/calendar/sync
   * Sync a single segment (create or update one event).
   * Used by auto-sync after segment create/edit so only the changed
   * event is touched rather than re-syncing the entire trip.
   */
  router.post("/:tripId/segments/:segId/calendar/sync", async (req: Request, res: Response) => {
    const storage = getStorage(req);
    const trip = await storage.getTrip(req.params.tripId as string);
    if (!trip) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }

    const segId = req.params.segId as string;
    let targetDay: import("@travel-app/shared").TripDay | undefined;
    let targetSegment: import("@travel-app/shared").Segment | undefined;
    for (const day of trip.days) {
      const seg = day.segments.find((s) => s.id === segId);
      if (seg) { targetDay = day; targetSegment = seg; break; }
    }
    if (!targetDay || !targetSegment) {
      res.status(404).json({ error: "Segment not found" });
      return;
    }

    const calendarId = (req.query.calendarId as string | undefined) ?? trip.calendarId ?? "primary";

    const { resolveTripTimezones } = await import("../utils/timezone-lookup");
    await resolveTripTimezones(trip);
    const resolved = await resolvers.resolveCalendarConnector(req, parseProviderQuery(req));
    if (!resolved) {
      notConnected(res);
      return;
    }
    const result = await resolved.connector.syncSegment(
      trip,
      targetDay,
      targetSegment,
      calendarId,
      req.userEmail,
    );

    if (result.eventId && result.eventId !== targetSegment.calendarEventId) {
      targetSegment.calendarEventId = result.eventId;
      trip.updatedAt = new Date().toISOString();
      await storage.saveTrip(trip);
    }

    res.json(result);
  });

  /**
   * DELETE /trips/:tripId/calendar/sync
   * Remove all previously synced calendar events for this trip
   * and clear calendarEventId from every segment.
   */
  router.delete("/:tripId/calendar/sync", syncRateLimiter, async (req: Request, res: Response) => {
    const storage = getStorage(req);
    const trip = await storage.getTrip(req.params.tripId as string);
    if (!trip) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }

    // Use the calendarId stored on the trip when no override is given
    const calendarId = (req.query.calendarId as string | undefined) ?? trip.calendarId ?? "primary";
    // deleteEvents=false → clear sync tracking without touching the
    // remote calendar. Lets a user untie a trip locally even if their
    // provider link is broken.
    const deleteEvents = req.query.deleteEvents !== "false";

    let removed = 0;
    let failed = 0;
    if (deleteEvents) {
      const resolved = await resolvers.resolveCalendarConnector(req, parseProviderQuery(req));
      if (!resolved) {
        notConnected(res);
        return;
      }
      const result = await resolved.connector.unsyncTrip(trip, calendarId, req.userEmail);
      removed = result.removed;
      failed = result.failed;
    }

    // Clear calendarEventId from every segment and the stored calendarId
    for (const day of trip.days) {
      for (const segment of day.segments) {
        if (segment.calendarEventId) {
          delete segment.calendarEventId;
        }
      }
    }
    delete trip.calendarId;
    trip.updatedAt = new Date().toISOString();
    await storage.saveTrip(trip);

    res.json({ removed, failed });
  });

  return router;
}
