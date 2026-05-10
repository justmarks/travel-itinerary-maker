import express from "express";
import cors from "cors";
import { createTripRoutes } from "./routes/trips";
import { createSharedRoutes } from "./routes/shared";
import { createShareRuleRoutes } from "./routes/share-rules";
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
import { buildCorsOriginCheck, CorsOriginError } from "./middleware/cors-origin";
import { isInsufficientScopeError } from "./services/google-drive/drive-error";
import type { ResolveOwnerStorage } from "./services/trip-access";
import type { DbClient } from "./db/client";
import { SupabaseStorage } from "./services/supabase-storage";
import { config } from "./config/env";

export interface AppOptions {
  /**
   * Storage mode:
   * - "memory": Use a shared in-memory storage (dev/test)
   * - "drive": Use per-user Google Drive storage (production today).
   *   Users in `postgresUserIds` are routed to `SupabaseStorage`
   *   instead — this is the phase 1 dogfooding flag.
   * - "postgres": Use Supabase Postgres for every authenticated user.
   *   Future state once dogfooding is done.
   */
  mode: "memory" | "drive" | "postgres";
  /**
   * Required when mode is "memory". The shared storage instance.
   */
  storage?: StorageProvider;
  /**
   * Required when storage involves Postgres
   * (`mode: "postgres"`, or `mode: "drive"` with a non-empty
   * `postgresUserIds` set). Process-singleton DB client; the app
   * uses it to construct per-user `SupabaseStorage` instances.
   */
  dbClient?: DbClient;
  /**
   * In `mode: "drive"`, the set of user IDs to route to Postgres
   * instead of Drive. Empty / undefined means "every user stays on
   * Drive". Ignored in other modes.
   */
  postgresUserIds?: Set<string>;
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
    dbClient,
    postgresUserIds,
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
  // Security headers for every response. The web app sets a richer
  // suite via `next.config.ts`; this is the API-side baseline.
  //
  //   `Cache-Control: no-cache, no-store, must-revalidate` keeps trip
  //     data, auth tokens, and share-link responses from being held by
  //     intermediaries (CDNs, corporate proxies, browser back/forward
  //     cache).
  //   `Cross-Origin-Resource-Policy: same-origin` blocks cross-origin
  //     embedders from reading API responses, mitigating Spectre-class
  //     side-channel reads regardless of CORS.
  //   `X-Content-Type-Options: nosniff` keeps clients from MIME-sniffing
  //     a JSON response into anything else.
  //   `Referrer-Policy: no-referrer` is appropriate for an API:
  //     responses don't carry user-clickable links.
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  // `app.disable('x-powered-by')` strips the `X-Powered-By: Express`
  // server-fingerprint header from every response — small leak, cheap
  // to remove, flagged by ZAP / Mozilla Observatory.
  app.disable("x-powered-by");
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
  // Phase 2: ShareRegistry now persists to Postgres via dbClient when
  // available. Without Postgres it's in-memory only — fine for dev /
  // tests, but production needs `DATABASE_URL` set to keep share
  // tokens across restarts.
  const shareRegistry = new ShareRegistry(dbClient ?? null);
  const shareSnapshotStore = new ShareSnapshotStore(redisStore);
  // Phase 2: PushSubscriptionStore now persists to Postgres via
  // dbClient when available. Same Redis-fallback caveat as
  // ShareRegistry — production needs DATABASE_URL set.
  const pushStore = new PushSubscriptionStore(dbClient ?? null);
  const notificationSender =
    notificationSenderOverride ?? new NotificationSender(pushStore);
  const shareActivityTracker = new ShareActivityTracker();

  // Hydrate caches from Redis. No-op without persistence configured.
  await Promise.all([
    tokenStore.hydrate(),
    shareRegistry.hydrate(),
    pushStore.hydrate(),
  ]);

  // Authenticated modes are `drive` and `postgres` — both attach
  // `req.userId` via the auth middleware before route handlers run.
  // Memory mode skips auth and uses a shared singleton storage.
  const requiresAuth = mode === "drive" || mode === "postgres";

  // Validate cross-option requirements that the type system can't
  // catch on its own.
  if (mode === "postgres" && !dbClient) {
    throw new Error("AppOptions.dbClient is required when mode is 'postgres'");
  }
  if (
    mode === "drive" &&
    postgresUserIds &&
    postgresUserIds.size > 0 &&
    !dbClient
  ) {
    throw new Error(
      "AppOptions.dbClient is required when postgresUserIds is non-empty",
    );
  }
  if (mode === "memory" && !storage) {
    throw new Error("InMemoryStorage instance required for memory mode");
  }

  // Build the per-request resolver. In drive mode users in
  // `postgresUserIds` are routed to Postgres; everyone else stays on
  // Drive. Phase 1's per-user dogfooding lives in this branch.
  let resolveStorage: StorageResolver | StorageProvider;

  if (mode === "drive") {
    resolveStorage = (req) => {
      if (req.userId && postgresUserIds?.has(req.userId) && dbClient) {
        return new SupabaseStorage({ db: dbClient.db, userId: req.userId });
      }
      if (!req.accessToken) {
        throw new Error(
          "No access token on request — requireAuth middleware missing?",
        );
      }
      return new DriveStorage({ accessToken: req.accessToken });
    };
  } else if (mode === "postgres") {
    resolveStorage = (req) => {
      if (!req.userId) {
        throw new Error(
          "No userId on request — requireAuth middleware missing?",
        );
      }
      // Non-null assertion ok: the early-validation block above
      // throws when dbClient is missing in postgres mode.
      return new SupabaseStorage({ db: dbClient!.db, userId: req.userId });
    };
  } else {
    // memory mode — `storage` non-null asserted via early validation.
    resolveStorage = storage!;
  }

  // Owner-storage resolver for the contributor flow. Used by trip
  // routes to load a shared trip from the *owner's* storage on behalf
  // of a contributor. The resolver picks the same backend the owner
  // would normally use:
  //
  // - postgres mode: every owner uses SupabaseStorage scoped to their
  //   userId, regardless of the requesting contributor.
  // - drive mode: owners on the postgresUserIds list use
  //   SupabaseStorage; others use their stored Drive token via
  //   tokenStore. Returns null when the owner's auth has expired.
  // - memory mode: tests inject their own resolver. Without one, the
  //   contributor flow is a no-op and resolveTripAccess returns 404.
  const resolveOwnerStorage: ResolveOwnerStorage =
    resolveOwnerStorageOverride ??
    (mode === "postgres"
      ? async (ownerUserId: string) => {
          return new SupabaseStorage({ db: dbClient!.db, userId: ownerUserId });
        }
      : mode === "drive"
        ? async (ownerUserId: string) => {
            if (postgresUserIds?.has(ownerUserId) && dbClient) {
              return new SupabaseStorage({
                db: dbClient.db,
                userId: ownerUserId,
              });
            }
            const accessToken = await tokenStore.getAccessToken(ownerUserId);
            if (!accessToken) return null;
            return new DriveStorage({ accessToken });
          }
        : async () => null);

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", version: "0.1.0" });
  });

  // Auth routes (no auth required)
  // Pass shareRegistry so a successful login pre-warms registry entries
  // for the user's trips — recovers from server restarts without Redis.
  app.use("/api/v1/auth", createAuthRoutes({ tokenStore, shareRegistry }));

  // Trip routes — require auth in any mode that has a real notion of
  // user identity (drive, postgres). Memory mode is anonymous.
  if (requiresAuth) {
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

  // Email routes — primary auth gates everything; the Gmail-specific
  // routes (`/labels`, `/scan`) layer `requireGmailAuth` on top, fed
  // by the same TokenStore so they can mint a Gmail-client access
  // token from the user's stored refresh token. Memory-mode tests
  // skip both guards.
  if (requiresAuth) {
    app.use("/api/v1/emails", requireAuth, createEmailRoutes({
      resolveStorage,
      tokenStore,
    }));
  } else {
    app.use("/api/v1/emails", createEmailRoutes({
      resolveStorage,
    }));
  }

  // Calendar sync routes — always require auth (needs Calendar access token)
  if (requiresAuth) {
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

  // Auto-share rule routes — owner-scoped, requires auth in drive /
  // postgres modes. Memory mode skips auth.
  if (requiresAuth) {
    app.use("/api/v1/share-rules", requireAuth, createShareRuleRoutes({
      resolveStorage,
      shareRegistry,
      shareSnapshotStore,
      notificationSender,
    }));
  } else {
    app.use("/api/v1/share-rules", createShareRuleRoutes({
      resolveStorage,
      shareRegistry,
      shareSnapshotStore,
      notificationSender,
    }));
  }

  // Push subscription routes — auth-required in drive / postgres modes
  // for the subscribe/unsubscribe endpoints; the public /push/config
  // endpoint is served from the same router and handles its own no-auth
  // case.
  if (requiresAuth) {
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
  //
  // CORS origin rejections are expected client-side errors (typically
  // scanners forging the Origin header), not server failures. Respond 403
  // and skip Sentry so they don't generate alerts.
  app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof CorsOriginError) {
      res.status(403).json({ error: err.message });
      return;
    }
    // Drive 403 / "insufficientPermissions" — the user signed in but
    // unticked Drive on the consent screen, so any owner-side trip
    // operation hits this. Surface a stable code the frontend can match
    // to flip into the "Re-grant Drive" CTA. Skip Sentry: it's a
    // user-state condition, not a server bug.
    if (isInsufficientScopeError(err)) {
      res.status(403).json({
        error: "Drive access not granted",
        code: "DRIVE_SCOPE_REQUIRED",
      });
      return;
    }
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
