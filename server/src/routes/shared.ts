import { Router, type Request, type Response } from "express";
import type { StorageProvider, StorageResolver } from "../services/storage";
import type { ShareRegistry } from "../services/share-registry";
import type { TokenStore } from "../services/token-store";
import { DriveStorage } from "../services/google-drive/drive-storage";

export interface SharedRoutesOptions {
  resolveStorage: StorageResolver | StorageProvider;
  shareRegistry?: ShareRegistry;
  tokenStore?: TokenStore;
}

/**
 * Public routes for accessing shared trips (no auth required).
 */
export function createSharedRoutes(options: SharedRoutesOptions): Router {
  const { resolveStorage, shareRegistry, tokenStore } = options;

  // Support both a resolver function and a direct storage instance
  const getStorage: StorageResolver =
    typeof resolveStorage === "function"
      ? resolveStorage
      : () => resolveStorage;

  const router = Router();

  router.get("/:token", async (req: Request, res: Response) => {
    const token = req.params.token as string;

    // Try to resolve storage for the trip owner via share registry
    let storage: StorageProvider;

    if (shareRegistry && tokenStore) {
      const entry = shareRegistry.lookup(token);
      if (entry) {
        // Get a fresh access token for the trip owner
        const accessToken = await tokenStore.getAccessToken(entry.ownerUserId);
        if (accessToken) {
          storage = new DriveStorage({ accessToken });
        } else {
          // Owner's refresh token expired or missing — fall back
          storage = getStorage(req);
        }
      } else {
        // Share token not in registry — fall back to request-level storage
        storage = getStorage(req);
      }
    } else {
      // Development mode — use the shared in-memory storage
      storage = getStorage(req);
    }

    const trips = await storage.listTrips();

    let foundTrip = null;
    let foundShare = null;

    for (const trip of trips) {
      const share = trip.shares.find((s) => s.shareToken === token);
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
