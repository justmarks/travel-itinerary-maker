import express from "express";
import cors from "cors";
import { createTripRoutes } from "./routes/trips";
import { createSharedRoutes } from "./routes/shared";
import { createShareRuleRoutes } from "./routes/share-rules";
import { createAuthRoutes } from "./routes/auth";
import { createEmailRoutes } from "./routes/emails";
import { createCalendarRoutes } from "./routes/calendar";
import { configureAuth, requireAuth } from "./middleware/auth";
import { createSupabaseAuth } from "./services/supabase-auth";
import type { StorageProvider, StorageResolver } from "./services/storage";
import { TokenStore } from "./services/token-store";
import { ShareRegistry } from "./services/share-registry";
import { ShareSnapshotStore } from "./services/share-snapshot-store";
import { PushSubscriptionStore } from "./services/push-subscription-store";
import { NotificationSender } from "./services/notification-sender";
import { ShareActivityTracker } from "./services/share-activity-tracker";
import { createPushRoutes } from "./routes/push";
import { createConnectionsRoutes } from "./routes/connections";
import { createAccountRoutes } from "./routes/account";
import { ConnectionsStore } from "./services/connections-store";
import {
  createSupabaseAdmin,
  type SupabaseAdmin,
} from "./services/supabase-admin";
import { createConnectorResolvers } from "./connectors/resolve";
import { createRedisStore, type RedisStore } from "./services/redis-store";
import { loadEncryptionKey } from "./services/token-crypto";
import { reportError } from "./services/monitoring";
import { buildCorsOriginCheck, CorsOriginError } from "./middleware/cors-origin";
import type { ResolveOwnerStorage } from "./services/trip-access";
import type { DbClient } from "./db/client";
import { SupabaseStorage } from "./services/supabase-storage";
import { config } from "./config/env";

export interface AppOptions {
  /**
   * Storage mode:
   * - "memory": Use a shared in-memory storage (dev/test).
   * - "postgres": Use Supabase Postgres for every authenticated user
   *   (production).
   */
  mode: "memory" | "postgres";
  /**
   * Required when mode is "memory". The shared storage instance.
   */
  storage?: StorageProvider;
  /**
   * Required when mode is "postgres". Process-singleton DB client; the
   * app uses it to construct per-user `SupabaseStorage` instances.
   */
  dbClient?: DbClient;
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
   * contributor flow. In production this resolves to a per-owner
   * `SupabaseStorage`; tests inject a userId → InMemoryStorage map to
   * exercise cross-user share access without touching real Postgres.
   */
  resolveOwnerStorage?: ResolveOwnerStorage;
  /**
   * Test override: replace the auto-built NotificationSender so tests
   * can assert that share creation fires the expected push without
   * needing real VAPID keys or a real push provider.
   */
  notificationSender?: NotificationSender;
  /**
   * Test override for the Supabase Auth admin client used by the
   * account-deletion endpoint. Pass `null` to force the route to skip
   * the Auth-row cleanup step; pass a stub to assert it's called.
   * When unset, the app builds a real client from env when
   * `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are both set.
   */
  supabaseAdmin?: SupabaseAdmin | null;
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
  // Behind a reverse proxy (Railway, Fly, Cloud Run, …) the socket peer
  // is always the proxy, not the user. Without trust-proxy, `req.ip`
  // collapses every request onto one bucket so the auth / share-link /
  // calendar rate limiters effectively rate-limit the proxy instead of
  // the user, and one misbehaving client locks everyone out. Number of
  // hops comes from env so a future deployment with a different topology
  // can adjust without code changes; see `config.trustProxyHops`.
  app.set("trust proxy", config.trustProxyHops);
  const {
    mode,
    storage,
    dbClient,
    disableRedis,
    redisStore: redisStoreOverride,
    resolveOwnerStorage: resolveOwnerStorageOverride,
    notificationSender: notificationSenderOverride,
    supabaseAdmin: supabaseAdminOverride,
  } = options;

  // Real Supabase admin client (talks to GoTrue `/auth/v1/admin`)
  // built from env, or null when the service-role key is unset.
  // Tests pass `null` or a stub via `supabaseAdmin`.
  const supabaseAdmin: SupabaseAdmin | null =
    supabaseAdminOverride !== undefined
      ? supabaseAdminOverride
      : createSupabaseAdmin({
          supabaseUrl: config.supabase.url,
          serviceRoleKey: config.supabase.serviceRoleKey,
        });

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
    // HSTS — instructs the browser to refuse plain-HTTP requests to
    // this origin for the next year. The reverse proxy in front of
    // us probably also sets this, but a "probably" isn't a security
    // posture: the PaaS layer is configured separately from the app,
    // and a misconfigured proxy + missing header here would silently
    // allow a one-hop downgrade attack against the API itself
    // (cookies don't apply — the API is Bearer-auth — but an
    // attacker on the path could MITM the OAuth code exchange and
    // mint themselves a session). max-age=63072000 (2 years) is the
    // preload-list recommendation; `includeSubDomains` covers any
    // future API sub-host we add.
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains",
    );
    next();
  });
  // `app.disable('x-powered-by')` strips the `X-Powered-By: Express`
  // server-fingerprint header from every response — small leak, cheap
  // to remove, flagged by ZAP / Mozilla Observatory.
  app.disable("x-powered-by");
  // Body-parser limits. Routes split into two buckets:
  //
  //   `/api/v1/auth/*` — tiny payloads (OAuth code + redirect URI is
  //     <2kb, refresh-token POST is <1kb). Cap at 64kb so an attacker
  //     spending their 30-per-15-min auth quota can't also bomb 10mb
  //     bodies through the JSON parser (300mb / 15min / IP otherwise).
  //     The narrow limit bounds the body-bombing path even if the
  //     rate-limit numbers get tuned looser later.
  //
  //   everything else — raised from the 100kb default to 10mb so
  //     users can paste/upload full .eml or .html email sources
  //     (commonly 100-500kb with embedded styles and base64 images)
  //     and base64-encoded XLSX workbooks.
  //
  // Run the auth parser as a mounted middleware BEFORE the global
  // one so it claims the body first; body-parser short-circuits on
  // its `_body` marker, so the global one becomes a no-op for paths
  // the tight parser already handled.
  app.use("/api/v1/auth", express.json({ limit: "64kb" }));
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

  // Phase 3: wire Supabase Auth as a secondary acceptance path on
  // `requireAuth`. Configured iff SUPABASE_URL is set — otherwise
  // `requireAuth` validates Google tokens only (the legacy path).
  // Module-level state on `auth.ts` so existing call sites
  // (`app.use(..., requireAuth, ...)`) don't need a factory rewrite.
  if (config.supabase.url) {
    configureAuth({
      supabaseValidator: createSupabaseAuth({
        supabaseUrl: config.supabase.url,
      }),
    });
  } else {
    configureAuth({ supabaseValidator: undefined });
  }

  // `postgres` mode attaches `req.userId` via the auth middleware
  // before route handlers run. Memory mode skips auth and uses a
  // shared singleton storage.
  const requiresAuth = mode === "postgres";

  // Validate cross-option requirements that the type system can't
  // catch on its own.
  if (mode === "postgres" && !dbClient) {
    throw new Error("AppOptions.dbClient is required when mode is 'postgres'");
  }
  if (mode === "memory" && !storage) {
    throw new Error("InMemoryStorage instance required for memory mode");
  }

  // Per-request storage resolver. Postgres mode constructs a fresh
  // `SupabaseStorage` per request scoped to the authenticated user;
  // memory mode shares one instance across the process for dev/test.
  let resolveStorage: StorageResolver | StorageProvider;

  if (mode === "postgres") {
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
  // of a contributor.
  //
  // - postgres mode: every owner uses SupabaseStorage scoped to their
  //   userId, regardless of the requesting contributor.
  // - memory mode: tests inject their own resolver. Without one, the
  //   contributor flow is a no-op and resolveTripAccess returns 404.
  const resolveOwnerStorage: ResolveOwnerStorage =
    resolveOwnerStorageOverride ??
    (mode === "postgres"
      ? async (ownerUserId: string) => {
          return new SupabaseStorage({ db: dbClient!.db, userId: ownerUserId });
        }
      : async () => null);

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", version: "0.1.0" });
  });

  // Phase 4b-2: build the connector resolvers once. The store-backed
  // path is only available when Postgres is wired up (dbClient
  // exists) — without that, the resolvers fall back to the legacy
  // `req.accessToken` / `req.gmailAccessToken` paths so memory-mode
  // dev/tests continue to work identically to before. Phase 4c also
  // threads `connectionsStore` into the auth routes so the Gmail-link
  // handler can write directly to `connections` for Supabase users.
  const connectionsStore =
    dbClient && requiresAuth
      ? new ConnectionsStore(dbClient, encryptionKey)
      : undefined;
  const connectorResolvers = createConnectorResolvers({ connectionsStore });

  // Auth routes (no auth required)
  // Pass shareRegistry so a successful login pre-warms registry entries
  // for the user's trips — recovers from server restarts without Redis.
  app.use(
    "/api/v1/auth",
    createAuthRoutes({ tokenStore, shareRegistry, connectionsStore }),
  );

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
      connectorResolvers,
    }));
  } else {
    app.use("/api/v1/emails", createEmailRoutes({
      resolveStorage,
      connectorResolvers,
    }));
  }

  // Calendar sync routes — always require auth (needs Calendar access token)
  if (requiresAuth) {
    app.use(
      "/api/v1/trips",
      requireAuth,
      createCalendarRoutes({ resolveStorage, connectorResolvers }),
    );
  } else {
    app.use(
      "/api/v1/trips",
      createCalendarRoutes({ resolveStorage, connectorResolvers }),
    );
  }

  // Public shared routes (no auth required)
  app.use("/api/v1/shared", createSharedRoutes({
    resolveStorage,
    shareRegistry,
    resolveOwnerStorage,
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

  // Phase 3: per-user OAuth connections endpoints. Only wired when a
  // dbClient is available — the routes need the `connections` table
  // to do anything useful, and memory-mode dev/tests don't have it.
  // Auth-required in drive / postgres modes (same as everything else).
  if (connectionsStore) {
    app.use(
      "/api/v1/connections",
      requireAuth,
      createConnectionsRoutes({ store: connectionsStore }),
    );
  }

  // Account hard-delete endpoint. Requires auth in postgres mode (so
  // `req.userId` is set + the upstream-revoke + Auth-row deletion
  // steps have something to act on). Memory mode wires the route
  // anonymously so dev / tests can exercise the storage wipe path
  // without needing a Supabase session.
  if (requiresAuth) {
    app.use(
      "/api/v1/account",
      requireAuth,
      createAccountRoutes({
        resolveStorage,
        connectionsStore,
        pushStore,
        supabaseAdmin,
      }),
    );
  } else {
    app.use(
      "/api/v1/account",
      createAccountRoutes({
        resolveStorage,
        connectionsStore: undefined,
        pushStore,
        supabaseAdmin: null,
      }),
    );
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
  // and skip Sentry so they don't generate alerts. Body-parser errors
  // (PayloadTooLargeError, malformed JSON, etc.) carry an HTTP status
  // on the error object — surface that status to the client instead of
  // collapsing them to 500, and skip Sentry for the same "client did a
  // bad thing" reason.
  app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof CorsOriginError) {
      res.status(403).json({ error: err.message });
      return;
    }
    const errWithStatus = err as Error & { status?: number; statusCode?: number; type?: string };
    const clientStatus = errWithStatus.status ?? errWithStatus.statusCode;
    if (typeof clientStatus === "number" && clientStatus >= 400 && clientStatus < 500) {
      // body-parser surfaces oversize / malformed JSON as 4xx with a
      // descriptive `type` (e.g. "entity.too.large", "entity.parse.failed").
      // Log it tersely and return the status it asked for — Sentry
      // doesn't need to hear about every malformed POST.
      console.warn(
        `[app] client error ${clientStatus}${errWithStatus.type ? ` (${errWithStatus.type})` : ""}: ${err.message}`,
      );
      res
        .status(clientStatus)
        .json({ error: clientStatus === 413 ? "Request body too large" : err.message });
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
