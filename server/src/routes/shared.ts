import { Router, type Request, type Response } from "express";
import type { StorageProvider, StorageResolver } from "../services/storage";
import type { ShareRegistry } from "../services/share-registry";
import type { ResolveOwnerStorage } from "../services/trip-access";
import { createShareLinkRateLimiter } from "../middleware/rate-limit";

export interface SharedRoutesOptions {
  resolveStorage: StorageResolver | StorageProvider;
  shareRegistry?: ShareRegistry;
  /**
   * Builds a `StorageProvider` scoped to a given owner-userId. Used
   * to load a shared trip from the owner's Postgres rows on behalf of
   * an unauthenticated /shared/:token request — the registry hands us
   * the ownerUserId for the token; this resolver constructs the
   * matching SupabaseStorage. Returns null when the owner is unknown
   * (memory mode: the test suite injects its own resolver; otherwise
   * the fallback `async () => null` from `app.ts` means we route to
   * the request-level storage).
   */
  resolveOwnerStorage?: ResolveOwnerStorage;
}

/**
 * Public routes for accessing shared trips (no auth required).
 */
export function createSharedRoutes(options: SharedRoutesOptions): Router {
  const { resolveStorage, shareRegistry, resolveOwnerStorage } = options;

  // Support both a resolver function and a direct storage instance.
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

    let storage: StorageProvider;
    let registryHit = false;

    if (shareRegistry) {
      const entry = shareRegistry.lookup(token);
      if (entry) {
        registryHit = true;
        const ownerStorage = resolveOwnerStorage
          ? await resolveOwnerStorage(entry.ownerUserId)
          : null;
        if (ownerStorage) {
          storage = ownerStorage;
        } else {
          // No owner storage available — likely memory-mode dev /
          // tests where the resolver returns null and the in-memory
          // storage holds every trip regardless of owner. Fall
          // through to the request-level storage so dev mode
          // continues to work.
          try {
            storage = getStorage(req);
          } catch (err) {
            console.warn(
              `[shared/${tokenLabel}] registry hit for owner=${entry.ownerUserId} but ownerStorage unavailable:`,
              err instanceof Error ? err.message : err,
            );
            res.status(503).json({
              error: "Shared trip unavailable",
              reason: "owner-storage-unavailable",
            });
            return;
          }
        }
      } else {
        // ShareRegistry is durable (Postgres `trip_shares` in the
        // production path), so a registry miss means the token
        // doesn't exist. Fall through to the request-level storage
        // for the dev-mode in-memory path; in production this is
        // effectively a 404.
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
      // Development mode — use the shared in-memory storage.
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
