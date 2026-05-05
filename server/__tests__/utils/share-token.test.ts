import { generateShareToken } from "../../src/utils/share-token";

describe("generateShareToken", () => {
  it("returns a URL-safe base64 string", () => {
    const token = generateShareToken();
    // base64url alphabet: A-Z, a-z, 0-9, '-', '_'. No '+', '/', or '='.
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("encodes 32 random bytes (43 base64url chars)", () => {
    // 32 bytes → ceil(32 * 4 / 3) = 43 chars (no padding in base64url).
    const token = generateShareToken();
    expect(token).toHaveLength(43);
  });

  it("produces unique tokens across calls", () => {
    // 256 bits of entropy — collision probability across 1k tokens is
    // ~10^-71. If this fails we have a bug, not bad luck.
    const tokens = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      tokens.add(generateShareToken());
    }
    expect(tokens.size).toBe(1000);
  });

  it("does not include path-breaking URL characters", () => {
    // Run a batch so we actually exercise the alphabet, not a single
    // happy-path token.
    for (let i = 0; i < 100; i++) {
      const token = generateShareToken();
      expect(token).not.toMatch(/[+/=?#&]/);
    }
  });
});
