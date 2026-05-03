import express from "express";
import cors from "cors";
import { createTripRoutes } from "./routes/trips";
import { createSharedRoutes } from "./routes/shared";
import { createAuthRoutes } from "./routes/auth";
import { createEmailRoutes } from "./routes/emails";
import { createCalendarRoutes } from "./routes/calendar";
import { requireAuth } from "./middleware/auth";
import type { StorageProvider, StorageResolver } from "./services/storage";
import { DriveStorage } from "./services/google-drive/drive-storage";
import { TokenStore } from "./services/token-store";
import { ShareRegistry } from "./services/share-registry";
import { ShareSnapshotStore } from "./services/share-snapshot-store";
import { PushSubscriptionStore } from "./services/push-subscription-store";
import { NotificationSender } from "./services/notification-sender";
import { ShareActivityTracker } from "./services/share-activity-tracker";
import { createPushRoutes } from "./routes/push";
import { createRedisStore, type RedisStore } from "./services/redis-store";
import { loadEncryptionKey } from "./services/token-crypto";
import { reportError } from "./services/monitoring";
import { buildCorsOriginCheck } from "./middleware/cors-origin";
import type { ResolveOwnerStorage } from "./services/trip-access";
import { config } from "./config/env";

export interface AppOptions {
  /**
   * Storage mode:
   * - "memory": Use a shared in-memory storage (dev/test)
   * - "drive": Use per-user Google Drive storage (production)
   */
  mode: "memory" | "drive";
  /**
   * Required when mode is "memory". The shared storage instance.
   */
  storage?: StorageProvider;
  /**
   * Test override: skip Redis even if env vars are set. Lets tests run
   * deterministically without a live Redis instance.
   */
  disableRedis?: boolean;
  /**
   * Test override: inject a fake RedisStore (e.g. for asserting that
   * write-through paths called the expected hash methods). Takes
   * precedence over both `disableRedis` and the env-driven Upstash
   * client constructed by `createRedisStore()`.
   */
  redisStore?: RedisStore | null;
  /**
   * Test override: provide a custom owner-storage resolver for the
   * contributor flow. In production this is built from `tokenStore` +
   * `DriveStorage`; tests inject a userId → InMemoryStorage map to
   * exercise cross-user share access without touching real Drive.
   */
  resolveOwnerStorage?: ResolveOwnerStorage;
  /**
   * Test override: replace the auto-built NotificationSender so tests
   * can assert that share creation fires the expected push without
   * needing real VAPID keys or a real push provider.
   */
  notificationSender?: NotificationSender;
}

/**
 * Async because TokenStore + ShareRegistry hydrate from Redis on boot
 * when persistence is configured. Hydration is fire-and-forget-safe
 * (failures fall back to in-memory), but awaiting here lets the entry
 * point start the listener with a warm cache so the very first
 * post-restart request doesn't miss.
 */
export async function createApp(options: AppOptions): Promise<express.Express> {
  const app = express();
  const {
    mode,
    storage,
    disableRedis,
    redisStore: redisStoreOverride,
    resolveOwnerStorage: resolveOwnerStorageOverride,
    notificationSender: notificationSenderOverride,
  } = options;

  // CORS allowlist combines a comma-separated literal list (CORS_ORIGIN)
  // with an optional regex pattern (CORS_ORIGIN_PATTERN) so Vercel
  // per-deploy preview URLs work without re-listing every hash.
  const allowedOrigins = config.corsOrigin
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowedOriginPattern = config.corsOriginPattern
    ? new RegExp(config.corsOriginPattern)
    : null;
  app.use(
    cors({
      origin: buildCorsOriginCheck(allowedOrigins, allowedOriginPattern),
    }),
  );
  // Raised from the 100kb default so users can paste/upload full .eml or
  // .html email sources (which commonly run 100-500kb with embedded styles
  // and base64 images).
  app.use(express.json({ limit: "10mb" }));

  // Root — friendly landing for browser visits
  app.get("/", (_req, res) => {
    res.json({
      name: "itinly API",
      version: "0.1.0",
      health: "/health",
      docs: "/api/v1",
    });
  });

  // Shared services. When UPSTASH_REDIS_REST_URL/_TOKEN are set the
  // stores write through to Redis and survive process restarts; without
  // those env vars they're plain in-memory (legacy behaviour).
  // Tests can pass `redisStore` directly to inject a fake; otherwise
  // `disableRedis` skips persistence entirely, and the default path
  // builds a real Upstash client from env.
  const redisStore =
    redisStoreOverride !== undefined
      ? redisStoreOverride
      : disableRedis
        ? null
        : createRedisStore();
  // Encrypt refresh tokens at rest when TOKEN_ENCRYPTION_KEY is set.
  // Unset key = plaintext storage (legacy behaviour, fine for dev/test).
  const encryptionKey = loadEncryptionKey();
  const tokenStore = new TokenStore(redisStore, encryptionKey);
  const shareRegistry = new ShareRegistry(redisStore);
  const shareSnapshotStore = new ShareSnapshotStore(redisStore);
  const pushStore = new PushSubscriptionStore(redisStore);
  const notificationSender =
    notificationSenderOverride ?? new NotificationSender(pushStore);
  const shareActivityTracker = new ShareActivityTracker();

  // Hydrate caches from Redis. No-op without persistence configured.
  await Promise.all([
    tokenStore.hydrate(),
    shareRegistry.hydrate(),
    pushStore.hydrate(),
  ]);

  // Build the storage resolver based on mode
  let resolveStorage: StorageResolver | StorageProvider;

  if (mode === "drive") {
    // Production: create per-request DriveStorage from authenticated user's token
    resolveStorage = (req) => {
      if (!req.accessToken) {
        throw new Error("No access token on request — requireAuth middleware missing?");
      }
      return new DriveStorage({ accessToken: req.accessToken });
    };
  } else {
    // Development/test: use shared in-memory storage
    if (!storage) {
      throw new Error("InMemoryStorage instance required for memory mode");
    }
    resolveStorage = storage;
  }

  // Owner-storage resolver for the contributor flow. Used by trip routes
  // to load a shared trip from the *owner's* Drive on behalf of a
  // contributor. In drive mode we wire it through tokenStore + Drive;
  // in memory mode tests can supply their own resolver to simulate
  // cross-user access. Returns null when the owner's auth has expired.
  const resolveOwnerStorage: ResolveOwnerStorage =
    resolveOwnerStorageOverride ??
    (mode === "drive"
      ? async (ownerUserId: string) => {
          const accessToken = await tokenStore.getAccessToken(ownerUserId);
          if (!accessToken) return null;
          return new DriveStorage({ accessToken });
        }
      : async () => {
          // Memory mode without an explicit override: contributor flow is
          // a no-op. The shared path in resolveTripAccess simply returns
          // 404, matching the existing behaviour where memory-mode dev
          // trips all live in one storage anyway.
          return null;
        });

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", version: "0.1.0" });
  });

  // Auth routes (no auth required)
  // Pass shareRegistry so a successful login pre-warms registry entries
  // for the user's trips — recovers from server restarts without Redis.
  app.use("/api/v1/auth", createAuthRoutes({ tokenStore, shareRegistry }));

  // Trip routes — require auth in drive mode
  if (mode === "drive") {
    app.use("/api/v1/trips", requireAuth, createTripRoutes({
      resolveStorage,
      shareRegistry,
      shareSnapshotStore,
      resolveOwnerStorage,
      notificationSender,
      shareActivityTracker,
    }));
  } else {
    app.use("/api/v1/trips", createTripRoutes({
      resolveStorage,
      shareRegistry,
      shareSnapshotStore,
      resolveOwnerStorage,
      notificationSender,
      shareActivityTracker,
    }));
  }

  // Email routes — always require auth (needs Gmail access token)
  if (mode === "drive") {
    app.use("/api/v1/emails", requireAuth, createEmailRoutes({
      resolveStorage,
    }));
  } else {
    app.use("/api/v1/emails", createEmailRoutes({
      resolveStorage,
    }));
  }

  // Calendar sync routes — always require auth (needs Calendar access token)
  if (mode === "drive") {
    app.use("/api/v1/trips", requireAuth, createCalendarRoutes({ resolveStorage }));
  } else {
    app.use("/api/v1/trips", createCalendarRoutes({ resolveStorage }));
  }

  // Public shared routes (no auth required)
  app.use("/api/v1/shared", createSharedRoutes({
    resolveStorage,
    shareRegistry,
    tokenStore,
  }));

  // Push subscription routes — auth-required in drive mode for the
  // subscribe/unsubscribe endpoints; the public /push/config endpoint
  // is served from the same router and handles its own no-auth case.
  if (mode === "drive") {
    app.use("/api/v1/push", requireAuth, createPushRoutes({ store: pushStore }));
  } else {
    app.use("/api/v1/push", createPushRoutes({ store: pushStore }));
  }

  // 404 handler — catch any unmatched routes
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Error handler — catch any unhandled errors from route handlers. Logs
  // locally and forwards to Sentry (no-op when monitoring is disabled).
  app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    reportError(err, {
      path: req.path,
      method: req.method,
      userId: req.userId,
    });
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
