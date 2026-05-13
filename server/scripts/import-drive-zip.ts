/**
 * One-shot importer: read an unzipped Drive `Itinly/` folder and
 * write each trip + settings into Postgres. Intended for the
 * single-user cutover from Drive storage to Supabase Postgres —
 * runs once locally with prod DATABASE_URL credentials.
 *
 * Usage:
 *   pnpm tsx server/scripts/import-drive-zip.ts \
 *     --folder=/path/to/Itinly \
 *     --email=you@example.com \
 *     [--apply]
 *
 * Defaults to dry-run (prints what it WOULD write, makes no changes).
 * Add `--apply` to actually upsert rows.
 *
 * Idempotency: `SupabaseStorage.saveTrip` upserts on trip id, so
 * re-running this script with the same folder is safe — rows get
 * the same id and content. Shares are stripped on import (the user
 * said they'll reset shares manually).
 *
 * Env vars consumed:
 *   - DATABASE_URL — required; the Postgres connection string the
 *     script writes to. Same one the running server uses.
 *
 * Why a folder, not a zip: this script only runs once or twice. Pulling
 * in `adm-zip` / `unzipper` for a one-shot tool isn't worth it — the
 * user unzips the Drive folder themselves and points the script at the
 * resulting directory.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { migrateTrip } from "@travel-app/shared";
import type { Trip, UserSettings } from "@travel-app/shared";
import { createDbClient } from "../src/db/client";
import { SupabaseStorage } from "../src/services/supabase-storage";

interface CliArgs {
  folder: string;
  email: string;
  apply: boolean;
}

function parseArgs(): CliArgs {
  const args: Record<string, string | boolean> = {};
  for (const raw of process.argv.slice(2)) {
    if (!raw.startsWith("--")) continue;
    const [key, value] = raw.slice(2).split("=", 2);
    args[key] = value === undefined ? true : value;
  }
  const folder = args.folder;
  const email = args.email;
  if (typeof folder !== "string" || !folder) {
    throw new Error(
      "Missing required --folder=<path>. Point at the unzipped `Itinly/` directory.",
    );
  }
  if (typeof email !== "string" || !email) {
    throw new Error(
      "Missing required --email=<your-supabase-account-email>. The script looks up the user-id via auth.users.",
    );
  }
  return { folder, email, apply: args.apply === true };
}

interface TripDigest {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  dayCount: number;
  segmentCount: number;
  hasShares: boolean;
  hasHistory: boolean;
}

function digest(trip: Trip): TripDigest {
  return {
    id: trip.id,
    title: trip.title,
    startDate: trip.startDate,
    endDate: trip.endDate,
    dayCount: trip.days.length,
    segmentCount: trip.days.reduce((sum, d) => sum + d.segments.length, 0),
    hasShares: (trip.shares?.length ?? 0) > 0,
    hasHistory: (trip.history?.length ?? 0) > 0,
  };
}

async function main(): Promise<void> {
  const { folder, email, apply } = parseArgs();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL env var is required.");
  }
  const tripsDir = join(folder, "trips");
  if (!existsSync(tripsDir)) {
    throw new Error(`Expected ${tripsDir} to exist — pass the path that CONTAINS the trips/ subfolder.`);
  }

  console.log(`[import] mode=${apply ? "APPLY" : "DRY-RUN"} folder=${folder} email=${email}`);
  // Visual divider so the next thing the user sees is the import
  // plan, not noise from imports.
  console.log("─".repeat(72));

  const client = createDbClient(databaseUrl);

  try {
    // Look up the Supabase user-id by email. `auth.users` lives in
    // the Supabase auth schema, not in our drizzle schema, so we
    // query it via a raw SQL call. Service role is implied by the
    // DATABASE_URL pointing at the project's `postgres` superuser.
    const lookupResult = await client.pool.query<{
      id: string;
      email: string | null;
    }>(`SELECT id, email FROM auth.users WHERE email = $1 LIMIT 1`, [email]);
    if (lookupResult.rows.length === 0) {
      throw new Error(
        `No auth.users row found for email=${email}. Confirm you've signed in at least once with this email.`,
      );
    }
    const userId = lookupResult.rows[0].id;
    console.log(`[import] resolved user-id=${userId} for email=${email}`);

    const storage = new SupabaseStorage({ db: client.db, userId });

    // Catalogue existing trips so we can flag overlaps in the dry-run.
    const existing = await storage.listTrips();
    const existingIds = new Set(existing.map((t) => t.id));
    console.log(`[import] existing trips in Postgres for this user: ${existing.length}`);

    // ── Trips ──────────────────────────────────────────────
    const tripFiles = readdirSync(tripsDir).filter((f) => f.endsWith(".json"));
    console.log(`[import] found ${tripFiles.length} trip JSON files in ${tripsDir}`);

    let imported = 0;
    let overlapped = 0;
    let strippedShareCount = 0;
    for (const file of tripFiles) {
      const raw = readFileSync(join(tripsDir, file), "utf-8");
      let trip: Trip;
      try {
        // migrateTrip handles older schemaVersion payloads + fills in
        // defaults the current schema expects.
        trip = migrateTrip(JSON.parse(raw));
      } catch (err) {
        console.warn(
          `[import] SKIP ${file}: ${err instanceof Error ? err.message : err}`,
        );
        continue;
      }
      // Strip shares per user instruction: they'll reset shares
      // manually after the import. Leaving the shares array on the
      // trip would write rows that resolve via the old Drive-era
      // shareTokens — those tokens don't exist in Postgres yet.
      const hadShares = trip.shares.length > 0;
      if (hadShares) strippedShareCount += trip.shares.length;
      trip.shares = [];

      const d = digest(trip);
      const overlap = existingIds.has(trip.id);
      if (overlap) overlapped += 1;
      console.log(
        `[import] ${apply ? "SAVE" : "WOULD SAVE"}` +
          ` id=${d.id} title="${d.title}" ${d.startDate}..${d.endDate}` +
          ` days=${d.dayCount} segs=${d.segmentCount}` +
          ` history=${d.hasHistory ? "yes" : "no"}` +
          ` overlap=${overlap ? "EXISTING" : "new"}` +
          ` stripped-shares=${hadShares ? trip.shares.length === 0 ? "yes" : "partial" : "0"}`,
      );

      if (apply) {
        await storage.saveTrip(trip);
        imported += 1;
      }
    }

    // ── Settings ───────────────────────────────────────────
    const settingsPath = join(folder, "settings.json");
    let settingsImported = false;
    if (existsSync(settingsPath)) {
      const raw = readFileSync(settingsPath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<UserSettings>;
      // Server's `UserSettings` requires explicit values for
      // `emailScanIntervalMinutes` and `notificationsEnabled`. Fill
      // the same defaults the in-memory store uses for unset fields.
      const settings: UserSettings = {
        gmailLabelFilter: parsed.gmailLabelFilter ?? undefined,
        emailScanIntervalMinutes:
          typeof parsed.emailScanIntervalMinutes === "number"
            ? parsed.emailScanIntervalMinutes
            : 15,
        notificationsEnabled:
          typeof parsed.notificationsEnabled === "boolean"
            ? parsed.notificationsEnabled
            : true,
      };
      console.log(
        `[import] ${apply ? "SAVE" : "WOULD SAVE"} settings` +
          ` gmailLabelFilter=${settings.gmailLabelFilter ?? "(none)"}` +
          ` emailScanIntervalMinutes=${settings.emailScanIntervalMinutes}` +
          ` notificationsEnabled=${settings.notificationsEnabled}`,
      );
      if (apply) {
        await storage.saveSettings(settings);
        settingsImported = true;
      }
    } else {
      console.log(`[import] no settings.json found in ${folder}`);
    }

    // Skipped on purpose (per user instruction):
    //   - processed-emails.json  → don't bother
    //   - share-rules.json       → reset manually after import
    console.log(`[import] skipped processed-emails.json (per user choice)`);
    console.log(`[import] skipped share-rules.json (user will reset shares manually)`);

    console.log("─".repeat(72));
    console.log(
      `[import] summary: ${apply ? "imported" : "would import"} ${apply ? imported : tripFiles.length} trip(s)` +
        ` (${overlapped} overlap with existing rows; idempotent upsert)` +
        ` settings=${settingsImported || (!apply && existsSync(settingsPath)) ? "yes" : "no"}` +
        ` stripped ${strippedShareCount} share row(s) across all trips`,
    );
    if (!apply) {
      console.log(
        `[import] DRY-RUN — no rows written. Re-run with --apply to commit.`,
      );
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(`[import] FAILED: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
