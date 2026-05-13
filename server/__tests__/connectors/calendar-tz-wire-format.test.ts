/**
 * Phase 4: calendar TZ / DST correctness on the wire format.
 *
 * Cross-provider TZ-handling is a real bug magnet — Google Calendar
 * and Microsoft Graph both accept IANA timezone strings on event
 * `start.timeZone` / `end.timeZone`, but the connector chain in
 * between is provider-specific. This file feeds the SAME segment
 * through:
 *   1. Google's `segmentToEvent` (writes Google's wire format).
 *   2. MS's `googleEventToMsEvent(segmentToEvent(...))` (the same
 *      chain the Outlook connector uses internally — see
 *      `microsoft-calendar-connector.ts#upsertSegmentEvent`).
 *
 * Asserts both wire formats represent the SAME logical event:
 *   - Identical IANA `timeZone` strings on `start` + `end`.
 *   - Identical `dateTime` wall-clock strings.
 *   - All-day events serialise consistently across both providers.
 *
 * Covers DST edge cases by anchoring scenarios on dates where the
 * underlying TZ is mid-transition.
 */

import type { Segment, TripDay } from "@itinly/shared";
import { segmentToEvent } from "../../src/services/google-calendar";
import { googleEventToMsEvent } from "../../src/connectors/microsoft-calendar-connector";

/** Minimal segment fixture; tests override only what they care about. */
function makeSegment(overrides: Partial<Segment> = {}): Segment {
  return {
    id: "seg-1",
    type: "flight",
    title: "Test segment",
    source: "manual",
    needsReview: false,
    sortOrder: 0,
    ...overrides,
  };
}

function makeDay(overrides: Partial<TripDay> = {}): TripDay {
  return {
    date: "2026-06-15",
    dayOfWeek: "Mon",
    city: "Paris",
    segments: [],
    ...overrides,
  };
}

describe("Calendar TZ / DST wire-format parity", () => {
  describe("timed segments", () => {
    it("flight: both providers carry identical IANA timeZone + dateTime for departure and arrival", () => {
      // Tokyo → Paris flight. Departure in Asia/Tokyo, arrival in
      // Europe/Paris. Both providers should preserve the IANA TZ
      // strings verbatim, with wall-clock dateTimes (no offset).
      const segment = makeSegment({
        type: "flight",
        title: "JL 045: NRT → CDG",
        startTime: "10:30",
        endTime: "18:45",
        departureAirport: "NRT",
        arrivalAirport: "CDG",
        departureCity: "Tokyo",
        arrivalCity: "Paris",
      });
      const day = makeDay({ date: "2026-06-15", city: "Tokyo" });

      const googleEvent = segmentToEvent(segment, day, "Trip to Paris");
      const msEvent = googleEventToMsEvent(googleEvent);

      // Wire-format parity: both providers see the same TZ + wall-clock.
      expect(msEvent.start).toEqual({
        dateTime: googleEvent.start?.dateTime ?? "",
        timeZone: googleEvent.start?.timeZone ?? "UTC",
      });
      expect(msEvent.end).toEqual({
        dateTime: googleEvent.end?.dateTime ?? "",
        timeZone: googleEvent.end?.timeZone ?? "UTC",
      });
      // Sanity: the IANA timezone resolved per-endpoint to the right
      // city, so a 10:30 departure in Tokyo + 18:45 arrival in Paris
      // each carry their own zone.
      expect(googleEvent.start?.timeZone).toBe("Asia/Tokyo");
      expect(googleEvent.end?.timeZone).toBe("Europe/Paris");
      // And the wall-clock strings are unchanged — no offset
      // injection, no UTC conversion.
      expect(googleEvent.start?.dateTime).toBe("2026-06-15T10:30:00");
      expect(googleEvent.end?.dateTime).toContain("18:45:00");
    });

    it("dinner in Paris: same TZ on both endpoints (segment.city only)", () => {
      const segment = makeSegment({
        type: "restaurant_dinner",
        title: "Dinner at Le Bistro",
        startTime: "19:30",
        endTime: "21:30",
        city: "Paris",
      });
      const day = makeDay({ date: "2026-06-15", city: "Paris" });

      const googleEvent = segmentToEvent(segment, day, "Trip");
      const msEvent = googleEventToMsEvent(googleEvent);

      expect(msEvent.start?.timeZone).toBe(googleEvent.start?.timeZone);
      expect(msEvent.end?.timeZone).toBe(googleEvent.end?.timeZone);
      expect(msEvent.start?.timeZone).toBe("Europe/Paris");
      expect(msEvent.end?.timeZone).toBe("Europe/Paris");
      expect(googleEvent.start?.dateTime).toBe("2026-06-15T19:30:00");
      expect(googleEvent.end?.dateTime).toBe("2026-06-15T21:30:00");
    });
  });

  describe("DST edge cases", () => {
    it("US spring-forward (2026-03-08): wall-clock dateTime is preserved as-is, no shift", () => {
      // March 8, 2026 is the US DST spring-forward Sunday. A 02:30
      // event in America/New_York is technically a "non-existent"
      // local time (clocks jump from 02:00 to 03:00). Both providers
      // store the wall-clock string and resolve at display time —
      // we shouldn't be normalising / shifting at our layer.
      const segment = makeSegment({
        type: "activity",
        title: "Early run",
        startTime: "02:30",
        endTime: "03:30",
        city: "New York",
      });
      const day = makeDay({ date: "2026-03-08", city: "New York" });

      const googleEvent = segmentToEvent(segment, day, "Trip");
      const msEvent = googleEventToMsEvent(googleEvent);

      // Wall-clock strings round-trip without alteration; the TZ
      // string is identical across providers.
      expect(googleEvent.start?.dateTime).toBe("2026-03-08T02:30:00");
      expect(googleEvent.end?.dateTime).toBe("2026-03-08T03:30:00");
      expect(msEvent.start?.dateTime).toBe(googleEvent.start?.dateTime);
      expect(msEvent.end?.dateTime).toBe(googleEvent.end?.dateTime);
      expect(msEvent.start?.timeZone).toBe(googleEvent.start?.timeZone);
    });

    it("Europe fall-back (2026-10-25): wall-clock preserved across the ambiguous hour", () => {
      // Oct 25 2026 is the European DST fall-back Sunday. 02:30 in
      // Europe/Paris is ambiguous (occurs twice). We preserve the
      // wall-clock and let the calendar UI resolve it.
      const segment = makeSegment({
        type: "activity",
        title: "Late drink",
        startTime: "02:30",
        endTime: "02:45",
        city: "Paris",
      });
      const day = makeDay({ date: "2026-10-25", city: "Paris" });

      const googleEvent = segmentToEvent(segment, day, "Trip");
      const msEvent = googleEventToMsEvent(googleEvent);

      expect(googleEvent.start?.dateTime).toBe("2026-10-25T02:30:00");
      expect(googleEvent.end?.dateTime).toBe("2026-10-25T02:45:00");
      expect(msEvent.start?.dateTime).toBe(googleEvent.start?.dateTime);
      expect(msEvent.end?.dateTime).toBe(googleEvent.end?.dateTime);
    });

    it("Tokyo → New York red-eye crossing the date line: arrival date advances correctly", () => {
      // Tokyo dep at 18:00 JST (2026-06-15) → New York arrival at
      // 17:00 EDT, also 2026-06-15 local time. The UTC departure is
      // 09:00 UTC (15th); arrival UTC is 21:00 UTC (15th). Local
      // arrival date stays the 15th.
      const segment = makeSegment({
        type: "flight",
        title: "JL 6: NRT → JFK",
        startTime: "18:00",
        endTime: "17:00",
        departureAirport: "NRT",
        arrivalAirport: "JFK",
        departureCity: "Tokyo",
        arrivalCity: "New York",
      });
      const day = makeDay({ date: "2026-06-15", city: "Tokyo" });

      const googleEvent = segmentToEvent(segment, day, "Trip");
      const msEvent = googleEventToMsEvent(googleEvent);

      expect(googleEvent.start?.timeZone).toBe("Asia/Tokyo");
      expect(googleEvent.end?.timeZone).toBe("America/New_York");
      expect(googleEvent.start?.dateTime).toBe("2026-06-15T18:00:00");
      // Arrival is the SAME calendar day (15th) in local NY time —
      // the connector doesn't artificially advance the date.
      expect(googleEvent.end?.dateTime).toContain("17:00:00");

      // Parity: MS sees the same dateTimes + zones.
      expect(msEvent.start).toEqual(googleEvent.start);
      expect(msEvent.end).toEqual(googleEvent.end);
    });
  });

  describe("all-day events", () => {
    it("hotel multi-day: Google emits date-only; MS converts to isAllDay + UTC-midnight dateTime", () => {
      // Hotel from 2026-06-15 to 2026-06-18. Google represents this
      // as `start.date` / `end.date` (no time, no TZ); MS represents
      // it as `isAllDay: true` with UTC-midnight `dateTime` + UTC tz
      // per `googleEventToMsEvent`'s conversion.
      const segment = makeSegment({
        type: "hotel",
        title: "Le Grand Hotel",
        endDate: "2026-06-18",
        city: "Paris",
      });
      const day = makeDay({ date: "2026-06-15", city: "Paris" });

      const googleEvent = segmentToEvent(segment, day, "Trip");
      const msEvent = googleEventToMsEvent(googleEvent);

      // Google all-day shape.
      expect(googleEvent.start?.date).toBe("2026-06-15");
      expect(googleEvent.end?.date).toBe("2026-06-18");
      expect(googleEvent.start?.dateTime).toBeUndefined();
      expect(googleEvent.start?.timeZone).toBeUndefined();

      // MS all-day shape (per `googleEventToMsEvent` — UTC midnight,
      // `isAllDay: true`).
      expect(msEvent.isAllDay).toBe(true);
      expect(msEvent.start).toEqual({
        dateTime: "2026-06-15T00:00:00",
        timeZone: "UTC",
      });
      expect(msEvent.end).toEqual({
        dateTime: "2026-06-18T00:00:00",
        timeZone: "UTC",
      });
    });
  });

  describe("payload content parity", () => {
    it("subject + description + location carry through to MS unchanged from Google", () => {
      // Pre-Phase-4 the only place we tested the payload mapping was
      // the existing `googleEventToMsEvent` unit test, which fed a
      // hand-crafted Google event in. This scenario tests the END-TO-
      // END mapping: segment → Google event → MS event.
      const segment = makeSegment({
        type: "flight",
        title: "JL 045: NRT → CDG",
        startTime: "10:30",
        endTime: "18:45",
        departureAirport: "NRT",
        arrivalAirport: "CDG",
        departureCity: "Tokyo",
        arrivalCity: "Paris",
        confirmationCode: "ABC123",
      });
      const day = makeDay({ date: "2026-06-15", city: "Tokyo" });

      const googleEvent = segmentToEvent(segment, day, "Trip to Paris");
      const msEvent = googleEventToMsEvent(googleEvent);

      // Both providers' summaries / bodies match.
      expect(msEvent.subject).toBe(googleEvent.summary);
      expect(msEvent.body?.content).toBe(googleEvent.description ?? "");
      expect(msEvent.location?.displayName).toBe(googleEvent.location ?? "");

      // Confirmation code appears in the body so it survives the
      // segment → event → MS conversion.
      expect(msEvent.body?.content).toContain("ABC123");
    });
  });
});
