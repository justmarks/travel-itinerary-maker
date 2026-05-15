/**
 * Cross-user lookup for the cron-tick endpoint.
 *
 * The per-user `StorageProvider` interface deliberately scopes every
 * query to one user — that's the right shape for route handlers acting
 * on behalf of an authenticated request. The Supabase cron job, on
 * the other hand, is process-wide: it needs every schedule across
 * every user that's due to fire on this tick. This helper is the one
 * place we step outside the per-user scope.
 *
 * Two implementations:
 *  - postgres mode: queries `email_scan_schedules` directly via
 *    drizzle, filtered by `enabled AND next_run_at <= now()`. Backed
 *    by the `email_scan_schedules_due_idx` composite index.
 *  - memory mode: enumerates a single in-memory storage (memory mode
 *    is single-user by construction) and applies the same filter in
 *    JS.
 *
 * Both return the same `EmailScanSchedule[]` shape so the tick route
 * + scheduler-runner can stay storage-agnostic.
 */

import { and, eq, lte } from "drizzle-orm";
import type { EmailScanSchedule } from "@itinly/shared";
import type { Db } from "../db/client";
import type { StorageProvider } from "./storage";
import { emailScanSchedules as emailScanSchedulesTable } from "../db/schema";

export interface DueEmailScanScheduleStore {
  listDue(now?: Date): Promise<EmailScanSchedule[]>;
}

export function createPostgresDueEmailScanScheduleStore(
  db: Db,
): DueEmailScanScheduleStore {
  return {
    async listDue(now: Date = new Date()): Promise<EmailScanSchedule[]> {
      const rows = await db
        .select()
        .from(emailScanSchedulesTable)
        .where(
          and(
            eq(emailScanSchedulesTable.enabled, true),
            lte(emailScanSchedulesTable.nextRunAt, now),
          ),
        );
      return rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        provider: row.provider as EmailScanSchedule["provider"],
        labelFilter: row.labelFilter ?? undefined,
        labelName: row.labelName ?? undefined,
        frequency: row.frequency as EmailScanSchedule["frequency"],
        enabled: row.enabled,
        lastRunAt: row.lastRunAt?.toISOString(),
        nextRunAt: row.nextRunAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }));
    },
  };
}

export function createMemoryDueEmailScanScheduleStore(
  storage: StorageProvider,
): DueEmailScanScheduleStore {
  return {
    async listDue(now: Date = new Date()): Promise<EmailScanSchedule[]> {
      const all = await storage.listEmailScanSchedules();
      const cutoff = now.getTime();
      return all.filter(
        (s) => s.enabled && new Date(s.nextRunAt).getTime() <= cutoff,
      );
    },
  };
}
