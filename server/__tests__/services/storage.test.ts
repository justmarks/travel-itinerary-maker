import type { TripShareRule } from "@travel-app/shared";
import { InMemoryStorage } from "../../src/services/storage";

describe("InMemoryStorage share rules", () => {
  let storage: InMemoryStorage;

  beforeEach(() => {
    storage = new InMemoryStorage();
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

  it("starts empty", async () => {
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

  it("returns deep clones — mutating the returned rule doesn't affect storage", async () => {
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

  it("clear() empties the rule map", async () => {
    await storage.saveShareRule(makeRule());
    storage.clear();
    expect(await storage.listShareRules()).toEqual([]);
  });
});
