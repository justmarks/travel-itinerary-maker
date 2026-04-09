import express from "express";
import cors from "cors";
import { createTripRoutes } from "./routes/trips";
import { createSharedRoutes } from "./routes/shared";
import { createAuthRoutes } from "./routes/auth";
import type { StorageProvider } from "./services/storage";
import { config } from "./config/env";

export function createApp(storage: StorageProvider): express.Express {
  const app = express();

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

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", version: "0.1.0" });
  });

  // Auth routes (no auth required)
  app.use("/api/v1/auth", createAuthRoutes());

  // API routes (auth will be enforced in production via middleware)
  app.use("/api/v1/trips", createTripRoutes(storage));

  // Public shared routes (no auth required)
  app.use("/api/v1/shared", createSharedRoutes(storage));

  return app;
}
