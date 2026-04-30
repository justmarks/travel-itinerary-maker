import { ShareSnapshotStore } from "../../src/services/share-snapshot-store";
import type { RedisStore } from "../../src/services/redis-store";

function createMockRedis(): jest.Mocked<RedisStore> {
  return {
    hgetall: jest.fn().mockResolvedValue({}),
    hset: jest.fn().mockResolvedValue(undefined),
    hdel: jest.fn().mockResolvedValue(undefined),
  };
}

const sampleSnapshot = {
  title: "Iceland Ring Road",
  startDate: "2025-06-01",
  endDate: "2025-06-10",
  dayCount: 10,
};

describe("ShareSnapshotStore", () => {
  describe("without Redis configured", () => {
    it("set is a silent no-op", () => {
      const store = new ShareSnapshotStore(null);
      expect(() => store.set("token-abc", sampleSnapshot)).not.toThrow();
    });

    it("delete is a silent no-op", () => {
      const store = new ShareSnapshotStore(null);
      expect(() => store.delete("token-abc")).not.toThrow();
    });

    it("deleteMany is a silent no-op", () => {
      const store = new ShareSnapshotStore(null);
      expect(() => store.deleteMany(["a", "b"])).not.toThrow();
    });
  });

  describe("with Redis configured", () => {
    let redis: jest.Mocked<RedisStore>;
    let store: ShareSnapshotStore;

    beforeEach(() => {
      redis = createMockRedis();
      store = new ShareSnapshotStore(redis);
    });

    it("set writes the snapshot to the share-snapshots hash", async () => {
      store.set("token-abc", sampleSnapshot);
      // Writes are fire-and-forget; flush microtasks before asserting.
      await new Promise((resolve) => setImmediate(resolve));
      expect(redis.hset).toHaveBeenCalledWith(
        "share-snapshots",
        "token-abc",
        sampleSnapshot,
      );
    });

    it("delete removes the snapshot from the hash", async () => {
      store.delete("token-abc");
      await new Promise((resolve) => setImmediate(resolve));
      expect(redis.hdel).toHaveBeenCalledWith("share-snapshots", "token-abc");
    });

    it("deleteMany removes each token from the hash", async () => {
      store.deleteMany(["a", "b", "c"]);
      await new Promise((resolve) => setImmediate(resolve));
      expect(redis.hdel).toHaveBeenCalledTimes(3);
      expect(redis.hdel).toHaveBeenCalledWith("share-snapshots", "a");
      expect(redis.hdel).toHaveBeenCalledWith("share-snapshots", "b");
      expect(redis.hdel).toHaveBeenCalledWith("share-snapshots", "c");
    });

    it("deleteMany with an empty array makes no Redis calls", async () => {
      store.deleteMany([]);
      await new Promise((resolve) => setImmediate(resolve));
      expect(redis.hdel).not.toHaveBeenCalled();
    });

    it("set swallows Redis errors and logs a warning", async () => {
      redis.hset.mockRejectedValueOnce(new Error("redis down"));
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      store.set("token-abc", sampleSnapshot);
      await new Promise((resolve) => setImmediate(resolve));
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it("delete swallows Redis errors and logs a warning", async () => {
      redis.hdel.mockRejectedValueOnce(new Error("redis down"));
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      store.delete("token-abc");
      await new Promise((resolve) => setImmediate(resolve));
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
