import { Router, type Request, type Response } from "express";
import type { StorageProvider } from "../services/storage";

/**
 * Public routes for accessing shared trips (no auth required).
 */
export function createSharedRoutes(storage: StorageProvider): Router {
  const router = Router();

  router.get("/:token", async (req: Request, res: Response) => {
    const trips = await storage.listTrips();

    let foundTrip = null;
    let foundShare = null;

    for (const trip of trips) {
      const share = trip.shares.find(
        (s) => s.shareToken === (req.params.token as string),
      );
      if (share) {
        foundTrip = trip;
        foundShare = share;
        break;
      }
    }

    if (!foundTrip || !foundShare) {
      res.status(404).json({ error: "Shared trip not found" });
      return;
    }

    // Check expiration
    if (
      foundShare.expiresAt &&
      new Date(foundShare.expiresAt) < new Date()
    ) {
      res.status(410).json({ error: "Share link has expired" });
      return;
    }

    // Filter out costs and todos based on share settings
    const result = {
      id: foundTrip.id,
      title: foundTrip.title,
      startDate: foundTrip.startDate,
      endDate: foundTrip.endDate,
      status: foundTrip.status,
      days: foundTrip.days.map((day) => ({
        ...day,
        segments: day.segments.map((seg) => ({
          ...seg,
          cost: foundShare!.showCosts ? seg.cost : undefined,
        })),
      })),
      todos: foundShare.showTodos ? foundTrip.todos : [],
      permission: foundShare.permission,
    };

    res.json(result);
  });

  return router;
}
