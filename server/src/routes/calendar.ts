import { Router, type Request, type Response } from "express";
import {
  generateId,
  type Segment,
  type Trip,
  type TripUserCalendarSync,
} from "@itinly/shared";
import type { StorageProvider, StorageResolver } from "../services/storage";
import { createCalendarSyncRateLimiter } from "../middleware/rate-limit";
import {
  createConnectorResolvers,
  type ConnectorResolvers,
} from "../connectors/resolve";
import type { ConnectionProvider } from "../services/connections-store";
import { isCalendarDebugEnabled } from "../utils/debug-log";
import {
  resolveTripAccess,
  type AccessDenied,
  type AccessResult,
  type ResolveOwnerStorage,
} from "../services/trip-access";
import type { ShareRegistry } from "../services/share-registry";

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

/**
 * Memory-mode (test / dev) userId used when no auth middleware has
 * set `req.userId`. The whole memory store is single-user by
 * construction, so a stable constant is enough to scope per-user
 * sync rows without forcing every test to set a header.
 */
const MEMORY_MODE_USER_ID = "memory-anon";

export interface CalendarRoutesOptions {
  resolveStorage: StorageResolver | StorageProvider;
  /**
   * Share registry + owner-storage factory — used by `accessTrip` to
   * resolve trips a recipient has been shared on. Optional so memory
   * mode + tests can omit them; routes still work for owner-only
   * access in that case.
   */
  shareRegistry?: ShareRegistry;
  resolveOwnerStorage?: ResolveOwnerStorage;
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
  const { resolveStorage, shareRegistry, resolveOwnerStorage } = options;
  const resolvers =
    options.connectorResolvers ?? createConnectorResolvers({});

  const getStorage: StorageResolver =
    typeof resolveStorage === "function"
      ? resolveStorage
      : () => resolveStorage;

  /** Trip access helper bound to this router's storage + share-registry. */
  async function accessTrip(
    req: Request,
    tripId: string,
  ): Promise<AccessResult> {
    return resolveTripAccess({
      req,
      tripId,
      // Calendar sync now permits owners AND shared-edit recipients
      // (each user pushes to their OWN calendar; their sync state is
      // a separate row keyed by user_id, so they don't clobber each
      // other). View-only recipients can't sync.
      requiredPermission: "edit",
      getStorage,
      shareRegistry,
      resolveOwnerStorage,
    });
  }

  function denyAccess(res: Response, denied: AccessDenied): void {
    const message =
      denied.reason === "shared-view-only"
        ? "View-only share — calendar sync not permitted"
        : denied.reason === "owner-auth-expired"
          ? "Trip owner needs to re-authenticate"
          : "Trip not found";
    res.status(denied.status).json({ error: message, reason: denied.reason });
  }

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
   * Overlay the requester's sync state (their per-user event map +
   * calendarId) onto a fresh copy of the trip so the existing sync
   * code paths see the requester's event ids instead of the owner's.
   * `syncTripToCalendar` reads `segment.calendarEventId` to know
   * whether to update vs. create; for a shared-edit recipient we
   * want it to use THEIR map, not whatever the owner had.
   */
  function applyUserSyncToTrip(
    trip: Trip,
    sync: TripUserCalendarSync | null,
  ): Trip {
    const clone = structuredClone(trip);
    if (!sync) {
      // No row for this user yet — they're syncing for the first
      // time. Strip any owner-side event ids so the sync code
      // doesn't try to update events that aren't on the requester's
      // calendar.
      for (const day of clone.days) {
        for (const seg of day.segments) {
          delete seg.calendarEventId;
        }
      }
      delete clone.calendarId;
      return clone;
    }
    for (const day of clone.days) {
      for (const seg of day.segments) {
        const eventId = sync.segmentEventMap[seg.id];
        if (eventId) seg.calendarEventId = eventId;
        else delete seg.calendarEventId;
      }
    }
    clone.calendarId = sync.calendarId;
    return clone;
  }

  /**
   * Builds the next sync-state row from the prior row (or null) plus
   * the result of the sync call. `id` + `createdAt` are preserved
   * when a row already exists so the same record updates in place;
   * `updatedAt` always advances.
   */
  function buildNextSyncState(
    prior: TripUserCalendarSync | null,
    tripId: string,
    userId: string,
    calendarId: string,
    eventMap: Record<string, string>,
  ): TripUserCalendarSync {
    const now = new Date().toISOString();
    return {
      id: prior?.id ?? generateId(),
      tripId,
      userId,
      calendarId,
      segmentEventMap: eventMap,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
    };
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
      console.log(
        `${tag} provider=${resolved.provider} returned ${calendars.length} calendar(s)`,
      );
      res.json(calendars);
    } catch (err) {
      const status = (err as { status?: number; code?: number }).status ??
        (err as { code?: number }).code ?? 500;
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `${tag} provider=${resolved.provider} listCalendars failed status=${status}: ${message}`,
      );
      if (
        status === 403 &&
        message.toLowerCase().includes("scope") &&
        isCalendarDebugEnabled()
      ) {
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
   * GET /trips/:tripId/calendar/sync
   * Return the requester's per-user sync state for this trip, or null
   * when they haven't synced this trip yet. Replaces the old
   * "calendarId on the trip row + calendarEventId on each segment"
   * read path with a dedicated, per-user surface.
   */
  router.get("/:tripId/calendar/sync", async (req: Request, res: Response) => {
    const tripId = req.params.tripId as string;
    const access = await accessTrip(req, tripId);
    if (!access.ok) return denyAccess(res, access);

    const userId = req.userId ?? MEMORY_MODE_USER_ID;
    const userStorage = getStorage(req);
    const state = await userStorage.getTripUserCalendarSync(tripId, userId);
    res.json(state ?? null);
  });

  /**
   * POST /trips/:tripId/calendar/sync
   * Push all trip segments to the **requesting user's** calendar.
   * Per-user sync state lives in `trip_user_calendar_syncs` —
   * owners and shared-edit recipients each have their own row, so
   * pushing the same trip to two different Google accounts no
   * longer clobbers either party's event ids.
   */
  router.post("/:tripId/calendar/sync", syncRateLimiter, async (req: Request, res: Response) => {
    const tripId = req.params.tripId as string;
    const access = await accessTrip(req, tripId);
    if (!access.ok) return denyAccess(res, access);
    const trip = access.trip;

    // The requester needs their own storage to read / write the
    // per-user sync state. `accessTrip` returns the trip from the
    // OWNER's storage (so trip rows resolve correctly for shared
    // recipients); the per-user sync state is independent and lives
    // under the requester's userId, so we use their storage here.
    const userId = req.userId ?? MEMORY_MODE_USER_ID;
    const userStorage = getStorage(req);
    const priorSync = await userStorage.getTripUserCalendarSync(tripId, userId);

    const calendarId =
      (req.query.calendarId as string | undefined) ??
      priorSync?.calendarId ??
      "primary";

    const { resolveTripTimezones } = await import("../utils/timezone-lookup");
    await resolveTripTimezones(trip);
    const resolved = await resolvers.resolveCalendarConnector(req, parseProviderQuery(req));
    if (!resolved) {
      notConnected(res);
      return;
    }
    const tripForSync = applyUserSyncToTrip(trip, priorSync);
    const result = await resolved.connector.syncTrip(
      tripForSync,
      calendarId,
      req.userEmail,
    );

    await userStorage.saveTripUserCalendarSync(
      buildNextSyncState(
        priorSync,
        tripId,
        userId,
        result.calendarId,
        result.eventMap,
      ),
    );

    res.json({
      created: result.created,
      updated: result.updated,
      failed: result.failed,
      calendarId: result.calendarId,
    });
  });

  /**
   * POST /trips/:tripId/segments/:segId/calendar/sync
   * Sync a single segment to the requester's calendar (create or
   * update one event). Reuses any calendarId the user has already
   * picked for this trip, so the dropdown choice doesn't have to be
   * re-confirmed for every segment edit auto-sync.
   */
  router.post("/:tripId/segments/:segId/calendar/sync", async (req: Request, res: Response) => {
    const tripId = req.params.tripId as string;
    const access = await accessTrip(req, tripId);
    if (!access.ok) return denyAccess(res, access);
    const trip = access.trip;

    const userId = req.userId ?? MEMORY_MODE_USER_ID;

    const segId = req.params.segId as string;
    let targetDay: import("@itinly/shared").TripDay | undefined;
    let targetSegment: Segment | undefined;
    for (const day of trip.days) {
      const seg = day.segments.find((s) => s.id === segId);
      if (seg) { targetDay = day; targetSegment = seg; break; }
    }
    if (!targetDay || !targetSegment) {
      res.status(404).json({ error: "Segment not found" });
      return;
    }

    const userStorage = getStorage(req);
    const priorSync = await userStorage.getTripUserCalendarSync(tripId, userId);

    const calendarId =
      (req.query.calendarId as string | undefined) ??
      priorSync?.calendarId ??
      "primary";

    // Overlay the user's existing event id (if any) onto a clone of
    // the segment so the connector's "update or create" branch picks
    // the right path.
    const segmentForSync: Segment = {
      ...targetSegment,
      calendarEventId: priorSync?.segmentEventMap[segId],
    };

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
      segmentForSync,
      calendarId,
      req.userEmail,
    );

    if (result.eventId) {
      const nextMap = { ...(priorSync?.segmentEventMap ?? {}) };
      nextMap[segId] = result.eventId;
      await userStorage.saveTripUserCalendarSync(
        buildNextSyncState(priorSync, tripId, userId, calendarId, nextMap),
      );
    }

    res.json(result);
  });

  /**
   * DELETE /trips/:tripId/calendar/sync
   * Remove the requester's previously-synced calendar events for
   * this trip and clear their sync-state row. Only affects the
   * requester — other users' sync state for the same trip is
   * untouched.
   */
  router.delete("/:tripId/calendar/sync", syncRateLimiter, async (req: Request, res: Response) => {
    const tripId = req.params.tripId as string;
    const access = await accessTrip(req, tripId);
    if (!access.ok) return denyAccess(res, access);
    const trip = access.trip;

    const userId = req.userId ?? MEMORY_MODE_USER_ID;

    const userStorage = getStorage(req);
    const priorSync = await userStorage.getTripUserCalendarSync(tripId, userId);

    // No sync row for this user — nothing to do. Return zeroes so the
    // frontend's optimistic UI doesn't get a 404.
    if (!priorSync) {
      res.json({ removed: 0, failed: 0 });
      return;
    }

    const calendarId =
      (req.query.calendarId as string | undefined) ?? priorSync.calendarId;
    // deleteEvents=false → just drop the local sync row without
    // touching the remote calendar. Useful when the provider link is
    // broken and the user just wants to forget the sync locally.
    const deleteEvents = req.query.deleteEvents !== "false";

    let removed = 0;
    let failed = 0;
    if (deleteEvents) {
      const resolved = await resolvers.resolveCalendarConnector(req, parseProviderQuery(req));
      if (!resolved) {
        notConnected(res);
        return;
      }
      const tripForUnsync = applyUserSyncToTrip(trip, priorSync);
      const result = await resolved.connector.unsyncTrip(
        tripForUnsync,
        calendarId,
        req.userEmail,
      );
      removed = result.removed;
      failed = result.failed;
    }

    await userStorage.deleteTripUserCalendarSync(tripId, userId);
    res.json({ removed, failed });
  });

  return router;
}
