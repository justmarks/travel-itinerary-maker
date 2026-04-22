import type { Trip } from "@travel-app/shared";
import { generateTripPdf } from "../../src/utils/pdf-generator";

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-test",
    title: "Test Trip",
    startDate: "2026-06-26",
    endDate: "2026-06-27",
    status: "planning",
    createdAt: "2026-04-21T00:00:00Z",
    updatedAt: "2026-04-21T00:00:00Z",
    days: [
      {
        id: "day-1",
        date: "2026-06-26",
        dayOfWeek: "Fri",
        city: "Palermo",
        segments: [],
      },
    ],
    todos: [],
    ...overrides,
  };
}

describe("generateTripPdf", () => {
  it("produces a valid PDF buffer", async () => {
    const buf = await generateTripPdf(makeTrip());
    expect(Buffer.isBuffer(buf)).toBe(true);
    // PDF magic header
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
    // Nontrivial size — at minimum the cover + horizontal rule + "Itinerary"
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("grows cost-summary rows to fit long details without overflow", async () => {
    // Long details string reproduces the bug that spilled wrapped text
    // onto subsequent pages as orphan fragments.
    const longDetails =
      "Deluxe Room - Non-refundable, Bed & Breakfast included, +€4.50 per night city tax per adult, plus additional resort fees, parking, wifi, pool access, gym, spa amenities and more.";
    const trip = makeTrip({
      days: [
        {
          id: "day-1",
          date: "2026-06-26",
          dayOfWeek: "Fri",
          city: "Palermo",
          segments: [
            {
              id: "seg-1",
              type: "hotel",
              title: "Palazzo Natoli Boutique Hotel",
              date: "2026-06-26",
              endDate: "2026-06-27",
              venueName: "Palazzo Natoli Boutique Hotel",
              sortOrder: 0,
              source: "manual",
              needsReview: false,
              cost: {
                amount: 272,
                currency: "EUR",
                details: longDetails,
              },
              createdAt: "2026-04-21T00:00:00Z",
              updatedAt: "2026-04-21T00:00:00Z",
            },
          ],
        },
      ],
    });

    const buf = await generateTripPdf(trip, { includeCosts: true });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
    // A page-count heuristic: a one-day trip with a single cost item
    // should fit on a single A4 page. The old bug emitted 3+ pages
    // because wrapped details overflowed. If we regress, this triggers.
    const pageCount = (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || [])
      .length;
    expect(pageCount).toBe(1);
  });

  it("grows itinerary rows to fit long segment details without clipping", async () => {
    // Long address + confirmation number reproduces the segment-row
    // clipping bug where the 2nd wrapped line rendered below the row
    // background and was overpainted by the next row's zebra stripe.
    const trip = makeTrip({
      days: [
        {
          id: "day-1",
          date: "2026-06-26",
          dayOfWeek: "Fri",
          city: "Paris",
          segments: [
            {
              id: "seg-1",
              type: "hotel",
              title: "Le Prince de Galles",
              date: "2026-06-26",
              endDate: "2026-06-27",
              venueName: "Le Prince de Galles, a Luxury Collection Hotel",
              address:
                "33 Avenue George V, 75008 Paris, France — near the Champs-Élysées",
              confirmationCode: "ABC1234567890XYZ",
              breakfastIncluded: true,
              sortOrder: 0,
              source: "manual",
              needsReview: false,
              createdAt: "2026-04-21T00:00:00Z",
              updatedAt: "2026-04-21T00:00:00Z",
            },
            {
              id: "seg-2",
              type: "car_rental",
              title: "Hertz Rental",
              date: "2026-06-26",
              venueName: "Hertz - Paris Charles de Gaulle Airport",
              address:
                "Terminal 2E - Gate 2 Arrivals Level, Roissy-en-France 95700",
              confirmationCode: "H1692497510XYZ",
              sortOrder: 1,
              source: "manual",
              needsReview: false,
              createdAt: "2026-04-21T00:00:00Z",
              updatedAt: "2026-04-21T00:00:00Z",
            },
          ],
        },
      ],
    });

    const buf = await generateTripPdf(trip);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
    // Single-page regression guard for the segment-row wrap fix.
    const pageCount = (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || [])
      .length;
    expect(pageCount).toBe(1);
  });

  it("sanitizes Unicode arrow (U+2192) in segment titles", async () => {
    const trip = makeTrip({
      days: [
        {
          id: "day-1",
          date: "2026-06-26",
          dayOfWeek: "Fri",
          segments: [
            {
              id: "seg-1",
              type: "flight",
              title: "CTA \u2192 ORY",
              date: "2026-06-26",
              departureCity: "CTA",
              arrivalCity: "ORY",
              sortOrder: 0,
              source: "manual",
              needsReview: false,
              cost: { amount: 150, currency: "EUR" },
              createdAt: "2026-04-21T00:00:00Z",
              updatedAt: "2026-04-21T00:00:00Z",
            },
          ],
        },
      ],
    });

    const buf = await generateTripPdf(trip, { includeCosts: true });
    expect(Buffer.isBuffer(buf)).toBe(true);
    // The raw U+2192 UTF-8 byte sequence (0xE2 0x86 0x92) should not appear
    // in the PDF's content streams — it would render as garbage via WinAnsi.
    const arrowUtf8 = Buffer.from("\u2192", "utf8");
    const hasRawArrow = buf.includes(arrowUtf8);
    expect(hasRawArrow).toBe(false);
  });
});
