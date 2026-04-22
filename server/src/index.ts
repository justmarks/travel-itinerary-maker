import dotenv from "dotenv";
import { existsSync } from "fs";
import path from "path";

// Load .env — try monorepo root first (pnpm dev from root via Turbo),
// then one level up from server/ (cd server && pnpm dev).
const rootEnv = path.resolve(process.cwd(), ".env");
const parentEnv = path.resolve(process.cwd(), "../.env");
// override: true ensures .env values win over any NODE_ENV that Turbo
// or other tooling may inject into the process environment.
dotenv.config({
  path: existsSync(rootEnv) ? rootEnv : parentEnv,
  override: true,
});

import { createApp } from "./app";
import { InMemoryStorage } from "./services/storage";
import { initMonitoring } from "./services/monitoring";
import { config } from "./config/env";

// Initialise Sentry before building the app so any bootstrap error is
// captured too. No-op when SENTRY_DSN is unset (dev / CI / tests).
initMonitoring();

const isProduction = config.nodeEnv === "production";

const app = isProduction
  ? createApp({ mode: "drive" })
  : createApp({ mode: "memory", storage: new InMemoryStorage() });

app.listen(config.port, () => {
  console.log(`Server running on http://localhost:${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Storage: ${isProduction ? "Google Drive" : "In-Memory"}`);
});
