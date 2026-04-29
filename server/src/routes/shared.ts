import { Router, type Request, type Response } from "express";
import type { StorageProvider, StorageResolver } from "../services/storage";
import type { ShareRegistry } from "../services/share-registry";
import type { TokenStore } from "../services/token-store";
import { DriveStorage } from "../services/google-drive/drive-storage";
import { rebuildRegistryForUser } from "../services/registry-rebuild";

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
        // Recovery scan: the in-memory registry is empty (most commonly
        // because the server restarted), but the tokenStore may still
        // know about owners we can scan. Walk every known user, rebuild
        // their registry entries, then retry the lookup.
        console.warn(
          `[shared/${tokenLabel}] registry miss — scanning ${tokenStore.listUserIds().length} known user(s) to rebuild`,
        );
        let recoveredEntry;
        for (const userId of tokenStore.listUserIds()) {
          await rebuildRegistryForUser(userId, shareRegistry, tokenStore);
          const found = shareRegistry.lookup(token);
          if (found) {
            recoveredEntry = found;
            console.log(
              `[shared/${tokenLabel}] recovered token from user ${userId}`,
            );
            break;
          }
        }

        if (recoveredEntry) {
          // Treat the recovered entry just like a normal hit: fetch the
          // owner's storage and continue.
          registryHit = true;
          const accessToken = await tokenStore.getAccessToken(
            recoveredEntry.ownerUserId,
          );
          if (!accessToken) {
            console.warn(
              `[shared/${tokenLabel}] recovered entry has no usable owner access token`,
            );
            res.status(503).json({
              error: "Shared trip unavailable",
              reason: "owner-auth-expired",
            });
            return;
          }
          storage = new DriveStorage({ accessToken });
        } else {
          // Recovery scan didn't find the token across the known users.
          // Last-resort fallback: try the request-level storage. In dev
          // mode that's a shared in-memory store that holds all trips
          // (and exercises the test path where the registry isn't
          // populated by createShare). In drive mode this throws because
          // the public /shared route has no auth, so we return 404.
          try {
            storage = getStorage(req);
          } catch (err) {
            console.warn(
              `[shared/${tokenLabel}] recovery scan exhausted, request storage unavailable:`,
              err instanceof Error ? err.message : err,
            );
            res.status(404).json({
              error: "Shared trip not found",
              reason: "registry-miss",
            });
            return;
          }
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
