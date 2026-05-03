import { hashSubject, senderDomain } from "../../src/services/email-telemetry";

describe("email-telemetry helpers", () => {
  describe("hashSubject", () => {
    it("returns 'unknown' for empty / undefined input", () => {
      expect(hashSubject(undefined)).toBe("unknown");
      expect(hashSubject("")).toBe("unknown");
      expect(hashSubject("   ")).toBe("unknown");
    });

    it("produces a stable 12-char hex hash", () => {
      const a = hashSubject("Your flight is confirmed");
      const b = hashSubject("Your flight is confirmed");
      expect(a).toBe(b);
      expect(a).toMatch(/^[0-9a-f]{12}$/);
    });

    it("produces different hashes for different subjects", () => {
      expect(hashSubject("A")).not.toBe(hashSubject("B"));
    });
  });

  describe("senderDomain", () => {
    it("returns 'unknown' for falsy input", () => {
      expect(senderDomain(undefined)).toBe("unknown");
      expect(senderDomain("")).toBe("unknown");
    });

    it("extracts the domain from a bare email address", () => {
      expect(senderDomain("user@example.com")).toBe("example.com");
    });

    it("extracts the domain from a display-name From header", () => {
      expect(senderDomain('"Foo Bar" <foo@bar.example>')).toBe("bar.example");
    });

    it("lowercases the domain", () => {
      expect(senderDomain("user@EXAMPLE.COM")).toBe("example.com");
    });

    it("returns 'unknown' when no @ is present", () => {
      expect(senderDomain("just a name")).toBe("unknown");
    });

    it("strips trailing whitespace / quoting", () => {
      expect(senderDomain("user@example.com   ")).toBe("example.com");
      expect(senderDomain('user@example.com"')).toBe("example.com");
    });
  });
});
