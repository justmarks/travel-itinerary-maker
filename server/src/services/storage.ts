import type { Request } from "express";
import type { Trip, TripShareRule, UserSettings } from "@itinly/shared";
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
}

/**
 * Factory function that resolves a StorageProvider from a request.
 * In development, returns a shared InMemoryStorage.
 * In production, creates a per-user DriveStorage from the request's access token.
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

  /** Reset all data (for testing) */
  clear(): void {
    this.trips.clear();
    this.settings = { emailScanIntervalMinutes: 1440, notificationsEnabled: true };
    this.processedEmails = [];
    this.shareRules.clear();
  }
}
