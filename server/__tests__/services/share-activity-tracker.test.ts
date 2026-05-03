import { ShareActivityTracker } from "../../src/services/share-activity-tracker";

describe("ShareActivityTracker", () => {
  it("fires the first call for a (share, kind) pair", () => {
    const tracker = new ShareActivityTracker();
    expect(tracker.shouldFire("share-1", "view")).toBe(true);
  });

  it("blocks subsequent calls within the window", () => {
    const tracker = new ShareActivityTracker();
    tracker.shouldFire("share-1", "view");
    expect(tracker.shouldFire("share-1", "view")).toBe(false);
  });

  it("re-fires once the window elapses", () => {
    let nowMs = 1_000_000;
    const tracker = new ShareActivityTracker({
      windowMs: 30 * 60 * 1000,
      now: () => nowMs,
    });

    expect(tracker.shouldFire("share-1", "view")).toBe(true);
    nowMs += 30 * 60 * 1000 + 1;
    expect(tracker.shouldFire("share-1", "view")).toBe(true);
  });

  it("treats different kinds as independent buckets", () => {
    const tracker = new ShareActivityTracker();
    expect(tracker.shouldFire("share-1", "view")).toBe(true);
    expect(tracker.shouldFire("share-1", "edit")).toBe(true);
    // Both blocked second time
    expect(tracker.shouldFire("share-1", "view")).toBe(false);
    expect(tracker.shouldFire("share-1", "edit")).toBe(false);
  });

  it("treats different shares as independent buckets", () => {
    const tracker = new ShareActivityTracker();
    expect(tracker.shouldFire("share-1", "view")).toBe(true);
    expect(tracker.shouldFire("share-2", "view")).toBe(true);
  });

  it("clears all state on clear()", () => {
    const tracker = new ShareActivityTracker();
    tracker.shouldFire("share-1", "view");
    tracker.clear();
    expect(tracker.shouldFire("share-1", "view")).toBe(true);
  });
});
