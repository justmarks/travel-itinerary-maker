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

// `createApp` is async — TokenStore + ShareRegistry hydrate from
// Redis (when persistence is configured) before the server starts
// accepting requests. Synchronous boot is preserved when there's no
// Redis (hydrate becomes a no-op).
async function bootstrap(): Promise<void> {
  const app = isProduction
    ? await createApp({ mode: "drive" })
    : await createApp({ mode: "memory", storage: new InMemoryStorage() });

  app.listen(config.port, () => {
    console.log(`Server running on http://localhost:${config.port}`);
    console.log(`Environment: ${config.nodeEnv}`);
    console.log(`Storage: ${isProduction ? "Google Drive" : "In-Memory"}`);
    if (config.redis.url && config.redis.token) {
      console.log("Persistence: Upstash Redis (token store + share registry)");
    } else {
      console.log("Persistence: in-memory only (no Redis configured)");
    }
    // Surface VAPID config at boot so misconfiguration is obvious
    // without anyone hitting /push/config. Partial config (only one
    // key) is louder than full-missing because it's almost always a
    // copy-paste error.
    const { publicKey, privateKey } = config.vapid;
    if (publicKey && privateKey) {
      console.log(`Push: VAPID configured (subject=${config.vapid.subject})`);
    } else if (publicKey || privateKey) {
      console.warn(
        `Push: VAPID partially configured — ${publicKey ? "VAPID_PRIVATE_KEY" : "VAPID_PUBLIC_KEY"} is missing. Sends will be no-ops.`,
      );
    } else {
      console.log("Push: VAPID not configured (push notifications disabled)");
    }
  });
}

bootstrap().catch((err) => {
  console.error("Server failed to start:", err);
  process.exit(1);
});
