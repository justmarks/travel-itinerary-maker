import type { TripShareRule } from "@itinly/shared";
import { InMemoryStorage } from "../../src/services/storage";
import { runStorageProviderContract } from "./contract";

describe("InMemoryStorage", () => {
  runStorageProviderContract({
    newStorage: () => new InMemoryStorage(),
  });

  // InMemoryStorage-specific debug helper, not part of the contract.
  describe("clear()", () => {
    it("empties trips, settings, processed emails, and share rules", async () => {
      const storage = new InMemoryStorage();
      const rule: TripShareRule = {
        id: "rule-1",
        ownerUserId: "u",
        ownerEmail: "o@example.com",
        sharedWithEmail: "g@example.com",
        permission: "view",
        showCosts: true,
        showTodos: true,
        createdAt: "2026-05-09T10:00:00.000Z",
        updatedAt: "2026-05-09T10:00:00.000Z",
      };
      await storage.saveShareRule(rule);
      await storage.saveSettings({
        emailScanIntervalMinutes: 30,
        notificationsEnabled: false,
      });
      storage.clear();

      expect(await storage.listShareRules()).toEqual([]);
      const settings = await storage.getSettings();
      expect(settings.emailScanIntervalMinutes).toBe(1440);
      expect(settings.notificationsEnabled).toBe(true);
    });
  });
});
