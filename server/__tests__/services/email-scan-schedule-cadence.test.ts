import { computeNextRunAt } from "../../src/services/email-scan-schedule-cadence";

describe("computeNextRunAt", () => {
  describe("daily", () => {
    it("bumps 1 day from reference with no anchor (legacy behaviour)", () => {
      const ref = new Date("2026-05-14T18:00:00Z");
      const next = new Date(computeNextRunAt("daily", ref));
      expect(next.getTime() - ref.getTime()).toBe(24 * 60 * 60 * 1000);
    });

    it("fires today at the anchor when the anchor is still in the future", () => {
      const ref = new Date("2026-05-14T18:00:00Z");
      const next = new Date(
        computeNextRunAt("daily", ref, { timeOfDay: "21:30" }),
      );
      expect(next.toISOString()).toBe("2026-05-14T21:30:00.000Z");
    });

    it("rolls to tomorrow at the anchor when the anchor today has passed", () => {
      const ref = new Date("2026-05-14T18:00:00Z");
      const next = new Date(
        computeNextRunAt("daily", ref, { timeOfDay: "07:00" }),
      );
      expect(next.toISOString()).toBe("2026-05-15T07:00:00.000Z");
    });

    it("rolls to tomorrow when the anchor equals the reference exactly", () => {
      const ref = new Date("2026-05-14T07:00:00Z");
      const next = new Date(
        computeNextRunAt("daily", ref, { timeOfDay: "07:00" }),
      );
      // The current tick "owns" the anchor; the next firing has to be
      // tomorrow, otherwise the same row would fire twice in a row.
      expect(next.toISOString()).toBe("2026-05-15T07:00:00.000Z");
    });

    it("ignores malformed timeOfDay gracefully (falls back to flat bump)", () => {
      const ref = new Date("2026-05-14T18:00:00Z");
      const next = new Date(
        computeNextRunAt("daily", ref, { timeOfDay: "25:99" }),
      );
      expect(next.getTime() - ref.getTime()).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe("weekly", () => {
    it("bumps 7 days from reference with no anchor (legacy)", () => {
      const ref = new Date("2026-05-14T18:00:00Z"); // Thursday
      const next = new Date(computeNextRunAt("weekly", ref));
      expect(next.getTime() - ref.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it("fires on the next occurrence of dayOfWeek at the anchor time", () => {
      const ref = new Date("2026-05-14T18:00:00Z"); // Thursday
      // dayOfWeek 0 = Sunday → 3 days ahead at 09:00 UTC.
      const next = new Date(
        computeNextRunAt("weekly", ref, {
          dayOfWeek: 0,
          timeOfDay: "09:00",
        }),
      );
      expect(next.toISOString()).toBe("2026-05-17T09:00:00.000Z");
    });

    it("pushes a full week when the anchor day is today and the time has passed", () => {
      const ref = new Date("2026-05-14T18:00:00Z"); // Thursday 18:00 UTC
      const next = new Date(
        computeNextRunAt("weekly", ref, {
          dayOfWeek: 4, // Thursday
          timeOfDay: "07:00", // already past
        }),
      );
      expect(next.toISOString()).toBe("2026-05-21T07:00:00.000Z");
    });

    it("fires later today when the anchor day is today and time is in the future", () => {
      const ref = new Date("2026-05-14T08:00:00Z"); // Thursday 08:00 UTC
      const next = new Date(
        computeNextRunAt("weekly", ref, {
          dayOfWeek: 4, // Thursday
          timeOfDay: "20:00",
        }),
      );
      expect(next.toISOString()).toBe("2026-05-14T20:00:00.000Z");
    });

    it("with timeOfDay but no dayOfWeek, fires 7 days out at the anchor time", () => {
      const ref = new Date("2026-05-14T18:00:00Z");
      const next = new Date(
        computeNextRunAt("weekly", ref, { timeOfDay: "09:00" }),
      );
      // Thursday + 7 days = Thursday next week, at 09:00.
      expect(next.toISOString()).toBe("2026-05-21T09:00:00.000Z");
    });
  });

});
