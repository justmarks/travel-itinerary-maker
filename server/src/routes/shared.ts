import { Router, type Request, type Response } from "express";
import type { StorageProvider, StorageResolver } from "../services/storage";
import type { ShareRegistry } from "../services/share-registry";
import type { TokenStore } from "../services/token-store";
import { DriveStorage } from "../services/google-drive/drive-storage";
import { createShareLinkRateLimiter } from "../middleware/rate-limit";

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
  // Single instance so the in-memory counter is shared across requests.
  const shareLinkRateLimit = createShareLinkRateLimiter();

  router.get("/:token", shareLinkRateLimit, async (req: Request, res: Response) => {
    const token = req.params.token as string;
    // Short prefix-only marker for the log lines so we can correlate
    // events without leaking full share tokens to logs.
    const tokenLabel = `${token.slice(0, 6)}…`;

    // Try to resolve storage for the trip owner via share registry
    let storage: StorageProvider;
    let registryHit = false;

    if (shareRegistry && tokenStore) {
      const entry = shareRegistry.lookup(token);
      if (entry) {
        registryHit = true;
        // Get a fresh access token for the trip owner
        const accessToken = await tokenStore.getAccessToken(entry.ownerUserId);
        if (accessToken) {
          storage = new DriveStorage({ accessToken });
        } else {
          // Owner's refresh token expired/missing. In drive mode the
          // request has no auth (this is the public /shared route), so
          // `getStorage(req)` would throw. Surface a clean 503 instead
          // of letting it hit the global 500 handler.
          console.warn(
            `[shared/${tokenLabel}] registry entry found but tokenStore returned no access token for owner ${entry.ownerUserId}`,
          );
          res.status(503).json({
            error: "Shared trip unavailable",
            reason: "owner-auth-expired",
          });
          return;
        }
      } else {
        // Phase 2: ShareRegistry is durable (Postgres `trip_shares`),
        // so a registry miss here means the token genuinely doesn't
        // exist — we no longer rescan every owner's Drive in hopes of
        // rebuilding state. Fall through to the request-level storage
        // for the dev-mode in-memory path; in production drive mode
        // this returns 404 because the public route has no auth.
        try {
          storage = getStorage(req);
        } catch (err) {
          console.warn(
            `[shared/${tokenLabel}] registry miss, request storage unavailable:`,
            err instanceof Error ? err.message : err,
          );
          res.status(404).json({
            error: "Shared trip not found",
            reason: "registry-miss",
          });
          return;
        }
      }
    } else {
      // Development mode — use the shared in-memory storage
      try {
        storage = getStorage(req);
      } catch (err) {
        console.warn(
          `[shared/${tokenLabel}] dev-mode storage resolve failed:`,
          err instanceof Error ? err.message : err,
        );
        res.status(404).json({
          error: "Shared trip not found",
          reason: "no-storage",
        });
        return;
      }
    }

    let trips;
    try {
      trips = await storage.listTrips();
    } catch (err) {
      console.warn(
        `[shared/${tokenLabel}] storage.listTrips() failed:`,
        err instanceof Error ? err.message : err,
      );
      res.status(404).json({
        error: "Shared trip not found",
        reason: "storage-error",
      });
      return;
    }

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
      console.warn(
        `[shared/${tokenLabel}] no trip in storage carries this token (registryHit=${registryHit}, trips scanned=${trips.length})`,
      );
      res.status(404).json({
        error: "Shared trip not found",
        reason: registryHit ? "trip-missing" : "registry-miss",
      });
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
