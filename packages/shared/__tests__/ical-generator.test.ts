import { tripToIcal } from "../src/utils/ical-generator";
import type { Trip } from "../src/types/trip";

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip1",
    title: "Test Trip",
    startDate: "2026-06-10",
    endDate: "2026-06-12",
    schemaVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    days: [],
    ...overrides,
  };
}

describe("tripToIcal", () => {
  it("produces a valid VCALENDAR wrapper with CRLF endings", () => {
    const ics = tripToIcal(makeTrip());
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics).toMatch(/END:VCALENDAR\r\n$/);
    expect(ics).toContain("VERSION:2.0\r\n");
    expect(ics).toContain("CALSCALE:GREGORIAN\r\n");
    expect(ics).toContain("X-WR-CALNAME:Test Trip\r\n");
  });

  it("emits a VEVENT for a flight segment with TZID on DTSTART and DTEND", () => {
    const trip = makeTrip({
      days: [
        {
          date: "2026-06-10",
          dayOfWeek: "Wed",
          city: "Paris",
          segments: [
            {
              id: "seg1",
              type: "flight",
              title: "CDG → JFK",
              departureCity: "Paris",
              arrivalCity: "New York",
              carrier: "Air France",
              routeCode: "AF001",
              startTime: "10:00",
              endTime: "14:00",
              confirmationCode: "AFXYZ",
              source: "manual",
              needsReview: false,
              sortOrder: 0,
            },
          ],
        },
      ],
    });

    const ics = tripToIcal(trip);
    expect(ics).toContain("BEGIN:VEVENT\r\n");
    expect(ics).toContain("DTSTART;TZID=Europe/Paris:20260610T100000\r\n");
    expect(ics).toContain("DTEND;TZID=America/New_York:20260610T140000\r\n");
    expect(ics).toContain("Air France");
    expect(ics).toContain("AFXYZ");
    expect(ics).toContain("END:VEVENT\r\n");
  });

  it("emits an all-day VEVENT for a hotel, ignoring check-in/out times", () => {
    const trip = makeTrip({
      days: [
        {
          date: "2026-06-10",
          dayOfWeek: "Wed",
          city: "Paris",
          segments: [
            {
              id: "seg2",
              type: "hotel",
              title: "Hotel Lutetia",
              venueName: "Hotel Lutetia",
              startTime: "15:00",
              endTime: "11:00",
              endDate: "2026-06-13",
              source: "manual",
              needsReview: false,
              sortOrder: 0,
            },
          ],
        },
      ],
    });

    const ics = tripToIcal(trip);
    expect(ics).toContain("DTSTART;VALUE=DATE:20260610\r\n");
    expect(ics).toContain("DTEND;VALUE=DATE:20260613\r\n");
    expect(ics).not.toContain("T150000");
  });

  it("emits an all-day VEVENT for a car rental, spanning through the dropoff date", () => {
    // Pickup 2026-06-10, dropoff 2026-06-13. The event should be
    // visible across 6/10, 6/11, 6/12, AND 6/13 — DTEND on an all-day
    // VEVENT is exclusive, so DTEND = 6/14 makes the dropoff date
    // visible to the user.
    const trip = makeTrip({
      days: [
        {
          date: "2026-06-10",
          dayOfWeek: "Wed",
          city: "Kyoto",
          segments: [
            {
              id: "seg2b",
              type: "car_rental",
              title: "Hertz - Kyoto",
              provider: "Hertz",
              departureCity: "Kyoto",
              arrivalCity: "Kyoto",
              address: "12 Karasuma-dori, Kyoto",
              startTime: "15:00",
              endTime: "10:00",
              endDate: "2026-06-13",
              confirmationCode: "ABC123",
              source: "manual",
              needsReview: false,
              sortOrder: 0,
            },
          ],
        },
      ],
    });

    const ics = tripToIcal(trip);
    expect(ics).toContain("DTSTART;VALUE=DATE:20260610\r\n");
    // DTEND is exclusive — 6/14 makes the rental visible through 6/13.
    expect(ics).toContain("DTEND;VALUE=DATE:20260614\r\n");
    expect(ics).not.toContain("T150000");
    // Summary follows the "<Provider> - <Pickup city>" convention.
    expect(ics).toContain("SUMMARY:Hertz - Kyoto");
    // Location is the address (preferred over city).
    expect(ics).toContain("LOCATION:12 Karasuma-dori\\, Kyoto");
    // Description includes confirmation + pickup + dropoff details.
    // iCal folds lines at 75 chars (`\r\n ` continuation), so we
    // unfold before substring-matching to keep the assertions stable.
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("DESCRIPTION:Confirmation: ABC123");
    expect(unfolded).toContain("Pickup: Kyoto\\, 2026-06-10\\, 15:00");
    expect(unfolded).toContain("Dropoff: Kyoto\\, 2026-06-13\\, 10:00");
  });

  it("emits a VEVENT for a cruise with the ship name as the summary", () => {
    const trip = makeTrip({
      days: [
        {
          date: "2026-06-10",
          dayOfWeek: "Wed",
          city: "Port Canaveral",
          segments: [
            {
              id: "seg-cruise",
              type: "cruise",
              title: "7-night Western Caribbean",
              shipName: "Symphony of the Seas",
              departureCity: "Port Canaveral",
              arrivalCity: "Port Canaveral",
              startTime: "16:00",
              endTime: "08:00",
              endDate: "2026-06-17",
              confirmationCode: "RCL-9988",
              portsOfCall: [
                { date: "2026-06-11", atSea: true },
                {
                  date: "2026-06-12",
                  port: "Nassau",
                  arrivalTime: "08:00",
                  departureTime: "17:00",
                },
                {
                  date: "2026-06-13",
                  port: "CocoCay",
                  arrivalTime: "07:00",
                  departureTime: "16:00",
                },
              ],
              source: "manual",
              needsReview: false,
              sortOrder: 0,
            },
          ],
        },
      ],
    });

    const ics = tripToIcal(trip);
    const unfolded = ics.replace(/\r\n /g, "");
    // Summary is the ship name (NOT the route or itinerary title).
    expect(unfolded).toContain("SUMMARY:Symphony of the Seas");
    // Location is the boarding port (departureCity).
    expect(unfolded).toContain("LOCATION:Port Canaveral");
    // Description lists every port + at-sea day.
    expect(unfolded).toContain("Confirmation: RCL-9988");
    expect(unfolded).toContain("Ports of call:");
    expect(unfolded).toContain("2026-06-11 — At sea");
    expect(unfolded).toContain("2026-06-12 — Nassau (arr 08:00\\, dep 17:00)");
    expect(unfolded).toContain("2026-06-13 — CocoCay (arr 07:00\\, dep 16:00)");
  });

  it("emits a floating datetime when city is unrecognised", () => {
    const trip = makeTrip({
      days: [
        {
          date: "2026-06-12",
          dayOfWeek: "Fri",
          city: "At Sea",
          segments: [
            {
              id: "seg3",
              type: "restaurant_dinner",
              title: "Dinner",
              venueName: "Main Dining Room",
              startTime: "19:00",
              source: "manual",
              needsReview: false,
              sortOrder: 0,
            },
          ],
        },
      ],
    });

    const ics = tripToIcal(trip);
    // No TZID — floating datetime
    expect(ics).toContain("DTSTART:20260612T190000\r\n");
    expect(ics).not.toContain("TZID=");
  });

  it("includes the trip title in every SUMMARY", () => {
    const trip = makeTrip({
      title: "Japan & Korea",
      days: [
        {
          date: "2026-06-10",
          dayOfWeek: "Wed",
          city: "Tokyo",
          segments: [
            {
              id: "seg4",
              type: "activity",
              title: "Senso-ji Visit",
              venueName: "Senso-ji Temple",
              startTime: "09:00",
              source: "manual",
              needsReview: false,
              sortOrder: 0,
            },
          ],
        },
      ],
    });

    const ics = tripToIcal(trip);
    expect(ics).toContain("Japan & Korea");
  });

  it("folds long lines at 75 octets", () => {
    const trip = makeTrip({
      days: [
        {
          date: "2026-06-10",
          dayOfWeek: "Wed",
          city: "Tokyo",
          segments: [
            {
              id: "seg5",
              type: "activity",
              title: "A Very Long Activity Name That Will Cause The SUMMARY Line To Exceed The RFC Limit",
              venueName: "A Very Long Activity Name That Will Cause The SUMMARY Line To Exceed The RFC Limit",
              source: "manual",
              needsReview: false,
              sortOrder: 0,
            },
          ],
        },
      ],
    });

    const ics = tripToIcal(trip);
    // Every line (before \r\n) must be ≤ 75 chars, continuation lines start with space
    const lines = ics.split("\r\n");
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(75);
    }
  });

  it("includes a VTIMEZONE block for each unique timezone used by timed events", () => {
    const trip = makeTrip({
      days: [
        {
          date: "2026-06-10",
          dayOfWeek: "Wed",
          city: "Paris",
          segments: [
            {
              id: "seg-tz",
              type: "flight",
              title: "CDG → JFK",
              departureCity: "Paris",
              arrivalCity: "New York",
              carrier: "Air France",
              routeCode: "AF001",
              startTime: "10:00",
              endTime: "14:00",
              source: "manual",
              needsReview: false,
              sortOrder: 0,
            },
          ],
        },
      ],
    });

    const ics = tripToIcal(trip);
    // VTIMEZONE must appear before any VEVENT
    expect(ics.indexOf("BEGIN:VTIMEZONE")).toBeLessThan(ics.indexOf("BEGIN:VEVENT"));
    expect(ics).toContain("TZID:Europe/Paris\r\n");
    expect(ics).toContain("TZID:America/New_York\r\n");
    // Europe/Paris summer = UTC+2 (CEST)
    expect(ics).toContain("TZOFFSETTO:+0200\r\n");
    // America/New_York summer = UTC-4 (EDT)
    expect(ics).toContain("TZOFFSETTO:-0400\r\n");
  });

  it("advances DTEND date by one day for overnight transatlantic flights", () => {
    // LA 13:30 PDT (20:30 UTC) → Paris 08:10 CEST (06:10 UTC next day)
    const trip = makeTrip({
      days: [
        {
          date: "2026-06-26",
          dayOfWeek: "Fri",
          city: "Los Angeles",
          segments: [
            {
              id: "seg-overnight",
              type: "flight",
              title: "LAX → CDG",
              departureCity: "Los Angeles",
              arrivalCity: "Paris",
              carrier: "Air France",
              routeCode: "AF066",
              startTime: "13:30",
              endTime: "08:10",
              source: "manual",
              needsReview: false,
              sortOrder: 0,
            },
          ],
        },
      ],
    });

    const ics = tripToIcal(trip);
    expect(ics).toContain("DTSTART;TZID=America/Los_Angeles:20260626T133000\r\n");
    // Arrival is 08:10 Paris time on June 27, not June 26
    expect(ics).toContain("DTEND;TZID=Europe/Paris:20260627T081000\r\n");
  });

  it("keeps DTEND on same date for same-day westbound flights", () => {
    // Paris 10:00 CEST (08:00 UTC) → New York 14:00 EDT (18:00 UTC, same day)
    const trip = makeTrip({
      days: [
        {
          date: "2026-06-10",
          dayOfWeek: "Wed",
          city: "Paris",
          segments: [
            {
              id: "seg-sameday",
              type: "flight",
              title: "CDG → JFK",
              departureCity: "Paris",
              arrivalCity: "New York",
              carrier: "Delta",
              routeCode: "DL260",
              startTime: "10:00",
              endTime: "14:00",
              source: "manual",
              needsReview: false,
              sortOrder: 0,
            },
          ],
        },
      ],
    });

    const ics = tripToIcal(trip);
    expect(ics).toContain("DTSTART;TZID=Europe/Paris:20260610T100000\r\n");
    expect(ics).toContain("DTEND;TZID=America/New_York:20260610T140000\r\n");
  });

  it("escapes special characters in text properties", () => {
    const trip = makeTrip({
      title: "Trip; with, commas\\backslashes",
      days: [],
    });

    const ics = tripToIcal(trip);
    expect(ics).toContain("X-WR-CALNAME:Trip\\; with\\, commas\\\\backslashes\r\n");
  });
});
