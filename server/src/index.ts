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

import type express from "express";
import { createApp } from "./app";
import { InMemoryStorage } from "./services/storage";
import { initMonitoring } from "./services/monitoring";
import { createDbClient, type DbClient } from "./db/client";
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
  // Resolve the active backend. Explicit STORAGE_BACKEND wins;
  // unset falls back to `postgres` in production and `memory` in dev.
  // The pre-Phase-6 `drive` backend (per-user Google Drive storage)
  // was removed once the Postgres migration finished — see
  // `docs/backend-migration-plan.md`.
  const backend: "postgres" | "memory" =
    config.storage.backend ?? (isProduction ? "postgres" : "memory");

  // Boot a DB client when storage involves Postgres OR when Supabase
  // Auth is wired up (Supabase-authed users live exclusively on
  // Postgres). One client per process; we reuse its pool across
  // requests.
  let dbClient: DbClient | undefined;
  const supabaseAuthConfigured = !!config.supabase.url;
  const needsDb = backend === "postgres" || supabaseAuthConfigured;
  if (needsDb) {
    if (!config.storage.databaseUrl) {
      throw new Error(
        "DATABASE_URL is required when STORAGE_BACKEND=postgres or " +
          "SUPABASE_URL is set (Supabase-authed users require Postgres).",
      );
    }
    dbClient = createDbClient(config.storage.databaseUrl);
  }

  let app: express.Express;
  if (backend === "postgres") {
    app = await createApp({ mode: "postgres", dbClient });
  } else {
    app = await createApp({ mode: "memory", storage: new InMemoryStorage() });
  }

  app.listen(config.port, () => {
    console.log(`Server running on http://localhost:${config.port}`);
    console.log(`Environment: ${config.nodeEnv}`);
    if (backend === "postgres") {
      console.log("Storage: Supabase Postgres (every user)");
    } else {
      console.log("Storage: In-Memory");
    }
    // Railway injects these on every deploy. Log them once at boot so a
    // deployment UUID in Railway's log UI can be mapped back to a
    // human-readable preview URL / branch / commit without digging
    // through the deploy details panel. All four are unset locally, so
    // the block is silently skipped in dev.
    const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
    const railwayBranch = process.env.RAILWAY_GIT_BRANCH;
    const railwayCommit = process.env.RAILWAY_GIT_COMMIT_SHA;
    const railwayEnv = process.env.RAILWAY_ENVIRONMENT_NAME;
    if (railwayDomain || railwayBranch || railwayCommit || railwayEnv) {
      const parts: string[] = [];
      if (railwayDomain) parts.push(`url=https://${railwayDomain}`);
      if (railwayEnv) parts.push(`env=${railwayEnv}`);
      if (railwayBranch) parts.push(`branch=${railwayBranch}`);
      if (railwayCommit) parts.push(`commit=${railwayCommit.slice(0, 7)}`);
      console.log(`Railway: ${parts.join(" ")}`);
    }
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
