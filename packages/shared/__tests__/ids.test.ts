import { generateId } from "../src/utils/ids";

describe("generateId", () => {
  it("returns a non-empty string", () => {
    const id = generateId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("contains exactly one hyphen separator", () => {
    const id = generateId();
    const parts = id.split("-");
    expect(parts).toHaveLength(2);
  });

  it("uses base36 characters in both parts", () => {
    const id = generateId();
    const [timestamp, random] = id.split("-");
    expect(timestamp).toMatch(/^[0-9a-z]+$/);
    expect(random).toMatch(/^[0-9a-z]+$/);
  });

  it("generates unique IDs across many calls", () => {
    const ids = new Set(Array.from({ length: 200 }, generateId));
    expect(ids.size).toBe(200);
  });

  it("timestamp part reflects roughly current time in base36", () => {
    const before = Date.now().toString(36);
    const id = generateId();
    const after = Date.now().toString(36);
    const [timestamp] = id.split("-");
    // Timestamp portion should be between before and after
    expect(timestamp >= before).toBe(true);
    expect(timestamp <= after).toBe(true);
  });
});
