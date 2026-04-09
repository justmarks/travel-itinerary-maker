import type { Request } from "express";
import type { Trip, UserSettings } from "@travel-app/shared";
import type { ProcessedEmail } from "./google-drive/drive-storage";

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
    emailScanIntervalMinutes: 15,
    notificationsEnabled: true,
  };
  private processedEmails: ProcessedEmail[] = [];

  async listTrips(): Promise<Trip[]> {
    return Array.from(this.trips.values()).sort(
      (a, b) =>
        new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
    );
  }

  async getTrip(tripId: string): Promise<Trip | null> {
    return this.trips.get(tripId) ?? null;
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

  /** Reset all data (for testing) */
  clear(): void {
    this.trips.clear();
    this.settings = { emailScanIntervalMinutes: 15, notificationsEnabled: true };
    this.processedEmails = [];
  }
}
