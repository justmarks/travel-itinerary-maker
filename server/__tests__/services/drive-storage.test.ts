/**
 * Unit tests for DriveStorage.
 * Mocks the Google Drive API to test storage operations without network calls.
 */

import { DriveStorage } from "../../src/services/google-drive/drive-storage";
import type { Trip, TripShareRule, UserSettings } from "@itinly/shared";

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
 * 1. findFolderAtRoot("Itinly") → APP_FOLDER_ID
 * 2. getOrCreateFolder("trips", APP_FOLDER_ID) → TRIPS_FOLDER_ID
 *
 * The legacy `TravelItineraryMaker` folder is absent in this default
 * setup — tests that exercise the rename-on-migration path stub their
 * own mocks. See the "legacy folder migration" describe block.
 */
function setupFolderMocks() {
  mockFilesList.mockImplementation((params: { q: string }) => {
    if (params.q.includes("'Itinly'")) {
      return { data: { files: [{ id: APP_FOLDER_ID, name: "Itinly" }] } };
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
        if (params.q.includes("'Itinly'")) {
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
        if (params.q.includes("'Itinly'")) {
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
        if (params.q.includes("'Itinly'")) {
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
        if (params.q.includes("'Itinly'")) {
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
        if (params.q.includes("'Itinly'")) {
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
        if (params.q.includes("'Itinly'")) {
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
        if (params.q.includes("'Itinly'")) {
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

  describe("share rules", () => {
    const SHARE_RULES_FILE_ID = "share-rules-file-789";

    function makeRule(overrides: Partial<TripShareRule> = {}): TripShareRule {
      return {
        id: "rule-1",
        ownerUserId: "owner-1",
        ownerEmail: "owner@example.com",
        sharedWithEmail: "guest@example.com",
        permission: "view",
        showCosts: true,
        showTodos: true,
        createdAt: "2026-05-09T10:00:00.000Z",
        updatedAt: "2026-05-09T10:00:00.000Z",
        ...overrides,
      };
    }

    /**
     * Mocks `share-rules.json` reads against an in-memory `rules` array
     * the test owns, so each test can assert on what was written without
     * coupling to writeJsonFile's create-vs-update branching.
     */
    function setupRulesFileMocks(initial: TripShareRule[] | null) {
      const state = { rules: initial };
      mockFilesList.mockImplementation((params: { q: string }) => {
        if (params.q.includes("'Itinly'")) {
          return { data: { files: [{ id: APP_FOLDER_ID }] } };
        }
        if (
          params.q.includes("share-rules.json") &&
          params.q.includes(APP_FOLDER_ID)
        ) {
          return {
            data: {
              files: state.rules ? [{ id: SHARE_RULES_FILE_ID }] : [],
            },
          };
        }
        return { data: { files: [] } };
      });
      mockFilesGet.mockImplementation((params: { fileId: string }) => {
        if (params.fileId === SHARE_RULES_FILE_ID) {
          return { data: JSON.stringify(state.rules ?? []) };
        }
        return { data: "{}" };
      });
      mockFilesUpdate.mockImplementation((params: { fileId: string; media: { body: string } }) => {
        if (params.fileId === SHARE_RULES_FILE_ID) {
          state.rules = JSON.parse(params.media.body);
        }
        return { data: { id: params.fileId } };
      });
      mockFilesCreate.mockImplementation((params: { media: { body: string } }) => {
        state.rules = JSON.parse(params.media.body);
        return { data: { id: SHARE_RULES_FILE_ID } };
      });
      return state;
    }

    describe("listShareRules", () => {
      it("returns empty array when share-rules.json doesn't exist", async () => {
        // Default folder mocks already return no share-rules file.
        const rules = await storage.listShareRules();
        expect(rules).toEqual([]);
        // No write — listing a missing file should be read-only.
        expect(mockFilesUpdate).not.toHaveBeenCalled();
        expect(mockFilesCreate).not.toHaveBeenCalled();
      });

      it("returns rules read from share-rules.json", async () => {
        setupRulesFileMocks([makeRule(), makeRule({ id: "rule-2", sharedWithEmail: "other@example.com" })]);
        const rules = await storage.listShareRules();
        expect(rules.map((r) => r.id)).toEqual(["rule-1", "rule-2"]);
      });
    });

    describe("getShareRule", () => {
      it("returns null when the rule isn't in the file", async () => {
        setupRulesFileMocks([makeRule()]);
        expect(await storage.getShareRule("missing")).toBeNull();
      });

      it("returns the matching rule", async () => {
        setupRulesFileMocks([makeRule(), makeRule({ id: "rule-2", sharedWithEmail: "other@example.com" })]);
        const rule = await storage.getShareRule("rule-2");
        expect(rule?.sharedWithEmail).toBe("other@example.com");
      });
    });

    describe("saveShareRule", () => {
      it("creates share-rules.json with one rule when none exists", async () => {
        const state = setupRulesFileMocks(null);
        await storage.saveShareRule(makeRule());
        expect(state.rules).toEqual([makeRule()]);
        expect(mockFilesCreate).toHaveBeenCalled();
      });

      it("appends to an existing share-rules.json", async () => {
        const state = setupRulesFileMocks([makeRule()]);
        await storage.saveShareRule(
          makeRule({ id: "rule-2", sharedWithEmail: "second@example.com" }),
        );
        expect(state.rules?.map((r) => r.id)).toEqual(["rule-1", "rule-2"]);
        expect(mockFilesUpdate).toHaveBeenCalled();
      });

      it("replaces an existing rule with the same id (no duplicates)", async () => {
        const state = setupRulesFileMocks([makeRule({ permission: "view" })]);
        await storage.saveShareRule(makeRule({ permission: "edit" }));
        expect(state.rules).toHaveLength(1);
        expect(state.rules?.[0].permission).toBe("edit");
      });
    });

    describe("deleteShareRule", () => {
      it("returns false and writes nothing when the rule is absent", async () => {
        setupRulesFileMocks([makeRule()]);
        const removed = await storage.deleteShareRule("missing");
        expect(removed).toBe(false);
        // No write happened — file untouched.
        expect(mockFilesUpdate).not.toHaveBeenCalled();
        expect(mockFilesCreate).not.toHaveBeenCalled();
      });

      it("removes the rule and persists the trimmed array", async () => {
        const state = setupRulesFileMocks([
          makeRule({ id: "rule-1" }),
          makeRule({ id: "rule-2", sharedWithEmail: "other@example.com" }),
        ]);
        const removed = await storage.deleteShareRule("rule-1");
        expect(removed).toBe(true);
        expect(state.rules?.map((r) => r.id)).toEqual(["rule-2"]);
      });
    });
  });

  describe("folder creation", () => {
    it("creates Itinly app folder when neither it nor a legacy folder exists", async () => {
      // No existing folders found — first-time user.
      mockFilesList.mockReturnValue({ data: { files: [] } });
      mockFilesCreate.mockReturnValue({ data: { id: "new-folder-id" } });

      const trip = makeTripJson();
      await storage.saveTrip(trip);

      // Should have created the Itinly app folder (and the trips
      // subfolder) — but never the legacy TravelItineraryMaker name.
      expect(mockFilesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            name: "Itinly",
            mimeType: "application/vnd.google-apps.folder",
          }),
        }),
      );
      expect(mockFilesCreate).not.toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            name: "TravelItineraryMaker",
          }),
        }),
      );
    });
  });

  describe("legacy folder migration", () => {
    const LEGACY_FOLDER_ID = "legacy-folder-789";

    it("renames a TravelItineraryMaker folder to Itinly when no Itinly folder exists", async () => {
      mockFilesList.mockImplementation((params: { q: string }) => {
        // Itinly lookup → empty (not migrated yet).
        if (params.q.includes("'Itinly'")) {
          return { data: { files: [] } };
        }
        // Legacy lookup → existing folder.
        if (params.q.includes("'TravelItineraryMaker'")) {
          return {
            data: {
              files: [{ id: LEGACY_FOLDER_ID, name: "TravelItineraryMaker" }],
            },
          };
        }
        // trips subfolder lookup, scoped to the legacy folder ID since
        // the migration preserves the same folder ID.
        if (
          params.q.includes("trips") &&
          params.q.includes(LEGACY_FOLDER_ID)
        ) {
          return { data: { files: [{ id: TRIPS_FOLDER_ID, name: "trips" }] } };
        }
        return { data: { files: [] } };
      });
      mockFilesCreate.mockReturnValue({ data: { id: "new-trip-file-id" } });

      const trip = makeTripJson();
      await storage.saveTrip(trip);

      // The legacy folder should have been renamed in place — same ID,
      // new name. No new app folder should have been created.
      expect(mockFilesUpdate).toHaveBeenCalledWith({
        fileId: LEGACY_FOLDER_ID,
        requestBody: { name: "Itinly" },
      });
      expect(mockFilesCreate).not.toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            name: "Itinly",
            mimeType: "application/vnd.google-apps.folder",
          }),
        }),
      );

      // The trip file should land inside the trips subfolder of the
      // (now-renamed) legacy folder — confirming we kept the same ID.
      expect(mockFilesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            name: "trip-1.json",
            parents: [TRIPS_FOLDER_ID],
          }),
        }),
      );
    });

    it("prefers an existing Itinly folder over a stray legacy folder", async () => {
      // Both folders exist — a user manually created "Itinly" while a
      // legacy "TravelItineraryMaker" still sits next to it. We use
      // Itinly and leave the legacy folder alone.
      mockFilesList.mockImplementation((params: { q: string }) => {
        if (params.q.includes("'Itinly'")) {
          return {
            data: { files: [{ id: APP_FOLDER_ID, name: "Itinly" }] },
          };
        }
        if (params.q.includes("'TravelItineraryMaker'")) {
          return {
            data: {
              files: [{ id: LEGACY_FOLDER_ID, name: "TravelItineraryMaker" }],
            },
          };
        }
        if (
          params.q.includes("trips") &&
          params.q.includes(APP_FOLDER_ID)
        ) {
          return { data: { files: [{ id: TRIPS_FOLDER_ID, name: "trips" }] } };
        }
        return { data: { files: [] } };
      });
      mockFilesCreate.mockReturnValue({ data: { id: "new-trip-file-id" } });

      const trip = makeTripJson();
      await storage.saveTrip(trip);

      // No rename — Itinly already existed. The legacy folder is
      // ignored entirely (no list call beyond the initial Itinly hit).
      expect(mockFilesUpdate).not.toHaveBeenCalledWith(
        expect.objectContaining({ fileId: LEGACY_FOLDER_ID }),
      );
    });

    it("falls back to the legacy folder ID if the rename API call fails", async () => {
      // Legacy folder exists, Itinly does not, but files.update throws.
      // The implementation should swallow the error and still return
      // the legacy folder ID so the request succeeds. The next request
      // will retry the rename.
      mockFilesList.mockImplementation((params: { q: string }) => {
        if (params.q.includes("'Itinly'")) {
          return { data: { files: [] } };
        }
        if (params.q.includes("'TravelItineraryMaker'")) {
          return {
            data: {
              files: [{ id: LEGACY_FOLDER_ID, name: "TravelItineraryMaker" }],
            },
          };
        }
        if (
          params.q.includes("trips") &&
          params.q.includes(LEGACY_FOLDER_ID)
        ) {
          return { data: { files: [{ id: TRIPS_FOLDER_ID, name: "trips" }] } };
        }
        return { data: { files: [] } };
      });
      mockFilesUpdate.mockRejectedValueOnce(new Error("transient API error"));
      mockFilesCreate.mockReturnValue({ data: { id: "new-trip-file-id" } });

      const trip = makeTripJson();
      await expect(storage.saveTrip(trip)).resolves.not.toThrow();

      // Trip still landed in the trips subfolder under the legacy ID.
      expect(mockFilesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            name: "trip-1.json",
            parents: [TRIPS_FOLDER_ID],
          }),
        }),
      );
    });
  });
});
