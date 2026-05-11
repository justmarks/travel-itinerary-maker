import { Router, type Request, type Response } from "express";
import type { StorageProvider, StorageResolver } from "../services/storage";
import { createCalendarSyncRateLimiter } from "../middleware/rate-limit";
import { resolveCalendarConnector } from "../connectors/resolve";

export interface CalendarRoutesOptions {
  resolveStorage: StorageResolver | StorageProvider;
}

export function createCalendarRoutes(
  options: CalendarRoutesOptions,
): Router {
  const { resolveStorage } = options;

  const getStorage: StorageResolver =
    typeof resolveStorage === "function"
      ? resolveStorage
      : () => resolveStorage;

  const router = Router();
  const syncRateLimiter = createCalendarSyncRateLimiter();

  /**
   * GET /trips/calendar/list
   * Return the authenticated user's writable calendars from whichever
   * provider their session resolves to (Google today; Microsoft once
   * Phase 4b adds the `MicrosoftCalendarConnector`).
   */
  router.get("/calendar/list", async (req: Request, res: Response) => {
    const connector = resolveCalendarConnector(req);
    const calendars = await connector.listCalendars();
    res.json(calendars);
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
    const connector = resolveCalendarConnector(req);
    const result = await connector.syncTrip(trip, calendarId, req.userEmail);

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
    const connector = resolveCalendarConnector(req);
    const result = await connector.syncSegment(
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
      const connector = resolveCalendarConnector(req);
      const result = await connector.unsyncTrip(trip, calendarId, req.userEmail);
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
