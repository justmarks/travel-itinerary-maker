import { Router, type Request, type Response } from "express";
import type { StorageProvider, StorageResolver } from "../services/storage";

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

  /**
   * POST /trips/:tripId/calendar/sync
   * Push all trip segments to Google Calendar.
   * Creates new events for un-synced segments; updates existing ones.
   * Responds with counts and persists calendarEventId on each segment.
   */
  router.post("/:tripId/calendar/sync", async (req: Request, res: Response) => {
    const storage = getStorage(req);
    const trip = await storage.getTrip(req.params.tripId as string);
    if (!trip) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }

    const calendarId = (req.query.calendarId as string | undefined) ?? "primary";

    const { syncTripToCalendar } = await import("../services/google-calendar");
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
  router.delete("/:tripId/calendar/sync", async (req: Request, res: Response) => {
    const storage = getStorage(req);
    const trip = await storage.getTrip(req.params.tripId as string);
    if (!trip) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }

    const calendarId = (req.query.calendarId as string | undefined) ?? "primary";

    const { unsyncTripFromCalendar } = await import("../services/google-calendar");
    const result = await unsyncTripFromCalendar(req.accessToken ?? "", trip, calendarId);

    // Clear calendarEventId from every segment
    for (const day of trip.days) {
      for (const segment of day.segments) {
        if (segment.calendarEventId) {
          delete segment.calendarEventId;
        }
      }
    }
    trip.updatedAt = new Date().toISOString();
    await storage.saveTrip(trip);

    res.json({ removed: result.removed, failed: result.failed });
  });

  return router;
}
