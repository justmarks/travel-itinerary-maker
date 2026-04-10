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
jest.mock("../../src/services/email-parser", () => {
  return {
    EmailParser: jest.fn().mockImplementation(() => ({
      parseEmail: jest.fn().mockImplementation(
        (email: { subject: string }) => {
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
          // Newsletter - no travel content
          return Promise.resolve({
            segments: [],
            invalidCount: 0,
            rawItemCount: 0,
          });
        },
      ),
    })),
  };
});

let storage: InMemoryStorage;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  storage = new InMemoryStorage();
  app = createApp({ mode: "memory", storage });
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
});
