/**
 * Unit tests for DriveStorage.
 * Mocks the Google Drive API to test storage operations without network calls.
 */

import { DriveStorage } from "../../src/services/google-drive/drive-storage";
import type { Trip, UserSettings } from "@travel-app/shared";

// ─── Mock setup ──────────────────────────────────────────

const mockFilesList = jest.fn();
const mockFilesCreate = jest.fn();
const mockFilesUpdate = jest.fn();
const mockFilesGet = jest.fn();
const mockFilesDelete = jest.fn();

jest.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: jest.fn(),
      })),
    },
    drive: jest.fn().mockReturnValue({
      files: {
        list: (...args: unknown[]) => mockFilesList(...args),
        create: (...args: unknown[]) => mockFilesCreate(...args),
        update: (...args: unknown[]) => mockFilesUpdate(...args),
        get: (...args: unknown[]) => mockFilesGet(...args),
        delete: (...args: unknown[]) => mockFilesDelete(...args),
      },
    }),
  },
}));

// ─── Helpers ─────────────────────────────────────────────

const APP_FOLDER_ID = "app-folder-123";
const TRIPS_FOLDER_ID = "trips-folder-456";

function makeTripJson(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    title: "Test Trip",
    startDate: "2025-12-19",
    endDate: "2025-12-21",
    status: "planning",
    days: [
      { date: "2025-12-19", dayOfWeek: "Fri", city: "Seattle", segments: [] },
    ],
    todos: [],
    shares: [],
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Set up the standard folder resolution mocks:
 * 1. getOrCreateFolder("TravelItineraryMaker") → APP_FOLDER_ID
 * 2. getOrCreateFolder("trips", APP_FOLDER_ID) → TRIPS_FOLDER_ID
 */
function setupFolderMocks() {
  mockFilesList.mockImplementation((params: { q: string }) => {
    if (params.q.includes("TravelItineraryMaker")) {
      return { data: { files: [{ id: APP_FOLDER_ID, name: "TravelItineraryMaker" }] } };
    }
    if (params.q.includes("trips") && params.q.includes(APP_FOLDER_ID)) {
      return { data: { files: [{ id: TRIPS_FOLDER_ID, name: "trips" }] } };
    }
    // Default: file not found
    return { data: { files: [] } };
  });
}

// ─── Tests ───────────────────────────────────────────────

let storage: DriveStorage;

beforeEach(() => {
  jest.clearAllMocks();
  storage = new DriveStorage({ accessToken: "test-token-123" });
  setupFolderMocks();
});

describe("DriveStorage", () => {
  describe("listTrips", () => {
    it("returns empty array when no trip files exist", async () => {
      // Override to return trips folder, then no files in it
      mockFilesList.mockImplementation((params: { q: string }) => {
        if (params.q.includes("TravelItineraryMaker")) {
          return { data: { files: [{ id: APP_FOLDER_ID }] } };
        }
        if (params.q.includes("trips") && params.q.includes(APP_FOLDER_ID)) {
          return { data: { files: [{ id: TRIPS_FOLDER_ID }] } };
        }
        if (params.q.includes(TRIPS_FOLDER_ID) && params.q.includes("application/json")) {
          return { data: { files: [] } };
        }
        return { data: { files: [] } };
      });

      const trips = await storage.listTrips();
      expect(trips).toEqual([]);
    });

    it("returns trips sorted by startDate descending", async () => {
      const tripA = makeTripJson({ id: "trip-a", startDate: "2025-06-01" });
      const tripB = makeTripJson({ id: "trip-b", startDate: "2025-12-01" });

      mockFilesList.mockImplementation((params: { q: string }) => {
        if (params.q.includes("TravelItineraryMaker")) {
          return { data: { files: [{ id: APP_FOLDER_ID }] } };
        }
        if (params.q.includes("trips") && params.q.includes(APP_FOLDER_ID)) {
          return { data: { files: [{ id: TRIPS_FOLDER_ID }] } };
        }
        if (params.q.includes(TRIPS_FOLDER_ID) && params.q.includes("application/json")) {
          return {
            data: {
              files: [
                { id: "file-a", name: "trip-a.json" },
                { id: "file-b", name: "trip-b.json" },
              ],
            },
          };
        }
        return { data: { files: [] } };
      });

      mockFilesGet.mockImplementation((params: { fileId: string }) => {
        if (params.fileId === "file-a") {
          return { data: JSON.stringify(tripA) };
        }
        if (params.fileId === "file-b") {
          return { data: JSON.stringify(tripB) };
        }
        throw new Error("File not found");
      });

      const trips = await storage.listTrips();
      expect(trips).toHaveLength(2);
      expect(trips[0].id).toBe("trip-b"); // Dec before Jun (descending)
      expect(trips[1].id).toBe("trip-a");
    });
  });

  describe("getTrip", () => {
    it("returns null when trip file not found", async () => {
      // findFile returns null (no match in list)
      const trip = await storage.getTrip("nonexistent");
      expect(trip).toBeNull();
    });

    it("returns the trip when file exists", async () => {
      const tripData = makeTripJson();

      mockFilesList.mockImplementation((params: { q: string }) => {
        if (params.q.includes("TravelItineraryMaker")) {
          return { data: { files: [{ id: APP_FOLDER_ID }] } };
        }
        if (params.q.includes("trips") && params.q.includes(APP_FOLDER_ID)) {
          return { data: { files: [{ id: TRIPS_FOLDER_ID }] } };
        }
        if (params.q.includes("trip-1.json") && params.q.includes(TRIPS_FOLDER_ID)) {
          return { data: { files: [{ id: "file-trip-1" }] } };
        }
        return { data: { files: [] } };
      });

      mockFilesGet.mockReturnValue({ data: JSON.stringify(tripData) });

      const trip = await storage.getTrip("trip-1");
      expect(trip).not.toBeNull();
      expect(trip!.id).toBe("trip-1");
      expect(trip!.title).toBe("Test Trip");
    });
  });

  describe("saveTrip", () => {
    it("creates a new file when trip does not exist", async () => {
      const trip = makeTripJson();

      // findFile returns null (no existing file)
      mockFilesList.mockImplementation((params: { q: string }) => {
        if (params.q.includes("TravelItineraryMaker")) {
          return { data: { files: [{ id: APP_FOLDER_ID }] } };
        }
        if (params.q.includes("trips") && params.q.includes(APP_FOLDER_ID)) {
          return { data: { files: [{ id: TRIPS_FOLDER_ID }] } };
        }
        return { data: { files: [] } };
      });

      mockFilesCreate.mockReturnValue({ data: { id: "new-file-id" } });

      await storage.saveTrip(trip);

      expect(mockFilesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            name: "trip-1.json",
            mimeType: "application/json",
            parents: [TRIPS_FOLDER_ID],
          }),
        }),
      );
    });

    it("updates existing file when trip already exists", async () => {
      const trip = makeTripJson();

      mockFilesList.mockImplementation((params: { q: string }) => {
        if (params.q.includes("TravelItineraryMaker")) {
          return { data: { files: [{ id: APP_FOLDER_ID }] } };
        }
        if (params.q.includes("trips") && params.q.includes(APP_FOLDER_ID)) {
          return { data: { files: [{ id: TRIPS_FOLDER_ID }] } };
        }
        if (params.q.includes("trip-1.json")) {
          return { data: { files: [{ id: "existing-file-id" }] } };
        }
        return { data: { files: [] } };
      });

      await storage.saveTrip(trip);

      expect(mockFilesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: "existing-file-id",
        }),
      );
      expect(mockFilesCreate).not.toHaveBeenCalled();
    });
  });

  describe("deleteTrip", () => {
    it("returns false when trip file not found", async () => {
      const result = await storage.deleteTrip("nonexistent");
      expect(result).toBe(false);
    });

    it("deletes the file and returns true", async () => {
      mockFilesList.mockImplementation((params: { q: string }) => {
        if (params.q.includes("TravelItineraryMaker")) {
          return { data: { files: [{ id: APP_FOLDER_ID }] } };
        }
        if (params.q.includes("trips") && params.q.includes(APP_FOLDER_ID)) {
          return { data: { files: [{ id: TRIPS_FOLDER_ID }] } };
        }
        if (params.q.includes("trip-1.json")) {
          return { data: { files: [{ id: "file-to-delete" }] } };
        }
        return { data: { files: [] } };
      });

      const result = await storage.deleteTrip("trip-1");
      expect(result).toBe(true);
      expect(mockFilesDelete).toHaveBeenCalledWith({ fileId: "file-to-delete" });
    });
  });

  describe("getSettings", () => {
    it("returns defaults when no settings file exists", async () => {
      const settings = await storage.getSettings();
      expect(settings).toEqual({
        emailScanIntervalMinutes: 1440,
        notificationsEnabled: true,
      });
    });

    it("returns stored settings", async () => {
      const storedSettings: UserSettings = {
        emailScanIntervalMinutes: 30,
        notificationsEnabled: false,
      };

      mockFilesList.mockImplementation((params: { q: string }) => {
        if (params.q.includes("TravelItineraryMaker")) {
          return { data: { files: [{ id: APP_FOLDER_ID }] } };
        }
        if (params.q.includes("settings.json") && params.q.includes(APP_FOLDER_ID)) {
          return { data: { files: [{ id: "settings-file-id" }] } };
        }
        return { data: { files: [] } };
      });

      mockFilesGet.mockReturnValue({ data: JSON.stringify(storedSettings) });

      const settings = await storage.getSettings();
      expect(settings.emailScanIntervalMinutes).toBe(30);
      expect(settings.notificationsEnabled).toBe(false);
    });
  });

  describe("getProcessedEmails", () => {
    it("returns empty array when no file exists", async () => {
      const emails = await storage.getProcessedEmails();
      expect(emails).toEqual([]);
    });
  });

  describe("folder creation", () => {
    it("creates app folder when it does not exist", async () => {
      // No existing folders found
      mockFilesList.mockReturnValue({ data: { files: [] } });
      mockFilesCreate.mockReturnValue({ data: { id: "new-folder-id" } });

      const trip = makeTripJson();
      await storage.saveTrip(trip);

      // Should have created both TravelItineraryMaker and trips folders
      expect(mockFilesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            name: "TravelItineraryMaker",
            mimeType: "application/vnd.google-apps.folder",
          }),
        }),
      );
    });
  });
});
