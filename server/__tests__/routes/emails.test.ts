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

// Mock the EmailParser
jest.mock("../../src/services/email-parser", () => {
  return {
    EmailParser: jest.fn().mockImplementation(() => ({
      parseEmail: jest.fn().mockImplementation(
        (email: { subject: string }) => {
          if (email.subject.includes("Alaska Airlines")) {
            return Promise.resolve([
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
            ]);
          }
          if (email.subject.includes("Hilton")) {
            return Promise.resolve([
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
            ]);
          }
          // Newsletter - no travel content
          return Promise.resolve([]);
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

    it("saves processed email records", async () => {
      await request(app)
        .post("/api/v1/emails/scan")
        .send({});

      const processed = await storage.getProcessedEmails();
      expect(processed).toHaveLength(3);
      expect(processed[0].gmailMessageId).toBe("msg-001");
      expect(processed[0].parseStatus).toBe("parsed");
      expect(processed[2].parseStatus).toBe("skipped");
    });

    it("skips already-processed emails", async () => {
      // First scan
      await request(app)
        .post("/api/v1/emails/scan")
        .send({});

      // Second scan — all already processed
      const res = await request(app)
        .post("/api/v1/emails/scan")
        .send({});

      expect(res.status).toBe(200);
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

      // The scan should have processed 3 emails
      expect(scanRes.status).toBe(200);
      expect(scanRes.body.results).toHaveLength(3);

      const res = await request(app).get("/api/v1/emails/processed");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
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

    it("updates existing processed email to skipped", async () => {
      // Scan first to create processed records
      await request(app)
        .post("/api/v1/emails/scan")
        .send({});

      // Dismiss msg-001
      await request(app)
        .post("/api/v1/emails/dismiss/msg-001");

      const processed = await storage.getProcessedEmails();
      const dismissed = processed.find((e) => e.gmailMessageId === "msg-001");
      expect(dismissed?.parseStatus).toBe("skipped");
    });
  });
});
