/**
 * Reusable behavioural contract for `StorageProvider`. Every backend
 * (`InMemoryStorage`, future `SupabaseStorage`, transitional
 * `DriveStorage`) is parameterised through this suite so they're held
 * to identical semantics.
 *
 * Phase 0: only `InMemoryStorage` plugs in. Phase 1 adds `SupabaseStorage`
 * by re-using this exact suite — that's the contract that gates the
 * Drive→Supabase switch.
 */
import {
  CURRENT_TRIP_SCHEMA_VERSION,
  type Trip,
  type TripShareRule,
  type UserSettings,
} from "@travel-app/shared";
import type { StorageProvider } from "../../src/services/storage";
import type { ProcessedEmail } from "../../src/services/google-drive/drive-storage";

export interface ContractHarness {
  /**
   * Returns a fresh, empty `StorageProvider`. Called once per test —
   * the provider must not retain state between calls.
   */
  newStorage: () => Promise<StorageProvider> | StorageProvider;
  /**
   * Optional teardown hook. Called after each test. Useful for backends
   * that own external resources (DB connections, ephemeral schemas).
   */
  teardown?: (storage: StorageProvider) => Promise<void> | void;
}

const makeTrip = (overrides: Partial<Trip> = {}): Trip => ({
  id: "trip-1",
  title: "Test Trip",
  startDate: "2026-06-01",
  endDate: "2026-06-05",
  status: "planning",
  days: [],
  todos: [],
  shares: [],
  history: [],
  createdAt: "2026-05-09T10:00:00.000Z",
  updatedAt: "2026-05-09T10:00:00.000Z",
  schemaVersion: CURRENT_TRIP_SCHEMA_VERSION,
  ...overrides,
});

const makeRule = (overrides: Partial<TripShareRule> = {}): TripShareRule => ({
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
});

const makeEmail = (overrides: Partial<ProcessedEmail> = {}): ProcessedEmail => ({
  gmailMessageId: "msg-1",
  parseStatus: "parsed",
  createdAt: "2026-05-09T10:00:00.000Z",
  ...overrides,
});

export function runStorageProviderContract(harness: ContractHarness): void {
  let storage: StorageProvider;

  beforeEach(async () => {
    storage = await harness.newStorage();
  });

  afterEach(async () => {
    if (harness.teardown) await harness.teardown(storage);
  });

  describe("trips", () => {
    it("listTrips starts empty", async () => {
      expect(await storage.listTrips()).toEqual([]);
    });

    it("saves and retrieves a trip by id", async () => {
      await storage.saveTrip(makeTrip());
      const trip = await storage.getTrip("trip-1");
      expect(trip?.title).toBe("Test Trip");
    });

    it("getTrip returns null when missing", async () => {
      expect(await storage.getTrip("nope")).toBeNull();
    });

    it("listTrips returns trips sorted by startDate descending", async () => {
      await storage.saveTrip(
        makeTrip({ id: "old", startDate: "2025-01-01", endDate: "2025-01-05" }),
      );
      await storage.saveTrip(
        makeTrip({ id: "new", startDate: "2027-01-01", endDate: "2027-01-05" }),
      );
      await storage.saveTrip(
        makeTrip({ id: "mid", startDate: "2026-06-01", endDate: "2026-06-05" }),
      );
      const trips = await storage.listTrips();
      expect(trips.map((t) => t.id)).toEqual(["new", "mid", "old"]);
    });

    it("saveTrip overwrites by id", async () => {
      await storage.saveTrip(makeTrip({ title: "Original" }));
      await storage.saveTrip(makeTrip({ title: "Updated" }));
      expect((await storage.getTrip("trip-1"))?.title).toBe("Updated");
    });

    it("returns deep clones — mutating retrieved trip doesn't affect storage", async () => {
      await storage.saveTrip(makeTrip());
      const trip = (await storage.getTrip("trip-1"))!;
      trip.title = "Mutated";

      const fresh = await storage.getTrip("trip-1");
      expect(fresh?.title).toBe("Test Trip");
    });

    it("stores a deep clone — later mutation of input doesn't change stored value", async () => {
      const input = makeTrip({ title: "Initial" });
      await storage.saveTrip(input);
      input.title = "Mutated after save";

      const fresh = await storage.getTrip("trip-1");
      expect(fresh?.title).toBe("Initial");
    });

    it("deleteTrip returns true on hit, false on miss", async () => {
      await storage.saveTrip(makeTrip());
      expect(await storage.deleteTrip("trip-1")).toBe(true);
      expect(await storage.deleteTrip("trip-1")).toBe(false);
      expect(await storage.getTrip("trip-1")).toBeNull();
    });

    it("listTrips reflects deletion", async () => {
      await storage.saveTrip(makeTrip({ id: "a" }));
      await storage.saveTrip(makeTrip({ id: "b" }));
      await storage.deleteTrip("a");
      const trips = await storage.listTrips();
      expect(trips.map((t) => t.id)).toEqual(["b"]);
    });
  });

  describe("settings", () => {
    it("returns sensible defaults before any save", async () => {
      const settings = await storage.getSettings();
      expect(settings.emailScanIntervalMinutes).toBeGreaterThan(0);
      expect(typeof settings.notificationsEnabled).toBe("boolean");
    });

    it("persists and retrieves saved settings", async () => {
      const next: UserSettings = {
        emailScanIntervalMinutes: 60,
        notificationsEnabled: false,
        gmailLabelFilter: "Travel",
      };
      await storage.saveSettings(next);
      expect(await storage.getSettings()).toEqual(next);
    });

    it("saveSettings overwrites previous values", async () => {
      await storage.saveSettings({
        emailScanIntervalMinutes: 30,
        notificationsEnabled: true,
      });
      await storage.saveSettings({
        emailScanIntervalMinutes: 90,
        notificationsEnabled: false,
      });
      const settings = await storage.getSettings();
      expect(settings.emailScanIntervalMinutes).toBe(90);
      expect(settings.notificationsEnabled).toBe(false);
    });

    it("returns deep clone — mutation doesn't affect storage", async () => {
      await storage.saveSettings({
        emailScanIntervalMinutes: 60,
        notificationsEnabled: true,
      });
      const settings = await storage.getSettings();
      settings.emailScanIntervalMinutes = 999;

      const fresh = await storage.getSettings();
      expect(fresh.emailScanIntervalMinutes).toBe(60);
    });
  });

  describe("processed emails", () => {
    it("starts empty", async () => {
      expect(await storage.getProcessedEmails()).toEqual([]);
    });

    it("persists and retrieves emails", async () => {
      const emails = [
        makeEmail({ gmailMessageId: "a" }),
        makeEmail({ gmailMessageId: "b", parseStatus: "failed" }),
      ];
      await storage.saveProcessedEmails(emails);
      expect(await storage.getProcessedEmails()).toEqual(emails);
    });

    it("saveProcessedEmails replaces the previous list", async () => {
      await storage.saveProcessedEmails([makeEmail({ gmailMessageId: "a" })]);
      await storage.saveProcessedEmails([makeEmail({ gmailMessageId: "b" })]);
      const fresh = await storage.getProcessedEmails();
      expect(fresh.map((e) => e.gmailMessageId)).toEqual(["b"]);
    });

    it("returns deep clones — mutation doesn't affect storage", async () => {
      await storage.saveProcessedEmails([makeEmail()]);
      const list = await storage.getProcessedEmails();
      list[0].parseStatus = "failed";

      const fresh = await storage.getProcessedEmails();
      expect(fresh[0].parseStatus).toBe("parsed");
    });
  });

  describe("share rules", () => {
    it("listShareRules starts empty", async () => {
      expect(await storage.listShareRules()).toEqual([]);
    });

    it("saves and lists rules sorted by createdAt", async () => {
      await storage.saveShareRule(
        makeRule({ id: "rule-b", createdAt: "2026-05-09T11:00:00.000Z" }),
      );
      await storage.saveShareRule(
        makeRule({ id: "rule-a", createdAt: "2026-05-09T10:00:00.000Z" }),
      );
      const rules = await storage.listShareRules();
      expect(rules.map((r) => r.id)).toEqual(["rule-a", "rule-b"]);
    });

    it("getShareRule returns null when missing", async () => {
      expect(await storage.getShareRule("nope")).toBeNull();
    });

    it("getShareRule returns the saved rule", async () => {
      await storage.saveShareRule(makeRule());
      const rule = await storage.getShareRule("rule-1");
      expect(rule?.sharedWithEmail).toBe("guest@example.com");
    });

    it("returns deep clones — mutating retrieved rule doesn't affect storage", async () => {
      await storage.saveShareRule(makeRule());
      const rule = (await storage.getShareRule("rule-1"))!;
      rule.permission = "edit";

      const fresh = await storage.getShareRule("rule-1");
      expect(fresh?.permission).toBe("view");
    });

    it("saveShareRule overwrites by id", async () => {
      await storage.saveShareRule(makeRule({ permission: "view" }));
      await storage.saveShareRule(makeRule({ permission: "edit" }));
      expect((await storage.getShareRule("rule-1"))?.permission).toBe("edit");
    });

    it("deleteShareRule returns true on hit, false on miss", async () => {
      await storage.saveShareRule(makeRule());
      expect(await storage.deleteShareRule("rule-1")).toBe(true);
      expect(await storage.deleteShareRule("rule-1")).toBe(false);
      expect(await storage.getShareRule("rule-1")).toBeNull();
    });
  });
}
