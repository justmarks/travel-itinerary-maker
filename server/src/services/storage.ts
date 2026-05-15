import type { Request } from "express";
import type {
  EmailScanRun,
  EmailScanSchedule,
  Trip,
  TripShareRule,
  UserSettings,
} from "@itinly/shared";
import type { ProcessedEmail } from "./processed-email";

/**
 * Abstract storage interface. Allows swapping Google Drive
 * for an in-memory store during testing.
 */
export interface StorageProvider {
  listTrips(): Promise<Trip[]>;
  getTrip(tripId: string): Promise<Trip | null>;
  saveTrip(trip: Trip): Promise<void>;
  deleteTrip(tripId: string): Promise<boolean>;
  getSettings(): Promise<UserSettings>;
  saveSettings(settings: UserSettings): Promise<void>;
  getProcessedEmails(): Promise<ProcessedEmail[]>;
  saveProcessedEmails(emails: ProcessedEmail[]): Promise<void>;
  /** Auto-share rules — owner-scoped. See `TripShareRule`. */
  listShareRules(): Promise<TripShareRule[]>;
  getShareRule(ruleId: string): Promise<TripShareRule | null>;
  saveShareRule(rule: TripShareRule): Promise<void>;
  deleteShareRule(ruleId: string): Promise<boolean>;
  /**
   * Auto email-scan schedules — user-scoped. See `EmailScanSchedule`
   * and `EmailScanRun`. Implementations are responsible for capping
   * the run history at the most recent 50 entries per schedule.
   */
  listEmailScanSchedules(): Promise<EmailScanSchedule[]>;
  getEmailScanSchedule(id: string): Promise<EmailScanSchedule | null>;
  saveEmailScanSchedule(schedule: EmailScanSchedule): Promise<void>;
  deleteEmailScanSchedule(id: string): Promise<boolean>;
  listEmailScanRuns(scheduleId: string): Promise<EmailScanRun[]>;
  saveEmailScanRun(run: EmailScanRun): Promise<void>;
  /**
   * Hard-delete every row this provider knows about for `userId`.
   * Irreversible. Used by the account-deletion endpoint.
   *
   * SupabaseStorage runs a single transaction that drops the user's
   * trips (with FK cascades handling segments / todos / history /
   * trip_shares), share rules, processed emails, and user settings.
   * Connections + push subscriptions live outside StorageProvider, so
   * the route also calls their dedicated deletion helpers.
   *
   * InMemoryStorage memory-mode is single-user by construction, so
   * the impl just calls `clear()`.
   */
  deleteAllForUser(userId: string): Promise<void>;
}

/**
 * Factory function that resolves a StorageProvider from a request.
 * In development, returns a shared InMemoryStorage.
 * In production, creates a per-user SupabaseStorage scoped to the
 * authenticated user from the request.
 */
export type StorageResolver = (req: Request) => StorageProvider;

/**
 * In-memory storage for testing and development.
 */
export class InMemoryStorage implements StorageProvider {
  private trips: Map<string, Trip> = new Map();
  private settings: UserSettings = {
    emailScanIntervalMinutes: 1440,
    notificationsEnabled: true,
  };
  private processedEmails: ProcessedEmail[] = [];
  private shareRules: Map<string, TripShareRule> = new Map();
  private emailScanSchedules: Map<string, EmailScanSchedule> = new Map();
  /** Run history, keyed by scheduleId. Capped at 50 per schedule. */
  private emailScanRuns: Map<string, EmailScanRun[]> = new Map();
  private static readonly RUN_HISTORY_CAP = 50;

  async listTrips(): Promise<Trip[]> {
    return Array.from(this.trips.values())
      .map((t) => structuredClone(t))
      .sort(
        (a, b) =>
          new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
      );
  }

  async getTrip(tripId: string): Promise<Trip | null> {
    const trip = this.trips.get(tripId);
    return trip ? structuredClone(trip) : null;
  }

  async saveTrip(trip: Trip): Promise<void> {
    this.trips.set(trip.id, structuredClone(trip));
  }

  async deleteTrip(tripId: string): Promise<boolean> {
    return this.trips.delete(tripId);
  }

  async getSettings(): Promise<UserSettings> {
    return structuredClone(this.settings);
  }

  async saveSettings(settings: UserSettings): Promise<void> {
    this.settings = structuredClone(settings);
  }

  async getProcessedEmails(): Promise<ProcessedEmail[]> {
    return structuredClone(this.processedEmails);
  }

  async saveProcessedEmails(emails: ProcessedEmail[]): Promise<void> {
    this.processedEmails = structuredClone(emails);
  }

  async listShareRules(): Promise<TripShareRule[]> {
    return Array.from(this.shareRules.values())
      .map((rule) => structuredClone(rule))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getShareRule(ruleId: string): Promise<TripShareRule | null> {
    const rule = this.shareRules.get(ruleId);
    return rule ? structuredClone(rule) : null;
  }

  async saveShareRule(rule: TripShareRule): Promise<void> {
    this.shareRules.set(rule.id, structuredClone(rule));
  }

  async deleteShareRule(ruleId: string): Promise<boolean> {
    return this.shareRules.delete(ruleId);
  }

  async listEmailScanSchedules(): Promise<EmailScanSchedule[]> {
    return Array.from(this.emailScanSchedules.values())
      .map((s) => structuredClone(s))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getEmailScanSchedule(id: string): Promise<EmailScanSchedule | null> {
    const found = this.emailScanSchedules.get(id);
    return found ? structuredClone(found) : null;
  }

  async saveEmailScanSchedule(schedule: EmailScanSchedule): Promise<void> {
    this.emailScanSchedules.set(schedule.id, structuredClone(schedule));
  }

  async deleteEmailScanSchedule(id: string): Promise<boolean> {
    this.emailScanRuns.delete(id);
    return this.emailScanSchedules.delete(id);
  }

  async listEmailScanRuns(scheduleId: string): Promise<EmailScanRun[]> {
    const runs = this.emailScanRuns.get(scheduleId) ?? [];
    // Newest-first ordering matches the settings UI's expectations.
    return runs
      .map((r) => structuredClone(r))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async saveEmailScanRun(run: EmailScanRun): Promise<void> {
    const existing = this.emailScanRuns.get(run.scheduleId) ?? [];
    // Upsert by id so a `running` row can transition to `succeeded` /
    // `failed` on the same record rather than spawning a new one.
    const idx = existing.findIndex((r) => r.id === run.id);
    const next = idx >= 0
      ? existing.map((r, i) => (i === idx ? structuredClone(run) : r))
      : [...existing, structuredClone(run)];
    // Cap at 50 most-recent — drop the oldest entries first.
    next.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const capped = next.slice(0, InMemoryStorage.RUN_HISTORY_CAP);
    this.emailScanRuns.set(run.scheduleId, capped);
  }

  async deleteAllForUser(_userId: string): Promise<void> {
    // Memory mode has no per-user scoping — everything in this
    // singleton belongs to the one (anonymous) caller. Mirror the
    // existing `clear()` behaviour so calling the account-deletion
    // endpoint in memory mode resets the store.
    this.clear();
  }

  /** Reset all data (for testing) */
  clear(): void {
    this.trips.clear();
    this.settings = { emailScanIntervalMinutes: 1440, notificationsEnabled: true };
    this.processedEmails = [];
    this.shareRules.clear();
    this.emailScanSchedules.clear();
    this.emailScanRuns.clear();
  }
}
