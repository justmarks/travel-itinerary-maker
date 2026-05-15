/**
 * REST routes for the auto email-scan scheduler.
 *
 *   POST   /email-scan-schedules           — create
 *   GET    /email-scan-schedules           — list (user-scoped)
 *   PUT    /email-scan-schedules/:id       — enable / disable / change frequency
 *   DELETE /email-scan-schedules/:id       — remove (cascades runs)
 *   GET    /email-scan-schedules/:id/runs  — last 50 runs for a schedule
 *
 *   POST /email-scan-schedules/tick        — cron-only fan-out. Auth via
 *                                            `X-Cron-Secret` (NOT the user
 *                                            JWT) — Supabase pg_cron calls
 *                                            this every minute. Iterates
 *                                            every schedule across every
 *                                            user where
 *                                            `enabled AND next_run_at <= now()`
 *                                            and executes them sequentially.
 *
 * The tick endpoint runs OUT-OF-BAND of a user request — no
 * authenticated user, just a process-level secret. It uses the
 * `DueEmailScanScheduleStore` injected from app.ts to enumerate the
 * cross-user list and a `resolveOwnerStorage` factory to construct a
 * per-user `StorageProvider` for each schedule's executor call.
 */

import { Router, type Request, type Response } from "express";
import {
  createEmailScanScheduleSchema,
  updateEmailScanScheduleSchema,
  generateId,
  type EmailScanSchedule,
} from "@itinly/shared";
import type { StorageProvider, StorageResolver } from "../services/storage";
import type { ConnectionsStore } from "../services/connections-store";
import type { NotificationSender } from "../services/notification-sender";
import type { DueEmailScanScheduleStore } from "../services/email-scan-due";
import { executeSchedule } from "../services/email-scan-executor";
import { computeNextRunAt } from "../services/email-scan-schedule-cadence";
import { config } from "../config/env";

export interface EmailScanScheduleRoutesOptions {
  resolveStorage: StorageResolver | StorageProvider;
  /**
   * Factory that returns a per-user `StorageProvider` given a userId.
   * Used by the cron-tick endpoint to spin up storage scoped to each
   * schedule's owner. In memory mode the same singleton storage is
   * returned for every userId; postgres mode constructs a fresh
   * `SupabaseStorage` per call.
   */
  resolveStorageForUser: (userId: string) => Promise<StorageProvider | null>;
  dueScheduleStore: DueEmailScanScheduleStore;
  connectionsStore?: ConnectionsStore;
  notificationSender?: NotificationSender;
}

export function createEmailScanScheduleRoutes(
  options: EmailScanScheduleRoutesOptions,
): Router {
  const {
    resolveStorage,
    resolveStorageForUser,
    dueScheduleStore,
    connectionsStore,
    notificationSender,
  } = options;

  const getStorage: StorageResolver =
    typeof resolveStorage === "function"
      ? resolveStorage
      : () => resolveStorage;

  const router = Router();

  // ─── Cron tick (no user auth — shared-secret guarded) ───────────────────
  //
  // Mounted BEFORE the user-scoped routes so the secret-guard runs
  // first and never falls through to the userId-checking layer below.
  router.post("/tick", async (req: Request, res: Response) => {
    const expected = config.cron?.secret;
    if (!expected) {
      // In dev / memory mode we don't require the secret — useful for
      // tests that exercise the executor without setting up env. The
      // route still runs but is unreachable on a real deploy because
      // production sets the secret.
      if (config.env === "production") {
        res.status(503).json({ error: "Cron secret not configured" });
        return;
      }
    } else {
      const got = req.header("x-cron-secret") ?? "";
      if (got !== expected) {
        res.status(401).json({ error: "Invalid cron secret" });
        return;
      }
    }

    try {
      const due = await dueScheduleStore.listDue();
      let successCount = 0;
      let failureCount = 0;
      let totalNewSegments = 0;
      for (const schedule of due) {
        const storage = await resolveStorageForUser(schedule.userId);
        if (!storage) {
          // No storage for this user — could mean the row was deleted
          // mid-tick. Skip and keep going.
          continue;
        }
        try {
          const result = await executeSchedule(schedule, {
            storage,
            connectionsStore,
            anthropicApiKey: config.anthropic.apiKey,
            notificationSender,
          });
          if (result.run.status === "succeeded") successCount += 1;
          else failureCount += 1;
          totalNewSegments += result.newCount;
        } catch (err) {
          // executeSchedule already persists a failed run row on
          // exception, but defensive: if the call itself throws (e.g.
          // storage is offline) we still want to keep ticking through
          // the rest.
          console.error(
            `[cron-tick] schedule ${schedule.id} threw outside executor:`,
            err,
          );
          failureCount += 1;
        }
      }
      res.json({
        dueCount: due.length,
        successCount,
        failureCount,
        totalNewSegments,
      });
    } catch (err) {
      console.error("[cron-tick] fatal:", err);
      const msg = err instanceof Error ? err.message : "Cron tick failed";
      res.status(500).json({ error: msg });
    }
  });

  // ─── User-scoped CRUD ───────────────────────────────────────────────────

  router.get("/", async (req: Request, res: Response) => {
    if (!req.userId) {
      res.json([]);
      return;
    }
    try {
      const storage = getStorage(req);
      const schedules = await storage.listEmailScanSchedules();
      res.json(schedules);
    } catch (err) {
      console.error("[email-scan-schedules] list error:", err);
      const msg = err instanceof Error ? err.message : "List failed";
      res.status(500).json({ error: msg });
    }
  });

  router.post("/", async (req: Request, res: Response) => {
    if (!req.userId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const parsed = createEmailScanScheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    try {
      const now = new Date();
      const schedule: EmailScanSchedule = {
        id: generateId(),
        userId: req.userId,
        provider: parsed.data.provider,
        labelFilter: parsed.data.labelFilter,
        labelName: parsed.data.labelName,
        includeSublabels: parsed.data.includeSublabels ?? false,
        frequency: parsed.data.frequency,
        enabled: true,
        nextRunAt: computeNextRunAt(parsed.data.frequency, now),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      const storage = getStorage(req);
      await storage.saveEmailScanSchedule(schedule);
      res.status(201).json(schedule);
    } catch (err) {
      console.error("[email-scan-schedules] create error:", err);
      const msg = err instanceof Error ? err.message : "Create failed";
      res.status(500).json({ error: msg });
    }
  });

  router.put("/:id", async (req: Request, res: Response) => {
    if (!req.userId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const parsed = updateEmailScanScheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    try {
      const storage = getStorage(req);
      const existing = await storage.getEmailScanSchedule((req.params.id as string));
      if (!existing) {
        res.status(404).json({ error: "Schedule not found" });
        return;
      }
      // If the frequency changed, reset `nextRunAt` so the new cadence
      // takes effect on the next tick rather than at the old anchor.
      const frequencyChanged =
        parsed.data.frequency !== undefined &&
        parsed.data.frequency !== existing.frequency;
      const updated: EmailScanSchedule = {
        ...existing,
        provider: parsed.data.provider ?? existing.provider,
        labelFilter:
          parsed.data.labelFilter === null
            ? undefined
            : parsed.data.labelFilter ?? existing.labelFilter,
        labelName:
          parsed.data.labelName === null
            ? undefined
            : parsed.data.labelName ?? existing.labelName,
        frequency: parsed.data.frequency ?? existing.frequency,
        enabled: parsed.data.enabled ?? existing.enabled,
        includeSublabels:
          parsed.data.includeSublabels ?? existing.includeSublabels ?? false,
        nextRunAt: frequencyChanged
          ? computeNextRunAt(parsed.data.frequency!, new Date())
          : existing.nextRunAt,
        updatedAt: new Date().toISOString(),
      };
      await storage.saveEmailScanSchedule(updated);
      res.json(updated);
    } catch (err) {
      console.error("[email-scan-schedules] update error:", err);
      const msg = err instanceof Error ? err.message : "Update failed";
      res.status(500).json({ error: msg });
    }
  });

  router.delete("/:id", async (req: Request, res: Response) => {
    if (!req.userId) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    try {
      const storage = getStorage(req);
      const deleted = await storage.deleteEmailScanSchedule((req.params.id as string));
      if (!deleted) {
        res.status(404).json({ error: "Schedule not found" });
        return;
      }
      res.json({ status: "deleted" });
    } catch (err) {
      console.error("[email-scan-schedules] delete error:", err);
      const msg = err instanceof Error ? err.message : "Delete failed";
      res.status(500).json({ error: msg });
    }
  });

  router.get("/:id/runs", async (req: Request, res: Response) => {
    if (!req.userId) {
      res.json([]);
      return;
    }
    try {
      const storage = getStorage(req);
      // Verify the schedule belongs to this user before exposing its
      // run history (the storage layer also filters, but this is a
      // clearer 404 boundary).
      const schedule = await storage.getEmailScanSchedule((req.params.id as string));
      if (!schedule) {
        res.status(404).json({ error: "Schedule not found" });
        return;
      }
      const runs = await storage.listEmailScanRuns((req.params.id as string));
      res.json(runs);
    } catch (err) {
      console.error("[email-scan-schedules] runs error:", err);
      const msg = err instanceof Error ? err.message : "Runs failed";
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
