import fs from "fs";
import path from "path";
import {
  XlsxTripImporter,
  extractYearHint,
  shiftWorkbookYears,
} from "../../src/services/xlsx-importer";
import type { ParsedWorkbook } from "../../src/services/xlsx-importer";

const FIXTURE_DIR = path.join(__dirname, "..", "fixtures");

function loadFixture(name: string): Buffer {
  return fs.readFileSync(path.join(FIXTURE_DIR, name));
}

describe("XlsxTripImporter", () => {
  describe("Christmas 2025 fixture", () => {
    let parsed: Awaited<ReturnType<XlsxTripImporter["parseWorkbook"]>>;

    beforeAll(async () => {
      const importer = new XlsxTripImporter();
      const buffer = loadFixture("christmas-2025.xlsx");
      parsed = await importer.parseWorkbook(buffer);
    });

    it("extracts the correct date range", () => {
      expect(parsed.startDate).toBe("2025-12-19");
      expect(parsed.endDate).toBe("2025-12-30");
    });

    it("creates one day per unique date in the spreadsheet", () => {
      // Dec 19 through Dec 30 inclusive = 12 days
      expect(parsed.days).toHaveLength(12);
      const dates = parsed.days.map((d) => d.date);
      expect(dates).toContain("2025-12-19");
      expect(dates).toContain("2025-12-25"); // Christmas day
      expect(dates).toContain("2025-12-30");
    });

    it("captures the city, day-of-week, and date for each day", () => {
      const day1 = parsed.days.find((d) => d.date === "2025-12-19");
      expect(day1).toBeDefined();
      expect(day1!.city).toMatch(/Seattle/i);
      expect(day1!.dayOfWeek).toBe("Fri");
    });

    it("parses the outbound Seattle→London flight with confirmation code", () => {
      const day1 = parsed.days.find((d) => d.date === "2025-12-19")!;
      const flight = day1.segments.find((s) => s.type === "flight");
      expect(flight).toBeDefined();
      // Title should include at least the route or flight number
      expect(flight!.title).toMatch(/SEA|LHR|BA52/i);
      expect(flight!.confirmationCode).toBe("XTWLTR");
    });

    it("parses a hotel segment with venue name and multi-line address", () => {
      // Day 2 (Dec 20) Prague — Hilton Prague Old Town
      const day2 = parsed.days.find((d) => d.date === "2025-12-20")!;
      expect(day2.city).toMatch(/Prague/i);
      const hotel = day2.segments.find((s) => s.type === "hotel");
      expect(hotel).toBeDefined();
      expect(hotel!.venueName).toMatch(/Hilton Prague Old Town/i);
      expect(hotel!.address).toMatch(/V Celnici/i);
    });

    it("parses a restaurant dinner with party size and time", () => {
      // Day 2 (Dec 20) G column: "Field (2) 21:00PM"
      const day2 = parsed.days.find((d) => d.date === "2025-12-20")!;
      const dinner = day2.segments.find(
        (s) => s.type === "restaurant_dinner" && /Field/i.test(s.title),
      );
      expect(dinner).toBeDefined();
      expect(dinner!.partySize).toBe(2);
      // Flexible: accept "21:00" as extracted time
      expect(dinner!.startTime).toBe("21:00");
    });

    it("splits a day with multiple transport sub-blocks into separate segments", () => {
      // Dec 24 (Wed) has BOTH a flight (BER-LTN/EZY2602) AND a rental car pickup
      const dec24 = parsed.days.find((d) => d.date === "2025-12-24")!;
      const transportSegs = dec24.segments.filter(
        (s) =>
          s.type === "flight" ||
          s.type === "car_rental" ||
          s.type === "car_service" ||
          s.type === "other_transport",
      );
      expect(transportSegs.length).toBeGreaterThanOrEqual(2);
      expect(transportSegs.some((s) => s.type === "flight")).toBe(true);
      expect(transportSegs.some((s) => s.type === "car_rental")).toBe(true);
    });

    it("flags a restaurant with CC in the text as creditCardHold=true", () => {
      // "Rutz (2) - 19:00 CC" on Tue Dec 23
      const dec23 = parsed.days.find((d) => d.date === "2025-12-23")!;
      const rutz = dec23.segments.find((s) => /Rutz/i.test(s.title));
      expect(rutz).toBeDefined();
      expect(rutz!.creditCardHold).toBe(true);
      expect(rutz!.partySize).toBe(2);
    });

    it("parses the Costs sheet into cost rows with currency", () => {
      expect(parsed.costs.length).toBeGreaterThan(0);
      const flight = parsed.costs.find((c) =>
        /Flight to\/from Europe/i.test(c.category),
      );
      expect(flight).toBeDefined();
      expect(flight!.amount).toBeCloseTo(4704.05, 2);
      expect(flight!.currency).toBe("USD");

      const londonFlight = parsed.costs.find((c) =>
        /Flight to London/i.test(c.category),
      );
      expect(londonFlight).toBeDefined();
      expect(londonFlight!.amount).toBeCloseTo(479.0, 2);
      expect(londonFlight!.currency).toBe("EUR");
    });

    it("attaches costs from the Costs sheet to matching lodging segments", () => {
      // "Hotel in Prague (1 night) $649.90" should map to the Prague hotel
      const day2 = parsed.days.find((d) => d.date === "2025-12-20")!;
      const hotel = day2.segments.find((s) => s.type === "hotel");
      expect(hotel).toBeDefined();
      expect(hotel!.cost).toBeDefined();
      expect(hotel!.cost!.amount).toBeCloseTo(649.9, 2);
      expect(hotel!.cost!.currency).toBe("USD");
    });
  });

  describe("Summer 2025 fixture", () => {
    let parsed: Awaited<ReturnType<XlsxTripImporter["parseWorkbook"]>>;

    beforeAll(async () => {
      const importer = new XlsxTripImporter();
      const buffer = loadFixture("summer-2025.xlsx");
      parsed = await importer.parseWorkbook(buffer);
    });

    it("extracts the correct date range", () => {
      expect(parsed.startDate).toBe("2025-06-10");
      expect(parsed.endDate).toBe("2025-06-27");
    });

    it("creates a day for every unique spreadsheet date", () => {
      // 46183..46200 = 18 days
      expect(parsed.days).toHaveLength(18);
    });

    it("parses free-form flight descriptions with PNR in parentheses", () => {
      // Day 1: "Flight to Dublin (2LVPEF)"
      const day1 = parsed.days.find((d) => d.date === "2025-06-10")!;
      expect(day1.city).toMatch(/Seattle/i);
      const flight = day1.segments.find((s) => s.type === "flight");
      expect(flight).toBeDefined();
      expect(flight!.confirmationCode).toBe("2LVPEF");
    });

    it("classifies `Train to X` as a train segment", () => {
      // Day of Sat Jun 20: "Train to Milan (T9YTWL)"
      const trainDay = parsed.days.find((d) =>
        d.segments.some((s) => /Train to Milan/i.test(s.title)),
      );
      expect(trainDay).toBeDefined();
      const train = trainDay!.segments.find((s) => /Train to Milan/i.test(s.title))!;
      expect(train.type).toBe("train");
      expect(train.confirmationCode).toBe("T9YTWL");
    });

    it("handles multiple lunch/dinner entries on a single day", () => {
      // Rome day (Thur Jun 12) has multiple F/G entries across rows:
      // Voglia di pizza / Armando Al Pantheon, plus Colosseum / Jerry Thomas Bar
      const day = parsed.days.find((d) => d.date === "2025-06-12")!;
      expect(day.city).toMatch(/Rome/i);
      // Expect at least 2 segments that are either restaurants or activities
      const mealsOrActivities = day.segments.filter(
        (s) =>
          s.type === "restaurant_lunch" ||
          s.type === "restaurant_dinner" ||
          s.type === "activity",
      );
      expect(mealsOrActivities.length).toBeGreaterThanOrEqual(3);
    });

    it("parses CC-hold dinners with party size", () => {
      // "Armando Al Pantheon (2) @ 19:00 - CC"
      const day = parsed.days.find((d) => d.date === "2025-06-12")!;
      const armando = day.segments.find((s) => /Armando/i.test(s.title));
      expect(armando).toBeDefined();
      expect(armando!.partySize).toBe(2);
      expect(armando!.creditCardHold).toBe(true);
      expect(armando!.startTime).toBe("19:00");
    });

    it("parses hotel rows with name + address across multiple spreadsheet rows", () => {
      // Sat Jun 21: Duo Milan Porta Nuova + Via Gerolamo Cardano address
      const day = parsed.days.find((d) => d.date === "2025-06-21")!;
      const hotel = day.segments.find((s) => s.type === "hotel");
      expect(hotel).toBeDefined();
      expect(hotel!.venueName).toMatch(/Duo Milan/i);
      expect(hotel!.address).toMatch(/Gerolamo Cardano/i);
    });
  });

  describe("enrichment — hotel/restaurant/activity city", () => {
    let parsed: Awaited<ReturnType<XlsxTripImporter["parseWorkbook"]>>;

    beforeAll(async () => {
      const importer = new XlsxTripImporter();
      parsed = await importer.parseWorkbook(loadFixture("christmas-2025.xlsx"));
    });

    it("auto-populates city on hotel segments from the day's city", () => {
      const day = parsed.days.find((d) => d.date === "2025-12-20")!;
      const hotel = day.segments.find((s) => s.type === "hotel")!;
      expect(hotel.city).toMatch(/Prague/i);
      expect(hotel.city).toBe(day.city);
    });

    it("auto-populates city on restaurants and activities", () => {
      for (const day of parsed.days) {
        if (!day.city) continue;
        const dayScopedSegs = day.segments.filter(
          (s) =>
            s.type === "restaurant_lunch" ||
            s.type === "restaurant_dinner" ||
            s.type === "activity",
        );
        for (const seg of dayScopedSegs) {
          expect(seg.city).toBe(day.city);
        }
      }
    });
  });

  describe("enrichment — restaurant venue names", () => {
    let parsed: Awaited<ReturnType<XlsxTripImporter["parseWorkbook"]>>;

    beforeAll(async () => {
      const importer = new XlsxTripImporter();
      parsed = await importer.parseWorkbook(loadFixture("summer-2025.xlsx"));
    });

    it("sets venueName on restaurant segments from the cleaned title", () => {
      const day = parsed.days.find((d) => d.date === "2025-06-12")!;
      const armando = day.segments.find((s) => /Armando/i.test(s.title));
      expect(armando).toBeDefined();
      expect(armando!.type).toBe("restaurant_dinner");
      expect(armando!.venueName).toBe(armando!.title);
      expect(armando!.venueName).toMatch(/Armando/i);
    });

    it("does not set venueName on activity segments", () => {
      const activities = parsed.days.flatMap((d) =>
        d.segments.filter((s) => s.type === "activity"),
      );
      // At least one activity must exist in the fixture; none should carry venueName
      expect(activities.length).toBeGreaterThan(0);
      for (const act of activities) {
        expect(act.venueName).toBeUndefined();
      }
    });
  });

  describe("enrichment — transport departure/arrival cities", () => {
    let parsed: Awaited<ReturnType<XlsxTripImporter["parseWorkbook"]>>;

    beforeAll(async () => {
      const importer = new XlsxTripImporter();
      parsed = await importer.parseWorkbook(loadFixture("summer-2025.xlsx"));
    });

    it("infers the destination from a 'to <city>' title", () => {
      const day = parsed.days.find((d) => d.date === "2025-06-10")!;
      const flight = day.segments.find((s) => s.type === "flight")!;
      // Title is "Flight to Dublin (2LVPEF)" → arrival = Dublin
      expect(flight.arrivalCity).toMatch(/Dublin/i);
      // Departure falls back to the day's city (Seattle)
      expect(flight.departureCity).toMatch(/Seattle/i);
    });

    it("populates departure/arrival on train segments", () => {
      const trainDay = parsed.days.find((d) =>
        d.segments.some((s) => /Train to Milan/i.test(s.title)),
      )!;
      const train = trainDay.segments.find((s) => /Train to Milan/i.test(s.title))!;
      expect(train.arrivalCity).toMatch(/Milan/i);
      expect(train.departureCity).toBeDefined();
    });
  });

  describe("enrichment — hotel checkout dates", () => {
    let parsed: Awaited<ReturnType<XlsxTripImporter["parseWorkbook"]>>;

    beforeAll(async () => {
      const importer = new XlsxTripImporter();
      parsed = await importer.parseWorkbook(loadFixture("summer-2025.xlsx"));
    });

    it("sets hotel endDate to the day of the next hotel with a different venue", () => {
      // Collect all hotel segments in chronological order
      interface HotelInfo {
        date: string;
        venueName?: string;
        endDate?: string;
      }
      const hotels: HotelInfo[] = [];
      for (const d of parsed.days) {
        for (const s of d.segments) {
          if (s.type === "hotel") {
            hotels.push({
              date: d.date,
              venueName: s.venueName,
              endDate: s.endDate,
            });
          }
        }
      }
      expect(hotels.length).toBeGreaterThan(0);

      // Every hotel should have an endDate inferred
      for (const h of hotels) {
        expect(h.endDate).toBeDefined();
        expect(h.endDate! >= h.date).toBe(true);
      }

      // Last hotel checks out on the final trip day
      const last = hotels[hotels.length - 1]!;
      expect(last.endDate).toBe(parsed.endDate);

      // Consecutive hotels with DIFFERENT venue names should have the later
      // hotel's date as the earlier hotel's endDate.
      for (let i = 0; i < hotels.length - 1; i++) {
        const a = hotels[i]!;
        const b = hotels[i + 1]!;
        if (
          (a.venueName || "").toLowerCase() !==
          (b.venueName || "").toLowerCase()
        ) {
          expect(a.endDate).toBe(b.date);
        }
      }
    });
  });

  describe("error handling", () => {
    it("throws a descriptive error when the buffer is not a valid XLSX", async () => {
      const importer = new XlsxTripImporter();
      const bogus = Buffer.from("this is not xlsx");
      await expect(importer.parseWorkbook(bogus)).rejects.toThrow();
    });
  });
});

describe("extractYearHint", () => {
  it("pulls a year out of a trip title", () => {
    expect(extractYearHint("Summer 2025")).toBe(2025);
    expect(extractYearHint("Christmas 2026 trip")).toBe(2026);
    expect(extractYearHint("2024 Italy")).toBe(2024);
  });

  it("pulls a year out of a filename", () => {
    expect(extractYearHint("Summer 2025.xlsx")).toBe(2025);
    expect(extractYearHint("trip-2027.xlsx")).toBe(2027);
  });

  it("returns undefined when no year is present", () => {
    expect(extractYearHint("Summer trip")).toBeUndefined();
    expect(extractYearHint("")).toBeUndefined();
    expect(extractYearHint(undefined)).toBeUndefined();
    expect(extractYearHint(null)).toBeUndefined();
  });

  it("ignores numbers that look like confirmation codes", () => {
    // 4-digit segment embedded in a longer digit run shouldn't match.
    expect(extractYearHint("XTWLTR-20250912345")).toBeUndefined();
    expect(extractYearHint("Room 2145")).toBeUndefined();
  });

  it("rejects years outside 1900-2099", () => {
    expect(extractYearHint("Trip 1850")).toBeUndefined();
    expect(extractYearHint("Trip 2150")).toBeUndefined();
  });
});

describe("shiftWorkbookYears", () => {
  const sampleBook: ParsedWorkbook = {
    title: "Sample",
    startDate: "2026-06-15",
    endDate: "2026-06-18",
    days: [
      { date: "2026-06-15", dayOfWeek: "Mon", city: "Paris", segments: [] },
      { date: "2026-06-16", dayOfWeek: "Tue", city: "Paris", segments: [] },
      { date: "2026-06-18", dayOfWeek: "Thu", city: "Rome", segments: [] },
    ],
    costs: [],
    warnings: [],
  };

  it("is a no-op when delta is 0", () => {
    const out = shiftWorkbookYears(sampleBook, 0);
    expect(out).toBe(sampleBook);
  });

  it("shifts start, end, and day dates by negative delta", () => {
    const out = shiftWorkbookYears(sampleBook, -1);
    expect(out.startDate).toBe("2025-06-15");
    expect(out.endDate).toBe("2025-06-18");
    expect(out.days.map((d) => d.date)).toEqual([
      "2025-06-15",
      "2025-06-16",
      "2025-06-18",
    ]);
  });

  it("shifts by positive delta", () => {
    const out = shiftWorkbookYears(sampleBook, 2);
    expect(out.startDate).toBe("2028-06-15");
    expect(out.endDate).toBe("2028-06-18");
  });

  it("does not mutate the input workbook", () => {
    shiftWorkbookYears(sampleBook, -1);
    expect(sampleBook.startDate).toBe("2026-06-15");
    expect(sampleBook.days[0]!.date).toBe("2026-06-15");
  });
});
