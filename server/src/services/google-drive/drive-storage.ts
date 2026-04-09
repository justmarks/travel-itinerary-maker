import { google, type drive_v3 } from "googleapis";
import type { Trip, UserSettings } from "@travel-app/shared";
import type { StorageProvider } from "../storage";

const APP_FOLDER_NAME = "TravelItineraryMaker";
const TRIPS_FOLDER_NAME = "trips";
const SETTINGS_FILE_NAME = "settings.json";
const PROCESSED_EMAILS_FILE_NAME = "processed-emails.json";

export interface ProcessedEmail {
  gmailMessageId: string;
  gmailThreadId?: string;
  subject?: string;
  fromAddress?: string;
  receivedAt?: string;
  parsedType?: string;
  segmentId?: string;
  tripId?: string;
  parseStatus: "pending" | "parsed" | "mapped" | "skipped" | "failed";
  rawParseResult?: unknown;
  createdAt: string;
}

export interface DriveStorageOptions {
  accessToken: string;
}

/**
 * Google Drive storage service that reads/writes trip data
 * to the user's own Google Drive in a hidden app folder.
 */
export class DriveStorage implements StorageProvider {
  private drive: drive_v3.Drive;

  constructor(options: DriveStorageOptions) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: options.accessToken });
    this.drive = google.drive({ version: "v3", auth });
  }

  /** Find or create the app root folder */
  private async getOrCreateFolder(
    name: string,
    parentId?: string,
  ): Promise<string> {
    const query = parentId
      ? `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
      : `name='${name}' and mimeType='application/vnd.google-apps.folder' and 'root' in parents and trashed=false`;

    const res = await this.drive.files.list({
      q: query,
      fields: "files(id, name)",
      spaces: "drive",
    });

    if (res.data.files && res.data.files.length > 0) {
      return res.data.files[0].id!;
    }

    const createRes = await this.drive.files.create({
      requestBody: {
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: parentId ? [parentId] : undefined,
      },
      fields: "id",
    });

    return createRes.data.id!;
  }

  private async getAppFolderId(): Promise<string> {
    return this.getOrCreateFolder(APP_FOLDER_NAME);
  }

  private async getTripsFolderId(): Promise<string> {
    const appFolderId = await this.getAppFolderId();
    return this.getOrCreateFolder(TRIPS_FOLDER_NAME, appFolderId);
  }

  /** Find a file by name in a folder */
  private async findFile(
    name: string,
    parentId: string,
  ): Promise<string | null> {
    const res = await this.drive.files.list({
      q: `name='${name}' and '${parentId}' in parents and trashed=false`,
      fields: "files(id, name)",
      spaces: "drive",
    });

    return res.data.files?.[0]?.id ?? null;
  }

  /** Read JSON from a file */
  private async readJsonFile<T>(fileId: string): Promise<T> {
    const res = await this.drive.files.get(
      { fileId, alt: "media" },
      { responseType: "text" },
    );
    return JSON.parse(res.data as string) as T;
  }

  /** Write JSON to a file (create or update) */
  private async writeJsonFile(
    name: string,
    parentId: string,
    data: unknown,
  ): Promise<string> {
    const existingId = await this.findFile(name, parentId);
    const content = JSON.stringify(data, null, 2);

    if (existingId) {
      await this.drive.files.update({
        fileId: existingId,
        media: { mimeType: "application/json", body: content },
      });
      return existingId;
    }

    const res = await this.drive.files.create({
      requestBody: {
        name,
        mimeType: "application/json",
        parents: [parentId],
      },
      media: { mimeType: "application/json", body: content },
      fields: "id",
    });

    return res.data.id!;
  }

  /** Delete a file by ID */
  private async deleteFile(fileId: string): Promise<void> {
    await this.drive.files.delete({ fileId });
  }

  // ─── Trip CRUD ───────────────────────────────────────────

  async listTrips(): Promise<Trip[]> {
    const tripsFolderId = await this.getTripsFolderId();
    const res = await this.drive.files.list({
      q: `'${tripsFolderId}' in parents and trashed=false and mimeType='application/json'`,
      fields: "files(id, name)",
      spaces: "drive",
    });

    const trips: Trip[] = [];
    for (const file of res.data.files || []) {
      const trip = await this.readJsonFile<Trip>(file.id!);
      trips.push(trip);
    }

    return trips.sort(
      (a, b) =>
        new Date(b.startDate).getTime() - new Date(a.startDate).getTime(),
    );
  }

  async getTrip(tripId: string): Promise<Trip | null> {
    const tripsFolderId = await this.getTripsFolderId();
    const fileId = await this.findFile(`${tripId}.json`, tripsFolderId);
    if (!fileId) return null;
    return this.readJsonFile<Trip>(fileId);
  }

  async saveTrip(trip: Trip): Promise<void> {
    const tripsFolderId = await this.getTripsFolderId();
    await this.writeJsonFile(`${trip.id}.json`, tripsFolderId, trip);
  }

  async deleteTrip(tripId: string): Promise<boolean> {
    const tripsFolderId = await this.getTripsFolderId();
    const fileId = await this.findFile(`${tripId}.json`, tripsFolderId);
    if (!fileId) return false;
    await this.deleteFile(fileId);
    return true;
  }

  // ─── Settings ────────────────────────────────────────────

  async getSettings(): Promise<UserSettings> {
    const appFolderId = await this.getAppFolderId();
    const fileId = await this.findFile(SETTINGS_FILE_NAME, appFolderId);
    if (!fileId) {
      return {
        emailScanIntervalMinutes: 15,
        notificationsEnabled: true,
      };
    }
    return this.readJsonFile<UserSettings>(fileId);
  }

  async saveSettings(settings: UserSettings): Promise<void> {
    const appFolderId = await this.getAppFolderId();
    await this.writeJsonFile(SETTINGS_FILE_NAME, appFolderId, settings);
  }

  // ─── Processed Emails ───────────────────────────────────

  async getProcessedEmails(): Promise<ProcessedEmail[]> {
    const appFolderId = await this.getAppFolderId();
    const fileId = await this.findFile(
      PROCESSED_EMAILS_FILE_NAME,
      appFolderId,
    );
    if (!fileId) return [];
    return this.readJsonFile<ProcessedEmail[]>(fileId);
  }

  async saveProcessedEmails(emails: ProcessedEmail[]): Promise<void> {
    const appFolderId = await this.getAppFolderId();
    await this.writeJsonFile(
      PROCESSED_EMAILS_FILE_NAME,
      appFolderId,
      emails,
    );
  }
}
