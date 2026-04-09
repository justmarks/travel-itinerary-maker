import express from "express";
import cors from "cors";
import { createTripRoutes } from "./routes/trips";
import { createSharedRoutes } from "./routes/shared";
import { createAuthRoutes } from "./routes/auth";
import { requireAuth } from "./middleware/auth";
import type { StorageProvider, StorageResolver } from "./services/storage";
import { DriveStorage } from "./services/google-drive/drive-storage";
import { TokenStore } from "./services/token-store";
import { ShareRegistry } from "./services/share-registry";
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
}

export function createApp(options: AppOptions): express.Express {
  const app = express();
  const { mode, storage } = options;

  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json());

  // Root — friendly landing for browser visits
  app.get("/", (_req, res) => {
    res.json({
      name: "Travel Itinerary Maker API",
      version: "0.1.0",
      health: "/health",
      docs: "/api/v1",
    });
  });

  // Shared services for production mode
  const tokenStore = new TokenStore();
  const shareRegistry = new ShareRegistry();

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

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", version: "0.1.0" });
  });

  // Auth routes (no auth required)
  app.use("/api/v1/auth", createAuthRoutes({ tokenStore }));

  // Trip routes — require auth in drive mode
  if (mode === "drive") {
    app.use("/api/v1/trips", requireAuth, createTripRoutes({
      resolveStorage,
      shareRegistry,
    }));
  } else {
    app.use("/api/v1/trips", createTripRoutes({
      resolveStorage,
      shareRegistry,
    }));
  }

  // Public shared routes (no auth required)
  app.use("/api/v1/shared", createSharedRoutes({
    resolveStorage,
    shareRegistry,
    tokenStore,
  }));

  // 404 handler — catch any unmatched routes
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  // Error handler — catch any unhandled errors from route handlers
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
