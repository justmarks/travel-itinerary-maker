import { Router, type Request, type Response } from "express";
import type { StorageProvider, StorageResolver } from "../services/storage";
import { createCalendarSyncRateLimiter } from "../middleware/rate-limit";

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
   * Return the authenticated user's writable Google Calendars.
   */
  router.get("/calendar/list", async (req: Request, res: Response) => {
    const { listUserCalendars } = await import("../services/google-calendar");
    const calendars = await listUserCalendars(req.accessToken ?? "");
    res.json(calendars);
  });

  /**
   * POST /trips/:tripId/calendar/sync
   * Push all trip segments to Google Calendar.
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

    const [{ syncTripToCalendar }, { resolveTripTimezones }] = await Promise.all([
      import("../services/google-calendar"),
      import("../utils/timezone-lookup"),
    ]);
    await resolveTripTimezones(trip);
    const result = await syncTripToCalendar(req.accessToken ?? "", trip, calendarId);

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
    // deleteEvents=false → clear sync tracking without touching Google Calendar
    const deleteEvents = req.query.deleteEvents !== "false";

    let removed = 0;
    let failed = 0;
    if (deleteEvents) {
      const { unsyncTripFromCalendar } = await import("../services/google-calendar");
      const result = await unsyncTripFromCalendar(req.accessToken ?? "", trip, calendarId);
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
