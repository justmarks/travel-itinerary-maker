import { ShareRegistry } from "../../src/services/share-registry";

describe("ShareRegistry", () => {
  let registry: ShareRegistry;

  beforeEach(() => {
    registry = new ShareRegistry();
  });

  it("registers and looks up a share token", () => {
    registry.register("token-abc", "trip-1", "user-1");
    const entry = registry.lookup("token-abc");
    expect(entry).toBeDefined();
    expect(entry!.tripId).toBe("trip-1");
    expect(entry!.ownerUserId).toBe("user-1");
  });

  it("returns undefined for unknown tokens", () => {
    expect(registry.lookup("nonexistent")).toBeUndefined();
  });

  it("removes a single token", () => {
    registry.register("token-abc", "trip-1", "user-1");
    registry.remove("token-abc");
    expect(registry.lookup("token-abc")).toBeUndefined();
  });

  it("removes all tokens for a trip", () => {
    registry.register("token-1", "trip-1", "user-1");
    registry.register("token-2", "trip-1", "user-1");
    registry.register("token-3", "trip-2", "user-1");

    registry.removeByTrip("trip-1");

    expect(registry.lookup("token-1")).toBeUndefined();
    expect(registry.lookup("token-2")).toBeUndefined();
    expect(registry.lookup("token-3")).toBeDefined();
  });

  it("clears all entries", () => {
    registry.register("token-1", "trip-1", "user-1");
    registry.register("token-2", "trip-2", "user-2");
    registry.clear();
    expect(registry.lookup("token-1")).toBeUndefined();
    expect(registry.lookup("token-2")).toBeUndefined();
  });
});
