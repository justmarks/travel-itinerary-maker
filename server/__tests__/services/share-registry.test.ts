import { ShareRegistry } from "../../src/services/share-registry";

describe("ShareRegistry", () => {
  let registry: ShareRegistry;

  const makeShare = (overrides: {
    shareToken: string;
    tripId: string;
    ownerUserId: string;
    sharedWithEmail?: string;
    permission?: "view" | "edit";
    ownerEmail?: string;
    showCosts?: boolean;
    showTodos?: boolean;
  }) => ({
    permission: "view" as const,
    showCosts: true,
    showTodos: true,
    ...overrides,
  });

  beforeEach(() => {
    registry = new ShareRegistry();
  });

  it("registers and looks up a share token", () => {
    registry.register(
      makeShare({ shareToken: "token-abc", tripId: "trip-1", ownerUserId: "user-1" }),
    );
    const entry = registry.lookup("token-abc");
    expect(entry).toBeDefined();
    expect(entry!.tripId).toBe("trip-1");
    expect(entry!.ownerUserId).toBe("user-1");
    expect(entry!.permission).toBe("view");
  });

  it("returns undefined for unknown tokens", () => {
    expect(registry.lookup("nonexistent")).toBeUndefined();
  });

  it("removes a single token", () => {
    registry.register(
      makeShare({ shareToken: "token-abc", tripId: "trip-1", ownerUserId: "user-1" }),
    );
    registry.remove("token-abc");
    expect(registry.lookup("token-abc")).toBeUndefined();
  });

  it("removes all tokens for a trip", () => {
    registry.register(makeShare({ shareToken: "token-1", tripId: "trip-1", ownerUserId: "user-1" }));
    registry.register(makeShare({ shareToken: "token-2", tripId: "trip-1", ownerUserId: "user-1" }));
    registry.register(makeShare({ shareToken: "token-3", tripId: "trip-2", ownerUserId: "user-1" }));

    registry.removeByTrip("trip-1");

    expect(registry.lookup("token-1")).toBeUndefined();
    expect(registry.lookup("token-2")).toBeUndefined();
    expect(registry.lookup("token-3")).toBeDefined();
  });

  it("clears all entries", () => {
    registry.register(makeShare({ shareToken: "token-1", tripId: "trip-1", ownerUserId: "user-1" }));
    registry.register(makeShare({ shareToken: "token-2", tripId: "trip-2", ownerUserId: "user-2" }));
    registry.clear();
    expect(registry.lookup("token-1")).toBeUndefined();
    expect(registry.lookup("token-2")).toBeUndefined();
  });

  describe("email index", () => {
    it("looks up shares by recipient email (case-insensitive)", () => {
      registry.register(
        makeShare({
          shareToken: "t-1",
          tripId: "trip-1",
          ownerUserId: "alice",
          sharedWithEmail: "Bob@example.com",
          permission: "edit",
        }),
      );
      registry.register(
        makeShare({
          shareToken: "t-2",
          tripId: "trip-2",
          ownerUserId: "carol",
          sharedWithEmail: "bob@example.com",
        }),
      );
      registry.register(
        makeShare({
          shareToken: "t-3",
          tripId: "trip-3",
          ownerUserId: "alice",
          sharedWithEmail: "dave@example.com",
        }),
      );

      const shares = registry.lookupByEmail("BOB@example.com");
      expect(shares.map((s) => s.shareToken).sort()).toEqual(["t-1", "t-2"]);
    });

    it("ignores shares without a recipient email (link-only shares)", () => {
      registry.register(
        makeShare({ shareToken: "open", tripId: "trip-1", ownerUserId: "alice" }),
      );
      expect(registry.lookupByEmail("anyone@example.com")).toEqual([]);
    });

    it("removes the email-index entry when a share is revoked", () => {
      registry.register(
        makeShare({
          shareToken: "t-1",
          tripId: "trip-1",
          ownerUserId: "alice",
          sharedWithEmail: "bob@example.com",
        }),
      );
      registry.remove("t-1");
      expect(registry.lookupByEmail("bob@example.com")).toEqual([]);
    });

    it("removes the email-index entry when removeByTrip cascades", () => {
      registry.register(
        makeShare({
          shareToken: "t-1",
          tripId: "trip-1",
          ownerUserId: "alice",
          sharedWithEmail: "bob@example.com",
        }),
      );
      registry.removeByTrip("trip-1");
      expect(registry.lookupByEmail("bob@example.com")).toEqual([]);
    });

    it("re-registering a token swaps the email index", () => {
      registry.register(
        makeShare({
          shareToken: "t-1",
          tripId: "trip-1",
          ownerUserId: "alice",
          sharedWithEmail: "old@example.com",
        }),
      );
      registry.register(
        makeShare({
          shareToken: "t-1",
          tripId: "trip-1",
          ownerUserId: "alice",
          sharedWithEmail: "new@example.com",
        }),
      );
      expect(registry.lookupByEmail("old@example.com")).toEqual([]);
      expect(registry.lookupByEmail("new@example.com")).toHaveLength(1);
    });
  });
});
