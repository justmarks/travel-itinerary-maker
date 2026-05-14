// Set env before any imports so config picks it up
process.env.ANTHROPIC_API_KEY = "test-key";

import request from "supertest";
import { createApp } from "../../src/app";
import { InMemoryStorage } from "../../src/services/storage";

// Mock the GmailScanner
jest.mock("../../src/services/gmail-scanner", () => {
  return {
    GmailScanner: jest.fn().mockImplementation(() => ({
      listLabels: jest.fn().mockResolvedValue([
        { id: "INBOX", name: "INBOX", type: "system" },
        { id: "STARRED", name: "STARRED", type: "system" },
        { id: "Label_1", name: "Travel", type: "user" },
        { id: "Label_2", name: "Receipts", type: "user" },
      ]),
      scanEmails: jest.fn().mockResolvedValue([
        {
          id: "msg-001",
          threadId: "thread-001",
          subject: "Your Alaska Airlines flight confirmation",
          from: "reservations@alaskaair.com",
          receivedAt: "2026-06-10T08:00:00Z",
          bodyText: "Confirmation: ABCDEF\nFlight AS123\nSEA to NRT\nJune 26, 2026\nDepart: 10:30 AM\nSeat: 14A",
        },
        {
          id: "msg-002",
          threadId: "thread-002",
          subject: "Hotel Booking Confirmed - Hilton Tokyo",
          from: "confirmation@hilton.com",
          receivedAt: "2026-06-10T09:00:00Z",
          bodyText: "Confirmation: HLT789\nHilton Tokyo Bay\nCheck-in: June 26, 2026\nCheck-out: June 30, 2026\nBreakfast included\nTotal: $850.00 USD",
        },
        {
          id: "msg-003",
          threadId: "thread-003",
          subject: "Weekly Newsletter",
          from: "news@example.com",
          receivedAt: "2026-06-10T10:00:00Z",
          bodyText: "This week in tech news...",
        },
      ]),
    })),
  };
});

// Mock the EmailParser. parseEmail now returns a richer object:
// { segments, invalidCount, rawItemCount } so the route can distinguish
// "no travel content" from "validation failure".
//
// We also implement parseHtml here because /emails/import-html delegates
// to parser.parseHtml. The mock version triages on the subject field — the
// subject is how tests specify "pretend this HTML is a hotel confirmation".
jest.mock("../../src/services/email-parser", () => {
  const parseImpl = (email: { subject: string }) => {
    if (email.subject.includes("Alaska Airlines")) {
      return Promise.resolve({
        segments: [
          {
            type: "flight",
            title: "SEA → NRT",
            date: "2026-06-26",
            startTime: "10:30",
            carrier: "AS",
            routeCode: "AS123",
            departureCity: "Seattle",
            arrivalCity: "Tokyo",
            seatNumber: "14A",
            confirmationCode: "ABCDEF",
            confidence: "high",
          },
        ],
        invalidCount: 0,
        rawItemCount: 1,
      });
    }
    if (email.subject.includes("Hilton")) {
      return Promise.resolve({
        segments: [
          {
            type: "hotel",
            title: "Hilton Tokyo Bay",
            date: "2026-06-26",
            venueName: "Hilton Tokyo Bay",
            city: "Tokyo",
            confirmationCode: "HLT789",
            breakfastIncluded: true,
            cost: { amount: 850, currency: "USD" },
            confidence: "high",
          },
        ],
        invalidCount: 0,
        rawItemCount: 1,
      });
    }
    if (email.subject.includes("Palazzo")) {
      // Used by HTML import tests — pretend the HTML described this hotel.
      return Promise.resolve({
        segments: [
          {
            type: "hotel",
            title: "Palazzo Natoli",
            date: "2026-06-15",
            venueName: "Palazzo Natoli",
            city: "Palermo",
            confirmationCode: "PLZ001",
            endDate: "2026-06-18",
            cost: { amount: 540, currency: "EUR" },
            confidence: "high",
          },
        ],
        invalidCount: 0,
        rawItemCount: 1,
      });
    }
    if (email.subject.includes("ONT return")) {
      // Round-trip regression case: the return leg of a PNR the trip
      // already has the outbound for. Same confirmationCode (a single
      // PNR covers both legs of a round trip), different date, opposite
      // direction. The matcher must NOT treat this as a duplicate of
      // the outbound leg just because the PNRs match.
      return Promise.resolve({
        segments: [
          {
            type: "flight",
            title: "ONT → SEA",
            date: "2026-06-21",
            startTime: "14:09",
            endTime: "16:51",
            carrier: "AS",
            routeCode: "AS567",
            departureCity: "Ontario",
            arrivalCity: "Seattle",
            departureAirport: "ONT",
            arrivalAirport: "SEA",
            seatNumber: "12C, 12D, 12E, 12F",
            confirmationCode: "ITHZXM",
            confidence: "high",
          },
        ],
        invalidCount: 0,
        rawItemCount: 1,
      });
    }
    if (email.subject.includes("Air France")) {
      // Used by the flight-title regression test: Claude returns the bare
      // route ("SEA → CDG") with carrier+routeCode in dedicated fields, while
      // the existing trip segment has them baked into the title.
      return Promise.resolve({
        segments: [
          {
            type: "flight",
            title: "SEA → CDG",
            date: "2026-06-26",
            startTime: "13:30",
            carrier: "Air France",
            routeCode: "337",
            departureCity: "Seattle",
            arrivalCity: "Paris",
            departureAirport: "SEA",
            arrivalAirport: "CDG",
            confirmationCode: "CC4GJZ",
            confidence: "high",
          },
        ],
        invalidCount: 0,
        rawItemCount: 1,
      });
    }
    if (email.subject.includes("Villa Fiorita")) {
      // Used by the hotel-venueName regression test: parsed name lacks the
      // "Boutique" qualifier that's in the existing trip segment.
      return Promise.resolve({
        segments: [
          {
            type: "hotel",
            title: "Villa Fiorita Hotel",
            date: "2026-06-29",
            venueName: "Villa Fiorita Hotel",
            city: "Taormina",
            confirmationCode: "405140584",
            cost: { amount: 492, currency: "EUR" },
            confidence: "medium",
          },
        ],
        invalidCount: 0,
        rawItemCount: 1,
      });
    }
    if (email.subject.includes("Castello di San Marco")) {
      // Used by the hotel-venueName regression test: parsed name has "di"
      // that the existing trip segment omits; address is a postal superset
      // of the existing one.
      return Promise.resolve({
        segments: [
          {
            type: "hotel",
            title: "Castello di San Marco Charming Hotel & Spa",
            date: "2026-06-30",
            venueName: "Castello di San Marco Charming Hotel & Spa",
            address: "Via San Marco, 40, 95011 Calatabiano, Italy",
            city: "Calatabiano",
            confirmationCode: "SIMP_2026032847229268",
            cost: { amount: 319, currency: "EUR" },
            confidence: "high",
          },
        ],
        invalidCount: 0,
        rawItemCount: 1,
      });
    }
    if (email.subject.includes("Principe Cerami")) {
      // Used by the cross-type-matching regression test: parsed type is
      // restaurant_dinner while existing trip segment is `activity`.
      return Promise.resolve({
        segments: [
          {
            type: "restaurant_dinner",
            title: "Dinner at Principe Cerami",
            date: "2026-06-29",
            startTime: "20:00",
            venueName: "Principe Cerami",
            city: "Taormina",
            confirmationCode: "58514",
            confidence: "high",
          },
        ],
        invalidCount: 0,
        rawItemCount: 1,
      });
    }
    if (email.subject.includes("Invalid")) {
      // Used by HTML import tests — pretend Claude returned items but all
      // failed Zod validation, so we can verify the "failed" status path.
      return Promise.resolve({
        segments: [],
        invalidCount: 2,
        rawItemCount: 2,
      });
    }
    // Newsletter / generic HTML - no travel content
    return Promise.resolve({
      segments: [],
      invalidCount: 0,
      rawItemCount: 0,
    });
  };

  // Static method: lightweight EML header extractor the route calls before
  // delegating to parseEml. We implement a minimal parser here so route tests
  // can feed synthetic EML strings without taking a full mailparser dep.
  const emlToEmailImpl = (eml: string | Buffer) => {
    const src = typeof eml === "string" ? eml : eml.toString("utf-8");
    const headerBlockEnd = src.search(/\r?\n\r?\n/);
    const headerBlock = headerBlockEnd > -1 ? src.slice(0, headerBlockEnd) : src;
    const bodyBlock = headerBlockEnd > -1 ? src.slice(headerBlockEnd).replace(/^\r?\n\r?\n/, "") : "";
    const getHeader = (name: string) => {
      const re = new RegExp(`^${name}:\\s*(.+)$`, "im");
      const m = headerBlock.match(re);
      return m ? m[1].trim() : "";
    };
    const subject = getHeader("Subject") || "(EML import — no subject)";
    const from = getHeader("From") || "(unknown sender)";
    const dateHdr = getHeader("Date");
    let receivedAt: string | undefined;
    if (dateHdr) {
      const d = new Date(dateHdr);
      if (!isNaN(d.getTime())) receivedAt = d.toISOString();
    }
    return Promise.resolve({
      subject,
      from,
      body: bodyBlock.trim(),
      receivedAt,
    });
  };

  const EmailParserMock = jest.fn().mockImplementation(() => ({
    parseEmail: jest.fn().mockImplementation(parseImpl),
    parseHtml: jest
      .fn()
      .mockImplementation(
        (input: { html: string; subject?: string; from?: string; receivedAt?: string }) =>
          parseImpl({
            subject: input.subject || "(HTML import — no subject)",
          }),
      ),
    parseEml: jest
      .fn()
      .mockImplementation(
        async (input: { eml: string | Buffer; subject?: string; from?: string; receivedAt?: string }) => {
          const extracted = await emlToEmailImpl(input.eml);
          return parseImpl({
            subject: input.subject?.trim() || extracted.subject,
          });
        },
      ),
  })) as unknown as jest.Mock & { emlToEmail: typeof emlToEmailImpl };
  // Attach the static helper so route code calling `EmailParser.emlToEmail`
  // resolves through the mock.
  (EmailParserMock as unknown as { emlToEmail: typeof emlToEmailImpl }).emlToEmail = emlToEmailImpl;

  return {
    EmailParser: EmailParserMock,
  };
});

let storage: InMemoryStorage;
let app: import("express").Express;

beforeEach(async () => {
  storage = new InMemoryStorage();
  app = await createApp({ mode: "memory", storage, disableRedis: true });
});

describe("Email Routes", () => {
  describe("GET /api/v1/emails/labels", () => {
    it("returns gmail labels", async () => {
      const res = await request(app).get("/api/v1/emails/labels");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(4);
      expect(res.body[2].name).toBe("Travel");
    });
  });

  describe("POST /api/v1/emails/scan", () => {
    it("scans and parses emails", async () => {
      const res = await request(app)
        .post("/api/v1/emails/scan")
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(3);

      // Flight email
      const flight = res.body.results[0];
      expect(flight.parseStatus).toBe("success");
      expect(flight.parsedSegments).toHaveLength(1);
      expect(flight.parsedSegments[0].type).toBe("flight");
      expect(flight.parsedSegments[0].routeCode).toBe("AS123");

      // Hotel email
      const hotel = res.body.results[1];
      expect(hotel.parseStatus).toBe("success");
      expect(hotel.parsedSegments).toHaveLength(1);
      expect(hotel.parsedSegments[0].type).toBe("hotel");

      // Newsletter
      const newsletter = res.body.results[2];
      expect(newsletter.parseStatus).toBe("no_travel_content");
      expect(newsletter.parsedSegments).toHaveLength(0);
    });

    it("persists parsed results for travel emails", async () => {
      await request(app)
        .post("/api/v1/emails/scan")
        .send({});

      const processed = await storage.getProcessedEmails();
      // All 3 emails are saved: 2 with "parsed" status, 1 with "skipped"
      expect(processed).toHaveLength(3);

      const flight = processed.find((e) => e.gmailMessageId === "msg-001");
      expect(flight?.parseStatus).toBe("parsed");
      expect(flight?.rawParseResult).toBeDefined();

      const hotel = processed.find((e) => e.gmailMessageId === "msg-002");
      expect(hotel?.parseStatus).toBe("parsed");

      const newsletter = processed.find((e) => e.gmailMessageId === "msg-003");
      expect(newsletter?.parseStatus).toBe("skipped");
    });

    it("returns pending results on second scan without re-calling Claude", async () => {
      // First scan — calls Claude for all 3 emails
      const first = await request(app)
        .post("/api/v1/emails/scan")
        .send({});
      expect(first.body.results).toHaveLength(3);
      expect(first.body.newCount).toBe(2); // 2 travel emails parsed

      // Second scan — no new emails to parse, returns pending results
      const res = await request(app)
        .post("/api/v1/emails/scan")
        .send({});

      expect(res.status).toBe(200);
      // 2 pending travel results returned (newsletter already skipped)
      expect(res.body.results).toHaveLength(2);
      expect(res.body.pendingCount).toBe(2);
      expect(res.body.newCount).toBe(0);
    });

    it("stops returning emails after they are applied", async () => {
      // Create a trip
      const tripRes = await request(app)
        .post("/api/v1/trips")
        .send({
          title: "Japan Trip",
          startDate: "2026-06-25",
          endDate: "2026-07-05",
        });
      const tripId = tripRes.body.id;

      // Scan
      await request(app).post("/api/v1/emails/scan").send({});

      // Apply the flight segment
      await request(app)
        .post("/api/v1/emails/apply")
        .send({
          segments: [{
            type: "flight",
            title: "SEA → NRT",
            date: "2026-06-26",
            confidence: "high",
            tripId,
            emailId: "msg-001",
          }],
        });

      // Dismiss the hotel email
      await request(app).post("/api/v1/emails/dismiss/msg-002");

      // Third scan — all emails are done
      const res = await request(app)
        .post("/api/v1/emails/scan")
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(0);
      expect(res.body.message).toBe("No new emails to process");
    });

    it("re-parses a previously-mapped email when its target trip was deleted", async () => {
      // Create a trip, scan, apply the flight, dismiss the hotel.
      const tripRes = await request(app)
        .post("/api/v1/trips")
        .send({
          title: "Japan Trip",
          startDate: "2026-06-25",
          endDate: "2026-07-05",
        });
      const tripId = tripRes.body.id;

      await request(app).post("/api/v1/emails/scan").send({});
      await request(app)
        .post("/api/v1/emails/apply")
        .send({
          segments: [
            {
              type: "flight",
              title: "SEA → NRT",
              date: "2026-06-26",
              confidence: "high",
              tripId,
              emailId: "msg-001",
            },
          ],
        });
      await request(app).post("/api/v1/emails/dismiss/msg-002");

      // Sanity check: scan returns nothing while the trip is alive.
      const cleanScan = await request(app)
        .post("/api/v1/emails/scan")
        .send({});
      expect(cleanScan.body.results).toHaveLength(0);

      // The user deletes the trip — the segment they applied is gone
      // along with it.
      await request(app).delete(`/api/v1/trips/${tripId}`);

      // Now the email's `mapped → tripId` record points at nothing.
      // Re-scan: the email should come back as a fresh result so the
      // user can apply it to a new trip rather than being silently
      // skipped forever.
      const recoveryScan = await request(app)
        .post("/api/v1/emails/scan")
        .send({});
      expect(recoveryScan.status).toBe(200);
      const flightResult = recoveryScan.body.results.find(
        (r: { emailId: string }) => r.emailId === "msg-001",
      );
      expect(flightResult).toBeDefined();
      expect(flightResult.parseStatus).toBe("success");
      expect(flightResult.parsedSegments).toHaveLength(1);
      expect(flightResult.parsedSegments[0].type).toBe("flight");
    });

    it("auto-matches segments to existing trips by date", async () => {
      // Create a trip covering the segment dates
      await request(app)
        .post("/api/v1/trips")
        .send({
          title: "Japan Trip",
          startDate: "2026-06-25",
          endDate: "2026-07-05",
        });

      const res = await request(app)
        .post("/api/v1/emails/scan")
        .send({});

      // Flight on June 26 should match the Japan trip
      const flight = res.body.results[0].parsedSegments[0];
      expect(flight.suggestedTripId).toBeDefined();
    });

    it("accepts optional label filter and maxResults", async () => {
      const res = await request(app)
        .post("/api/v1/emails/scan")
        .send({ labelFilter: "Travel", maxResults: 10 });

      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/v1/emails/pending", () => {
    it("returns pending results from previous scan", async () => {
      // Scan first
      await request(app).post("/api/v1/emails/scan").send({});

      // Get pending
      const res = await request(app).get("/api/v1/emails/pending");
      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(2); // 2 travel emails pending
    });

    it("returns empty when no pending results", async () => {
      const res = await request(app).get("/api/v1/emails/pending");
      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(0);
    });

    it("re-matches trips on pending results", async () => {
      // Scan first (no trips exist)
      await request(app).post("/api/v1/emails/scan").send({});

      // Create a trip that covers the segment dates
      await request(app)
        .post("/api/v1/trips")
        .send({
          title: "Japan Trip",
          startDate: "2026-06-25",
          endDate: "2026-07-05",
        });

      // Get pending — should now suggest the new trip
      const res = await request(app).get("/api/v1/emails/pending");
      const flight = res.body.results[0].parsedSegments[0];
      expect(flight.suggestedTripId).toBeDefined();
    });
  });

  describe("POST /api/v1/emails/apply", () => {
    it("creates segments on the correct trip days", async () => {
      // Create a trip
      const tripRes = await request(app)
        .post("/api/v1/trips")
        .send({
          title: "Japan Trip",
          startDate: "2026-06-25",
          endDate: "2026-07-05",
        });

      const tripId = tripRes.body.id;

      // Apply a parsed segment
      const res = await request(app)
        .post("/api/v1/emails/apply")
        .send({
          segments: [
            {
              type: "flight",
              title: "SEA → NRT",
              date: "2026-06-26",
              startTime: "10:30",
              carrier: "AS",
              routeCode: "AS123",
              confirmationCode: "ABCDEF",
              confidence: "high",
              tripId,
              emailId: "msg-001",
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.created).toHaveLength(1);

      // Verify segment on trip
      const tripCheck = await request(app).get(`/api/v1/trips/${tripId}`);
      const june26 = tripCheck.body.days.find(
        (d: { date: string }) => d.date === "2026-06-26",
      );
      expect(june26.segments).toHaveLength(1);
      expect(june26.segments[0].source).toBe("email_auto");
      expect(june26.segments[0].needsReview).toBe(true);
      expect(june26.segments[0].sourceEmailId).toBe("msg-001");
    });

    it("marks applied emails as mapped and clears rawParseResult", async () => {
      // Scan first to create parsed records
      await request(app).post("/api/v1/emails/scan").send({});

      // Create a trip and apply
      const tripRes = await request(app)
        .post("/api/v1/trips")
        .send({ title: "Trip", startDate: "2026-06-25", endDate: "2026-07-05" });

      await request(app)
        .post("/api/v1/emails/apply")
        .send({
          segments: [{
            type: "flight",
            title: "SEA → NRT",
            date: "2026-06-26",
            confidence: "high",
            tripId: tripRes.body.id,
            emailId: "msg-001",
          }],
        });

      const processed = await storage.getProcessedEmails();
      const applied = processed.find((e) => e.gmailMessageId === "msg-001");
      expect(applied?.parseStatus).toBe("mapped");
      expect(applied?.rawParseResult).toBeUndefined();
    });

    it("rejects empty segments array", async () => {
      const res = await request(app)
        .post("/api/v1/emails/apply")
        .send({ segments: [] });

      expect(res.status).toBe(400);
    });

    it("prefers a hotel city over a flight arrival or car-rental pickup when auto-filling day.city", async () => {
      // User flies into ONT, picks up a rental car at ONT, and stays
      // at a Palm Desert hotel — all on the same arrival day. The
      // day's city should be Palm Desert (where they're sleeping),
      // not Ontario (where they landed and grabbed the car).
      const tripRes = await request(app)
        .post("/api/v1/trips")
        .send({
          title: "Coachella 2026",
          startDate: "2026-04-10",
          endDate: "2026-04-13",
        });
      const tripId = tripRes.body.id;

      const res = await request(app)
        .post("/api/v1/emails/apply")
        .send({
          segments: [
            {
              type: "flight",
              title: "SEA → ONT",
              date: "2026-04-10",
              departureCity: "Seattle",
              arrivalCity: "Ontario",
              arrivalAirport: "ONT",
              confirmationCode: "FL123",
              confidence: "high",
              tripId,
              emailId: "msg-flight",
            },
            {
              type: "car_rental",
              title: "Hertz pickup",
              date: "2026-04-10",
              city: "Ontario",
              venueName: "Hertz ONT",
              confirmationCode: "CR123",
              confidence: "high",
              tripId,
              emailId: "msg-car",
            },
            {
              type: "hotel",
              title: "JW Marriott Desert Springs",
              date: "2026-04-10",
              city: "Palm Desert",
              venueName: "JW Marriott Desert Springs",
              confirmationCode: "HT123",
              endDate: "2026-04-13",
              confidence: "high",
              tripId,
              emailId: "msg-hotel",
            },
          ],
        });

      expect(res.status).toBe(201);

      const tripCheck = await request(app).get(`/api/v1/trips/${tripId}`);
      const apr10 = tripCheck.body.days.find(
        (d: { date: string }) => d.date === "2026-04-10",
      );
      expect(apr10.city).toBe("Palm Desert");
    });
  });

  describe("GET /api/v1/emails/processed", () => {
    it("returns processed emails list", async () => {
      // Scan first to populate processed emails
      const scanRes = await request(app)
        .post("/api/v1/emails/scan")
        .send({});

      expect(scanRes.status).toBe(200);
      expect(scanRes.body.results).toHaveLength(3);

      // All emails are tracked (parsed + skipped)
      const res = await request(app).get("/api/v1/emails/processed");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
    });
  });

  describe("scan-vs-itinerary matching", () => {
    async function createJapanTrip() {
      const res = await request(app)
        .post("/api/v1/trips")
        .send({
          title: "Japan Trip",
          startDate: "2026-06-25",
          endDate: "2026-07-05",
        });
      return res.body.id as string;
    }

    async function addSegment(
      tripId: string,
      date: string,
      body: Record<string, unknown>,
    ) {
      const res = await request(app)
        .post(`/api/v1/trips/${tripId}/segments`)
        .send({ date, ...body });
      return res.body;
    }

    it("classifies an already-present segment as 'duplicate'", async () => {
      const tripId = await createJapanTrip();
      // Pre-add the exact flight that will be scanned
      await addSegment(tripId, "2026-06-26", {
        type: "flight",
        title: "SEA → NRT",
        startTime: "10:30",
        carrier: "AS",
        routeCode: "AS123",
        departureCity: "Seattle",
        arrivalCity: "Tokyo",
        seatNumber: "14A",
        confirmationCode: "ABCDEF",
      });

      const res = await request(app).post("/api/v1/emails/scan").send({});
      const flight = res.body.results[0].parsedSegments[0];
      expect(flight.match?.status).toBe("duplicate");
      expect(flight.match?.existingSegmentId).toBeDefined();
    });

    it("classifies a partially-matching segment as 'enrichment' with newFields", async () => {
      const tripId = await createJapanTrip();
      // Pre-add flight WITHOUT seat/carrier — scan should enrich with those
      await addSegment(tripId, "2026-06-26", {
        type: "flight",
        title: "SEA → NRT",
        routeCode: "AS123",
        departureCity: "Seattle",
        arrivalCity: "Tokyo",
      });

      const res = await request(app).post("/api/v1/emails/scan").send({});
      const flight = res.body.results[0].parsedSegments[0];
      expect(flight.match?.status).toBe("enrichment");
      expect(flight.match?.newFields).toEqual(
        expect.arrayContaining(["startTime", "carrier", "seatNumber", "confirmationCode"]),
      );
    });

    it("classifies a segment with differing field values as 'conflict'", async () => {
      const tripId = await createJapanTrip();
      // Existing flight has different departure time
      await addSegment(tripId, "2026-06-26", {
        type: "flight",
        title: "SEA → NRT",
        startTime: "08:00",
        routeCode: "AS123",
        departureCity: "Seattle",
        arrivalCity: "Tokyo",
      });

      const res = await request(app).post("/api/v1/emails/scan").send({});
      const flight = res.body.results[0].parsedSegments[0];
      expect(flight.match?.status).toBe("conflict");
      const startTimeDiff = flight.match?.conflictFields?.find(
        (d: { field: string }) => d.field === "startTime",
      );
      expect(startTimeDiff).toBeDefined();
      expect(startTimeDiff.existing).toBe("08:00");
      expect(startTimeDiff.parsed).toBe("10:30");
    });

    it("classifies an unrelated segment as 'new'", async () => {
      const tripId = await createJapanTrip();
      // Add an unrelated hotel; flight scan should be "new"
      await addSegment(tripId, "2026-06-26", {
        type: "hotel",
        title: "Andaz Tokyo",
        venueName: "Andaz Tokyo",
      });

      const res = await request(app).post("/api/v1/emails/scan").send({});
      const flight = res.body.results[0].parsedSegments[0];
      expect(flight.match?.status).toBe("new");
      expect(flight.match?.existingSegmentId).toBeUndefined();
    });

    it("does not merge a return flight onto the outbound leg of the same PNR", async () => {
      // Regression: a round-trip airline ticket reuses one PNR across
      // both legs. Previously, isCandidateMatch short-circuited on a
      // confirmation-code match before checking date/direction, so an
      // ONT→SEA return leg parsed from email would collapse onto the
      // existing SEA→ONT outbound leg and the UI would propose flipping
      // every field (cities, times, route code, seats). The fix: skip
      // the confirmation-code-only shortcut for flights and fall through
      // to the date + route/city check below it.
      const tripRes = await request(app).post("/api/v1/trips").send({
        title: "Palm Desert 2026",
        startDate: "2026-06-18",
        endDate: "2026-06-21",
      });
      const tripId = tripRes.body.id;

      // Pre-add the outbound leg with the round-trip PNR.
      await addSegment(tripId, "2026-06-18", {
        type: "flight",
        title: "SEA → ONT",
        startTime: "10:30",
        endTime: "13:13",
        carrier: "AS",
        routeCode: "AS565",
        departureCity: "Seattle",
        arrivalCity: "Ontario",
        departureAirport: "SEA",
        arrivalAirport: "ONT",
        seatNumber: "11A, 11B, 11C, 11D",
        confirmationCode: "ITHZXM",
      });

      // Import the return-leg email (same PNR, different date/direction).
      const res = await request(app)
        .post("/api/v1/emails/import-html")
        .send({
          html: "<p>ONT return</p>",
          subject: "ONT return flight confirmation",
        });
      expect(res.status).toBe(201);
      const seg = res.body.result.parsedSegments[0];
      expect(seg.suggestedTripId).toBe(tripId);
      // The fix: parser-extracted return leg must NOT be matched to the
      // outbound segment just because the PNR is shared.
      expect(seg.match?.status).toBe("new");
      expect(seg.match?.existingSegmentId).toBeUndefined();
    });

    it("does not flag the flight title as a conflict when the existing title carries a carrier suffix", async () => {
      // Regression: existing flight stored as "SEA → CDG (Air France 337)"
      // (the trip-detail display format with carrier+routeCode baked in);
      // parser returns the bare route "SEA → CDG" with the carrier/routeCode
      // in dedicated fields. Previously these normalized differently and the
      // matcher surfaced a meaningless "title conflict". The route, carrier,
      // and routeCode all match, so the parsed segment should classify as
      // `duplicate` (or `enrichment` if it brings new fields).
      const tripRes = await request(app).post("/api/v1/trips").send({
        title: "Sicily 2026",
        startDate: "2026-06-25",
        endDate: "2026-07-05",
      });
      await addSegment(tripRes.body.id, "2026-06-26", {
        type: "flight",
        title: "SEA → CDG (Air France 337)",
        startTime: "13:30",
        carrier: "Air France",
        routeCode: "337",
        departureCity: "Seattle",
        arrivalCity: "Paris",
        departureAirport: "SEA",
        arrivalAirport: "CDG",
        confirmationCode: "CC4GJZ",
      });

      const res = await request(app)
        .post("/api/v1/emails/import-html")
        .send({
          html: "<p>Air France itinerary</p>",
          subject: "Air France booking confirmation",
        });
      const seg = res.body.result.parsedSegments[0];
      expect(seg.match?.status).not.toBe("new");
      expect(
        seg.match?.conflictFields?.find(
          (d: { field: string }) => d.field === "title",
        ),
      ).toBeUndefined();
    });

    it("matches a hotel even when one venueName has an extra qualifier word", async () => {
      // Regression: parsed "Villa Fiorita Hotel" should still match the
      // existing "Villa Fiorita Boutique Hotel". Token-subset overlap is the
      // signal — the parsed booking is the same property under a slightly
      // shorter name.
      const tripRes = await request(app).post("/api/v1/trips").send({
        title: "Sicily 2026",
        startDate: "2026-06-25",
        endDate: "2026-07-05",
      });
      await addSegment(tripRes.body.id, "2026-06-29", {
        type: "hotel",
        title: "Villa Fiorita Boutique Hotel",
        venueName: "Villa Fiorita Boutique Hotel",
        city: "Taormina",
      });

      const res = await request(app)
        .post("/api/v1/emails/import-html")
        .send({
          html: "<p>Villa Fiorita booking</p>",
          subject: "Villa Fiorita confirmation",
        });
      const seg = res.body.result.parsedSegments[0];
      expect(seg.match?.status).not.toBe("new");
      expect(seg.match?.existingSegmentId).toBeDefined();
    });

    it("matches a hotel across minor name variants and does not flag a postal-superset address", async () => {
      // Regression: parsed venueName "Castello di San Marco Charming Hotel
      // & Spa" should match existing "Castello San Marco Charming Hotel &
      // SPA" (Jaccard ≥ 0.6 — only the word "di" differs). The parsed
      // address is the same street with postal code + country tacked on, so
      // it should be treated as a superset (no conflict).
      const tripRes = await request(app).post("/api/v1/trips").send({
        title: "Sicily 2026",
        startDate: "2026-06-25",
        endDate: "2026-07-05",
      });
      await addSegment(tripRes.body.id, "2026-06-30", {
        type: "hotel",
        title: "Castello San Marco Charming Hotel & SPA",
        venueName: "Castello San Marco Charming Hotel & SPA",
        address: "Via San Marco, 40, Calatabiano",
        city: "Calatabiano",
      });

      const res = await request(app)
        .post("/api/v1/emails/import-html")
        .send({
          html: "<p>Castello booking</p>",
          subject: "Castello di San Marco booking",
        });
      const seg = res.body.result.parsedSegments[0];
      expect(seg.match?.status).not.toBe("new");
      expect(
        seg.match?.conflictFields?.find(
          (d: { field: string }) => d.field === "address",
        ),
      ).toBeUndefined();
    });

    it("cross-matches a parsed restaurant_dinner against an existing activity at the same venue", async () => {
      // Regression: when the user manually adds a dinner reservation as
      // `activity`, the email parser later classifies the same booking as
      // `restaurant_dinner`. Same date, same venueName — the matcher should
      // collapse them so the parsed copy doesn't show as "New".
      const tripRes = await request(app).post("/api/v1/trips").send({
        title: "Sicily 2026",
        startDate: "2026-06-25",
        endDate: "2026-07-05",
      });
      await addSegment(tripRes.body.id, "2026-06-29", {
        type: "activity",
        title: "Dinner at Principe Cerami",
        startTime: "20:00",
        venueName: "Principe Cerami",
      });

      const res = await request(app)
        .post("/api/v1/emails/import-html")
        .send({
          html: "<p>Cerami reservation</p>",
          subject: "Principe Cerami reservation",
        });
      const seg = res.body.result.parsedSegments[0];
      expect(seg.match?.status).not.toBe("new");
      expect(seg.match?.existingSegmentId).toBeDefined();
    });

    it("merge action fills empty fields on existing segment without overwriting", async () => {
      const tripId = await createJapanTrip();
      const existing = await addSegment(tripId, "2026-06-26", {
        type: "flight",
        title: "SEA → NRT",
        startTime: "10:30",
        routeCode: "AS123",
        departureCity: "Seattle",
        arrivalCity: "Tokyo",
      });

      await request(app)
        .post("/api/v1/emails/apply")
        .send({
          segments: [
            {
              type: "flight",
              title: "SEA → NRT changed",
              date: "2026-06-26",
              startTime: "10:30",
              carrier: "AS",
              routeCode: "AS123",
              seatNumber: "14A",
              confirmationCode: "ABCDEF",
              confidence: "high",
              tripId,
              emailId: "msg-001",
              action: "merge",
              existingSegmentId: existing.id,
            },
          ],
        });

      const tripRes = await request(app).get(`/api/v1/trips/${tripId}`);
      const day = tripRes.body.days.find((d: { date: string }) => d.date === "2026-06-26");
      expect(day.segments).toHaveLength(1);
      const seg = day.segments[0];
      // Empty fields filled in
      expect(seg.carrier).toBe("AS");
      expect(seg.seatNumber).toBe("14A");
      expect(seg.confirmationCode).toBe("ABCDEF");
      // Existing non-empty fields preserved
      expect(seg.title).toBe("SEA → NRT");
    });

    it("replace action overwrites existing field values", async () => {
      const tripId = await createJapanTrip();
      const existing = await addSegment(tripId, "2026-06-26", {
        type: "flight",
        title: "SEA → NRT (old)",
        startTime: "08:00",
        routeCode: "AS123",
      });

      await request(app)
        .post("/api/v1/emails/apply")
        .send({
          segments: [
            {
              type: "flight",
              title: "SEA → NRT",
              date: "2026-06-26",
              startTime: "10:30",
              routeCode: "AS123",
              confidence: "high",
              tripId,
              emailId: "msg-001",
              action: "replace",
              existingSegmentId: existing.id,
            },
          ],
        });

      const tripRes = await request(app).get(`/api/v1/trips/${tripId}`);
      const day = tripRes.body.days.find((d: { date: string }) => d.date === "2026-06-26");
      expect(day.segments).toHaveLength(1);
      expect(day.segments[0].title).toBe("SEA → NRT");
      expect(day.segments[0].startTime).toBe("10:30");
    });

    it("rejects an apply when a segment's date falls outside the selected trip's range", async () => {
      // Regression: previously the apply route silently `continue`d past
      // any segment whose date didn't match a trip.days[] entry, AND still
      // marked the source email as `mapped`. The booking effectively
      // vanished — no segment created, no error surfaced, and the email
      // never reappeared in pending. Now the whole request is rejected
      // with a specific 400 so the UI can tell the user to either pick a
      // different trip or fix the date.
      const tripRes = await request(app).post("/api/v1/trips").send({
        title: "Sicily 2026",
        startDate: "2026-06-25",
        endDate: "2026-07-05",
      });
      const res = await request(app)
        .post("/api/v1/emails/apply")
        .send({
          segments: [
            {
              type: "hotel",
              title: "Villa Fiorita",
              date: "2026-03-29", // outside the trip window
              confidence: "medium",
              tripId: tripRes.body.id,
              emailId: "msg-out-of-range",
              action: "create",
            },
          ],
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("OUT_OF_RANGE");
      expect(res.body.error).toContain("Villa Fiorita");
      expect(res.body.error).toContain("2026-03-29");
      expect(res.body.segments).toHaveLength(1);
      expect(res.body.segments[0].date).toBe("2026-03-29");
      expect(res.body.segments[0].tripStartDate).toBe("2026-06-25");

      // No segment was created and the source email was NOT marked as
      // mapped — the user can fix the date and retry.
      const tripCheck = await request(app).get(`/api/v1/trips/${tripRes.body.id}`);
      const totalSegments = tripCheck.body.days.reduce(
        (n: number, d: { segments: unknown[] }) => n + d.segments.length,
        0,
      );
      expect(totalSegments).toBe(0);
      const processed = await storage.getProcessedEmails();
      const sourceEmail = processed.find(
        (p) => p.gmailMessageId === "msg-out-of-range",
      );
      expect(sourceEmail?.parseStatus).not.toBe("mapped");
    });

    it("rejects a partially out-of-range apply atomically — does not create the in-range segments either", async () => {
      // If we created the in-range segments and only flagged the out-of-
      // range one, the user would lose the parsed copy of the rejected
      // segment (it'd be gone from the email-scan review UI but never
      // make it to the trip). All-or-nothing keeps the review state
      // consistent and lets the user retry after fixing the bad row.
      const tripRes = await request(app).post("/api/v1/trips").send({
        title: "Sicily 2026",
        startDate: "2026-06-25",
        endDate: "2026-07-05",
      });
      const res = await request(app)
        .post("/api/v1/emails/apply")
        .send({
          segments: [
            {
              type: "activity",
              title: "Wine tasting",
              date: "2026-06-28", // in-range
              confidence: "high",
              tripId: tripRes.body.id,
              emailId: "msg-good",
              action: "create",
            },
            {
              type: "hotel",
              title: "Villa Fiorita",
              date: "2026-03-29", // out-of-range
              confidence: "medium",
              tripId: tripRes.body.id,
              emailId: "msg-bad",
              action: "create",
            },
          ],
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("OUT_OF_RANGE");

      const tripCheck = await request(app).get(`/api/v1/trips/${tripRes.body.id}`);
      const totalSegments = tripCheck.body.days.reduce(
        (n: number, d: { segments: unknown[] }) => n + d.segments.length,
        0,
      );
      expect(totalSegments).toBe(0);
    });

    it("does not block merge/replace actions on dates that drift outside the trip range", async () => {
      // Merge/replace target an existing segment by id, not by date — the
      // segment is already on a real day in the trip, so `seg.date` is
      // irrelevant. A parser that pulls a slightly-off date shouldn't
      // block the user from updating the existing booking.
      const tripRes = await request(app).post("/api/v1/trips").send({
        title: "Sicily 2026",
        startDate: "2026-06-25",
        endDate: "2026-07-05",
      });
      const existing = await addSegment(tripRes.body.id, "2026-06-29", {
        type: "hotel",
        title: "Villa Fiorita Boutique Hotel",
        venueName: "Villa Fiorita Boutique Hotel",
      });

      const res = await request(app)
        .post("/api/v1/emails/apply")
        .send({
          segments: [
            {
              type: "hotel",
              title: "Villa Fiorita Hotel",
              date: "2026-03-29", // outside the trip — but merge targets the existing day
              confidence: "medium",
              tripId: tripRes.body.id,
              emailId: "msg-merge",
              action: "merge",
              existingSegmentId: existing.id,
            },
          ],
        });
      expect(res.status).toBe(201);
      expect(res.body.updated).toHaveLength(1);
    });

    it("create action still adds a new segment even when existingSegmentId is present", async () => {
      const tripId = await createJapanTrip();
      const existing = await addSegment(tripId, "2026-06-26", {
        type: "flight",
        title: "Existing flight",
        routeCode: "AS123",
      });

      await request(app)
        .post("/api/v1/emails/apply")
        .send({
          segments: [
            {
              type: "flight",
              title: "Second flight",
              date: "2026-06-26",
              routeCode: "AS123",
              confidence: "high",
              tripId,
              emailId: "msg-001",
              action: "create",
              existingSegmentId: existing.id, // should be ignored
            },
          ],
        });

      const tripRes = await request(app).get(`/api/v1/trips/${tripId}`);
      const day = tripRes.body.days.find((d: { date: string }) => d.date === "2026-06-26");
      expect(day.segments).toHaveLength(2);
    });
  });

  describe("POST /api/v1/emails/dismiss/:emailId", () => {
    it("marks email as skipped", async () => {
      const res = await request(app)
        .post("/api/v1/emails/dismiss/msg-999");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("dismissed");

      const processed = await storage.getProcessedEmails();
      const dismissed = processed.find((e) => e.gmailMessageId === "msg-999");
      expect(dismissed?.parseStatus).toBe("skipped");
    });

    it("updates existing parsed email to skipped and clears rawParseResult", async () => {
      // Scan first to create parsed records
      await request(app)
        .post("/api/v1/emails/scan")
        .send({});

      // Dismiss msg-001
      await request(app)
        .post("/api/v1/emails/dismiss/msg-001");

      const processed = await storage.getProcessedEmails();
      const dismissed = processed.find((e) => e.gmailMessageId === "msg-001");
      expect(dismissed?.parseStatus).toBe("skipped");
      expect(dismissed?.rawParseResult).toBeUndefined();
    });
  });

  describe("POST /api/v1/emails/import-html", () => {
    it("rejects a request with missing html", async () => {
      const res = await request(app)
        .post("/api/v1/emails/import-html")
        .send({});
      expect(res.status).toBe(400);
    });

    it("rejects empty html", async () => {
      const res = await request(app)
        .post("/api/v1/emails/import-html")
        .send({ html: "" });
      expect(res.status).toBe(400);
    });

    it("parses HTML and returns extracted segments", async () => {
      const res = await request(app)
        .post("/api/v1/emails/import-html")
        .send({
          html: "<html><body>Palazzo Natoli booking</body></html>",
          subject: "Palazzo Natoli confirmation",
          from: "reservations@palazzo.example",
        });

      expect(res.status).toBe(201);
      expect(res.body.result).toBeDefined();
      expect(res.body.result.parseStatus).toBe("success");
      expect(res.body.result.parsedSegments).toHaveLength(1);
      expect(res.body.result.parsedSegments[0].type).toBe("hotel");
      expect(res.body.result.parsedSegments[0].title).toBe("Palazzo Natoli");
      expect(res.body.result.parsedSegments[0].city).toBe("Palermo");
      expect(res.body.result.emailId).toMatch(/^html-import-/);
    });

    it("persists a synthetic processed email record so /emails/apply can close it", async () => {
      const res = await request(app)
        .post("/api/v1/emails/import-html")
        .send({
          html: "<p>Palazzo Natoli</p>",
          subject: "Palazzo Natoli confirmation",
        });
      expect(res.status).toBe(201);
      const emailId = res.body.result.emailId;

      const processed = await storage.getProcessedEmails();
      const record = processed.find((e) => e.gmailMessageId === emailId);
      expect(record).toBeDefined();
      expect(record?.parseStatus).toBe("parsed");
      expect(record?.rawParseResult).toBeDefined();
      expect(record?.subject).toBe("Palazzo Natoli confirmation");
    });

    it("auto-matches parsed segments to a trip when the date falls in range", async () => {
      const tripRes = await request(app).post("/api/v1/trips").send({
        title: "Sicily 2026",
        startDate: "2026-06-10",
        endDate: "2026-06-20",
      });
      const tripId = tripRes.body.id;

      const res = await request(app)
        .post("/api/v1/emails/import-html")
        .send({
          html: "<p>Palazzo booking</p>",
          subject: "Palazzo Natoli confirmation",
        });
      expect(res.status).toBe(201);
      const seg = res.body.result.parsedSegments[0];
      expect(seg.suggestedTripId).toBe(tripId);
      expect(seg.match?.status).toBe("new");
    });

    it("ignores a tripId hint whose range doesn't cover the parsed date and falls back to date-based search", async () => {
      // Regression: scanning emails from a specific trip's page used to
      // force every parsed segment onto that trip via the tripId hint,
      // even when the date pointed somewhere else. The hint should be
      // a soft suggestion — when it's out of range the matcher needs to
      // fall through to a date-range search so the UI can route the
      // segment to the right trip instead of trapping it on the wrong
      // one (where the apply guard would then 400).
      const sicily = await request(app).post("/api/v1/trips").send({
        title: "Sicily 2026",
        startDate: "2026-06-25",
        endDate: "2026-07-05",
      });
      const palermoEarly = await request(app).post("/api/v1/trips").send({
        title: "Palermo trip",
        startDate: "2026-06-10",
        endDate: "2026-06-20",
      });

      // Parsed date 2026-06-15 falls in Palermo trip's window, not Sicily's.
      const res = await request(app)
        .post("/api/v1/emails/import-html")
        .send({
          html: "<p>Palazzo</p>",
          subject: "Palazzo Natoli confirmation",
          tripId: sicily.body.id,
        });
      expect(res.body.result.parsedSegments[0].suggestedTripId).toBe(
        palermoEarly.body.id,
      );
    });

    it("leaves suggestedTripId blank in a trip-scoped scan when no trip covers the parsed date", async () => {
      // Same fix as above, but with no other trip to fall back to —
      // the server hands the segment back unmatched so the client can
      // offer a new-trip proposal (the "create a trip for it" UX) the
      // user gets when scanning from the trips homepage.
      const sicily = await request(app).post("/api/v1/trips").send({
        title: "Sicily 2026",
        startDate: "2026-06-25",
        endDate: "2026-07-05",
      });
      const res = await request(app)
        .post("/api/v1/emails/import-html")
        .send({
          html: "<p>Palazzo</p>",
          subject: "Palazzo Natoli confirmation",
          tripId: sicily.body.id,
        });
      expect(res.body.result.parsedSegments[0].suggestedTripId).toBeUndefined();
    });

    it("returns no_travel_content when the HTML has nothing to extract", async () => {
      const res = await request(app)
        .post("/api/v1/emails/import-html")
        .send({
          html: "<p>Just a newsletter</p>",
          subject: "Weekly Newsletter",
        });
      expect(res.status).toBe(201);
      expect(res.body.result.parseStatus).toBe("no_travel_content");
      expect(res.body.result.parsedSegments).toHaveLength(0);

      // no-travel imports should NOT be persisted as pending records
      const processed = await storage.getProcessedEmails();
      expect(
        processed.some(
          (e) => e.gmailMessageId === res.body.result.emailId,
        ),
      ).toBe(false);
    });

    it("marks the import as failed when all parsed items fail validation", async () => {
      const res = await request(app)
        .post("/api/v1/emails/import-html")
        .send({
          html: "<p>Something</p>",
          subject: "Invalid email blob",
        });
      expect(res.status).toBe(201);
      expect(res.body.result.parseStatus).toBe("failed");
      expect(res.body.result.error).toBeDefined();
    });

    it("lets /emails/apply consume an HTML import via its synthetic emailId", async () => {
      const tripRes = await request(app).post("/api/v1/trips").send({
        title: "Sicily 2026",
        startDate: "2026-06-10",
        endDate: "2026-06-20",
      });
      const tripId = tripRes.body.id;

      const importRes = await request(app)
        .post("/api/v1/emails/import-html")
        .send({
          html: "<p>Palazzo</p>",
          subject: "Palazzo Natoli confirmation",
        });
      expect(importRes.status).toBe(201);
      const seg = importRes.body.result.parsedSegments[0];
      const emailId = importRes.body.result.emailId;

      const applyRes = await request(app)
        .post("/api/v1/emails/apply")
        .send({
          segments: [
            {
              type: seg.type,
              title: seg.title,
              date: seg.date,
              city: seg.city,
              venueName: seg.venueName,
              confirmationCode: seg.confirmationCode,
              endDate: seg.endDate,
              cost: seg.cost,
              confidence: seg.confidence,
              tripId,
              emailId,
            },
          ],
        });
      expect(applyRes.status).toBe(201);
      expect(applyRes.body.created).toHaveLength(1);

      // The synthetic processed-email record should now be "mapped"
      const processed = await storage.getProcessedEmails();
      const record = processed.find((e) => e.gmailMessageId === emailId);
      expect(record?.parseStatus).toBe("mapped");
      expect(record?.rawParseResult).toBeUndefined();
    });

    it("rejects a payload with neither html nor eml", async () => {
      const res = await request(app)
        .post("/api/v1/emails/import-html")
        .send({ subject: "orphan" });
      expect(res.status).toBe(400);
    });

    it("rejects a payload with both html and eml", async () => {
      const res = await request(app)
        .post("/api/v1/emails/import-html")
        .send({ html: "<p>hi</p>", eml: "From: a@b.com\r\n\r\nbody" });
      expect(res.status).toBe(400);
    });

    it("parses an EML payload and extracts segments", async () => {
      const eml = [
        "From: reservations@palazzo.example",
        "Subject: Palazzo Natoli confirmation",
        "Date: Fri, 15 May 2026 09:00:00 +0000",
        "",
        "Palazzo Natoli booking body",
        "",
      ].join("\r\n");

      const res = await request(app)
        .post("/api/v1/emails/import-html")
        .send({ eml });

      expect(res.status).toBe(201);
      expect(res.body.result.parseStatus).toBe("success");
      expect(res.body.result.parsedSegments).toHaveLength(1);
      expect(res.body.result.parsedSegments[0].type).toBe("hotel");
      expect(res.body.result.emailId).toMatch(/^eml-import-/);
    });

    it("surfaces subject/from/receivedAt decoded from EML headers when caller omits them", async () => {
      const eml = [
        "From: reservations@palazzo.example",
        "Subject: Palazzo Natoli confirmation",
        "Date: Fri, 15 May 2026 09:00:00 +0000",
        "",
        "body",
        "",
      ].join("\r\n");

      const res = await request(app)
        .post("/api/v1/emails/import-html")
        .send({ eml });

      expect(res.status).toBe(201);
      expect(res.body.result.subject).toBe("Palazzo Natoli confirmation");
      expect(res.body.result.from).toBe("reservations@palazzo.example");
      expect(res.body.result.receivedAt).toBe("2026-05-15T09:00:00.000Z");
    });

    it("caller-provided subject/from override EML headers", async () => {
      const eml = [
        "From: reservations@palazzo.example",
        "Subject: Palazzo Natoli confirmation",
        "",
        "body",
        "",
      ].join("\r\n");

      const res = await request(app)
        .post("/api/v1/emails/import-html")
        .send({
          eml,
          subject: "Palazzo override subject",
          from: "manual@override.example",
        });

      expect(res.status).toBe(201);
      expect(res.body.result.subject).toBe("Palazzo override subject");
      expect(res.body.result.from).toBe("manual@override.example");
    });

    it("persists an EML import under an eml-import-* emailId", async () => {
      const eml = [
        "From: reservations@palazzo.example",
        "Subject: Palazzo Natoli confirmation",
        "",
        "body",
        "",
      ].join("\r\n");

      const res = await request(app)
        .post("/api/v1/emails/import-html")
        .send({ eml });
      expect(res.status).toBe(201);
      const emailId = res.body.result.emailId;
      expect(emailId).toMatch(/^eml-import-/);

      const processed = await storage.getProcessedEmails();
      const record = processed.find((e) => e.gmailMessageId === emailId);
      expect(record?.parseStatus).toBe("parsed");
      expect(record?.subject).toBe("Palazzo Natoli confirmation");
    });
  });

  describe("POST /api/v1/emails/import-shared", () => {
    it("rejects a request with neither text nor url", async () => {
      const res = await request(app)
        .post("/api/v1/emails/import-shared")
        .send({ title: "no body" });
      expect(res.status).toBe(400);
    });

    it("rejects a non-http(s) URL", async () => {
      const res = await request(app)
        .post("/api/v1/emails/import-shared")
        .send({ url: "ftp://example.com/booking" });
      expect(res.status).toBe(400);
    });

    it("rejects a URL pointing at loopback", async () => {
      const res = await request(app)
        .post("/api/v1/emails/import-shared")
        .send({ url: "http://127.0.0.1/booking" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/private|loopback/i);
    });

    it("rejects a URL pointing at the AWS / GCE metadata host", async () => {
      const res = await request(app)
        .post("/api/v1/emails/import-shared")
        .send({ url: "http://169.254.169.254/latest/meta-data/" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/private|loopback/i);
    });

    it("parses shared text and returns extracted segments", async () => {
      const res = await request(app)
        .post("/api/v1/emails/import-shared")
        .send({
          title: "Palazzo Natoli confirmation",
          text: "Palazzo Natoli booking, check-in June 15, 2026.",
        });

      expect(res.status).toBe(201);
      expect(res.body.result.parseStatus).toBe("success");
      expect(res.body.result.parsedSegments).toHaveLength(1);
      expect(res.body.result.parsedSegments[0].type).toBe("hotel");
      expect(res.body.result.emailId).toMatch(/^share-import-/);
    });

    it("auto-matches a parsed share to a trip whose date range covers the segment", async () => {
      const tripRes = await request(app).post("/api/v1/trips").send({
        title: "Sicily 2026",
        startDate: "2026-06-10",
        endDate: "2026-06-20",
      });
      const tripId = tripRes.body.id;

      const res = await request(app)
        .post("/api/v1/emails/import-shared")
        .send({
          title: "Palazzo Natoli confirmation",
          text: "Palazzo booking",
        });
      expect(res.status).toBe(201);
      expect(res.body.result.parsedSegments[0].suggestedTripId).toBe(tripId);
    });

    it("persists a synthetic processed-email record so /emails/apply can close it", async () => {
      const res = await request(app)
        .post("/api/v1/emails/import-shared")
        .send({
          title: "Palazzo Natoli confirmation",
          text: "Palazzo booking",
        });
      expect(res.status).toBe(201);
      const emailId = res.body.result.emailId;

      const processed = await storage.getProcessedEmails();
      const record = processed.find((e) => e.gmailMessageId === emailId);
      expect(record).toBeDefined();
      expect(record?.parseStatus).toBe("parsed");
    });

    it("returns no_travel_content when the share has nothing to extract", async () => {
      const res = await request(app)
        .post("/api/v1/emails/import-shared")
        .send({
          title: "Weekly Newsletter",
          text: "Just a newsletter — no travel here.",
        });
      expect(res.status).toBe(201);
      expect(res.body.result.parseStatus).toBe("no_travel_content");
      expect(res.body.result.parsedSegments).toHaveLength(0);
    });

    it("lets /emails/apply consume a shared import via its synthetic emailId", async () => {
      const tripRes = await request(app).post("/api/v1/trips").send({
        title: "Sicily 2026",
        startDate: "2026-06-10",
        endDate: "2026-06-20",
      });
      const tripId = tripRes.body.id;

      const importRes = await request(app)
        .post("/api/v1/emails/import-shared")
        .send({
          title: "Palazzo Natoli confirmation",
          text: "Palazzo booking",
        });
      const seg = importRes.body.result.parsedSegments[0];
      const emailId = importRes.body.result.emailId;

      const applyRes = await request(app)
        .post("/api/v1/emails/apply")
        .send({
          segments: [
            {
              type: seg.type,
              title: seg.title,
              date: seg.date,
              city: seg.city,
              venueName: seg.venueName,
              confirmationCode: seg.confirmationCode,
              endDate: seg.endDate,
              cost: seg.cost,
              confidence: seg.confidence,
              tripId,
              emailId,
            },
          ],
        });
      expect(applyRes.status).toBe(201);
      expect(applyRes.body.created).toHaveLength(1);

      const processed = await storage.getProcessedEmails();
      const record = processed.find((e) => e.gmailMessageId === emailId);
      expect(record?.parseStatus).toBe("mapped");
    });

    it("fetches a shared URL and runs the page HTML through the parser", async () => {
      const originalFetch = global.fetch;
      const palazzoHtml =
        "<html><body><h1>Palazzo Natoli booking</h1></body></html>";
      const mockFetch = jest.fn().mockResolvedValue(
        new Response(palazzoHtml, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
      // @ts-expect-error overwriting the global for the duration of the test
      global.fetch = mockFetch;
      try {
        const res = await request(app)
          .post("/api/v1/emails/import-shared")
          .send({
            title: "Palazzo Natoli confirmation",
            url: "https://booking.example.com/palazzo",
          });
        expect(res.status).toBe(201);
        expect(res.body.result.parseStatus).toBe("success");
        expect(res.body.result.parsedSegments[0].type).toBe("hotel");
        expect(mockFetch).toHaveBeenCalledWith(
          "https://booking.example.com/palazzo",
          expect.objectContaining({ method: "GET" }),
        );
      } finally {
        global.fetch = originalFetch;
      }
    });

    it("returns 400 when the shared URL responds with a non-text content type", async () => {
      const originalFetch = global.fetch;
      const mockFetch = jest.fn().mockResolvedValue(
        new Response("not html", {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        }),
      );
      // @ts-expect-error overwriting the global for the duration of the test
      global.fetch = mockFetch;
      try {
        const res = await request(app)
          .post("/api/v1/emails/import-shared")
          .send({ url: "https://booking.example.com/binary" });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/HTML|content type/i);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
