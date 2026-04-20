const mockCreate = jest.fn();

jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

import { EmailParser } from "../../src/services/email-parser";

function aiResponse(text: string) {
  return { content: [{ type: "text", text }] };
}

describe("EmailParser.parseEmail", () => {
  let parser: EmailParser;

  beforeEach(() => {
    jest.clearAllMocks();
    parser = new EmailParser({ apiKey: "test-key" });
  });

  it("returns empty result when Claude returns an empty array", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse("[]"));
    const result = await parser.parseEmail({
      subject: "Newsletter",
      from: "news@example.com",
      body: "Hello world",
    });
    expect(result.segments).toEqual([]);
    expect(result.invalidCount).toBe(0);
    expect(result.rawItemCount).toBe(0);
  });

  it("parses a valid flight segment", async () => {
    mockCreate.mockResolvedValueOnce(
      aiResponse(
        JSON.stringify([
          {
            type: "flight",
            title: "SEA → NRT",
            date: "2026-06-26",
            startTime: "10:30",
            city: "Tokyo",
            confidence: "high",
          },
        ]),
      ),
    );
    const result = await parser.parseEmail({
      subject: "Flight confirmation",
      from: "alaska@alaskaair.com",
      body: "Your flight details...",
    });
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].type).toBe("flight");
    expect(result.segments[0].title).toBe("SEA → NRT");
    expect(result.rawItemCount).toBe(1);
    expect(result.invalidCount).toBe(0);
  });

  it("normalizes 12-hour AM/PM time strings to 24-hour HH:MM", async () => {
    mockCreate.mockResolvedValueOnce(
      aiResponse(
        JSON.stringify([
          {
            type: "flight",
            title: "SEA → LAX",
            date: "2026-07-01",
            startTime: "4:00 PM",
            endTime: "7:30 PM",
            city: "Los Angeles",
            confidence: "high",
          },
        ]),
      ),
    );
    const result = await parser.parseEmail({
      subject: "Flight",
      from: "airline@test.com",
      body: "...",
    });
    expect(result.segments[0].startTime).toBe("16:00");
    expect(result.segments[0].endTime).toBe("19:30");
  });

  it("normalizes midnight (12:00 AM) correctly", async () => {
    mockCreate.mockResolvedValueOnce(
      aiResponse(
        JSON.stringify([
          {
            type: "flight",
            title: "Red Eye",
            date: "2026-08-01",
            startTime: "12:00 AM",
            city: "NYC",
            confidence: "high",
          },
        ]),
      ),
    );
    const result = await parser.parseEmail({
      subject: "Flight",
      from: "airline@test.com",
      body: "...",
    });
    expect(result.segments[0].startTime).toBe("00:00");
  });

  it("normalizes noon (12:00 PM) correctly", async () => {
    mockCreate.mockResolvedValueOnce(
      aiResponse(
        JSON.stringify([
          {
            type: "flight",
            title: "Noon Flight",
            date: "2026-08-02",
            startTime: "12:00 PM",
            city: "Chicago",
            confidence: "high",
          },
        ]),
      ),
    );
    const result = await parser.parseEmail({
      subject: "Flight",
      from: "airline@test.com",
      body: "...",
    });
    expect(result.segments[0].startTime).toBe("12:00");
  });

  it("applies default hotel check-in (15:00) and check-out (11:00) times when absent", async () => {
    mockCreate.mockResolvedValueOnce(
      aiResponse(
        JSON.stringify([
          {
            type: "hotel",
            title: "Hilton Seattle",
            date: "2026-07-01",
            city: "Seattle",
            confidence: "high",
          },
        ]),
      ),
    );
    const result = await parser.parseEmail({
      subject: "Hotel confirmation",
      from: "hilton@hilton.com",
      body: "...",
    });
    expect(result.segments[0].startTime).toBe("15:00");
    expect(result.segments[0].endTime).toBe("11:00");
  });

  it("does not override explicit hotel check-in/check-out times", async () => {
    mockCreate.mockResolvedValueOnce(
      aiResponse(
        JSON.stringify([
          {
            type: "hotel",
            title: "W Hotel",
            date: "2026-08-01",
            startTime: "16:00",
            endTime: "12:00",
            city: "New York",
            confidence: "high",
          },
        ]),
      ),
    );
    const result = await parser.parseEmail({
      subject: "Hotel",
      from: "w@hotel.com",
      body: "...",
    });
    expect(result.segments[0].startTime).toBe("16:00");
    expect(result.segments[0].endTime).toBe("12:00");
  });

  it("normalizes cost: strips currency symbols from string amounts", async () => {
    mockCreate.mockResolvedValueOnce(
      aiResponse(
        JSON.stringify([
          {
            type: "flight",
            title: "SEA → SFO",
            date: "2026-09-01",
            city: "San Francisco",
            confidence: "high",
            cost: { amount: "$299.00", currency: "USD", details: "Economy" },
          },
        ]),
      ),
    );
    const result = await parser.parseEmail({
      subject: "Flight booking",
      from: "airline@test.com",
      body: "...",
    });
    expect(result.segments[0].cost?.amount).toBe(299);
    expect(result.segments[0].cost?.currency).toBe("USD");
  });

  it("defaults missing cost currency to USD", async () => {
    mockCreate.mockResolvedValueOnce(
      aiResponse(
        JSON.stringify([
          {
            type: "flight",
            title: "LAX → NYC",
            date: "2026-10-01",
            city: "New York",
            confidence: "high",
            cost: { amount: 150 },
          },
        ]),
      ),
    );
    const result = await parser.parseEmail({
      subject: "Flight",
      from: "airline@test.com",
      body: "...",
    });
    expect(result.segments[0].cost?.currency).toBe("USD");
  });

  it("drops invalid URLs so Zod validation still passes", async () => {
    mockCreate.mockResolvedValueOnce(
      aiResponse(
        JSON.stringify([
          {
            type: "hotel",
            title: "Marriott",
            date: "2026-11-01",
            city: "Chicago",
            confidence: "high",
            url: "not-a-url",
          },
        ]),
      ),
    );
    const result = await parser.parseEmail({
      subject: "Hotel",
      from: "marriott@marriott.com",
      body: "...",
    });
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].url).toBeUndefined();
  });

  it("preserves valid https URLs", async () => {
    mockCreate.mockResolvedValueOnce(
      aiResponse(
        JSON.stringify([
          {
            type: "hotel",
            title: "Four Seasons",
            date: "2026-12-01",
            city: "Paris",
            confidence: "high",
            url: "https://booking.fourseasons.com/res/123",
          },
        ]),
      ),
    );
    const result = await parser.parseEmail({
      subject: "Hotel",
      from: "fs@fourseasons.com",
      body: "...",
    });
    expect(result.segments[0].url).toBe("https://booking.fourseasons.com/res/123");
  });

  it("counts segments that cannot pass validation even after patching", async () => {
    mockCreate.mockResolvedValueOnce(
      aiResponse(
        JSON.stringify([
          // Missing required `type` and `date` — unrecoverable
          { title: "Mystery segment" },
        ]),
      ),
    );
    const result = await parser.parseEmail({
      subject: "Something",
      from: "x@test.com",
      body: "...",
    });
    expect(result.invalidCount).toBe(1);
    expect(result.rawItemCount).toBe(1);
    expect(result.segments).toHaveLength(0);
  });

  it("handles Claude output wrapped in a markdown code block", async () => {
    const segment = {
      type: "flight",
      title: "JFK → LHR",
      date: "2026-12-01",
      city: "London",
      confidence: "high",
    };
    mockCreate.mockResolvedValueOnce(
      aiResponse(`\`\`\`json\n${JSON.stringify([segment])}\n\`\`\``),
    );
    const result = await parser.parseEmail({
      subject: "Flight to London",
      from: "ba@britishairways.com",
      body: "...",
    });
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].title).toBe("JFK → LHR");
  });

  it("returns empty result when Claude response contains no JSON array", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse("No travel bookings found in this email."));
    const result = await parser.parseEmail({
      subject: "Newsletter",
      from: "news@example.com",
      body: "Just news...",
    });
    expect(result.segments).toEqual([]);
    expect(result.invalidCount).toBe(0);
    expect(result.rawItemCount).toBe(0);
  });

  it("includes receivedAt date in the message sent to Claude", async () => {
    mockCreate.mockResolvedValueOnce(aiResponse("[]"));
    await parser.parseEmail({
      subject: "Flight",
      from: "airline@test.com",
      body: "...",
      receivedAt: "2026-11-01T00:00:00Z",
    });
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages[0].content).toContain("2026-11-01");
    expect(callArgs.messages[0].content).toContain("year=2026");
  });

  it("salvages a segment missing confidence by defaulting it to 'low'", async () => {
    mockCreate.mockResolvedValueOnce(
      aiResponse(
        JSON.stringify([
          {
            type: "activity",
            title: "City tour",
            date: "2027-01-10",
            city: "Rome",
            // confidence intentionally omitted — parser should patch it
          },
        ]),
      ),
    );
    const result = await parser.parseEmail({
      subject: "Tour booking",
      from: "tours@rome.it",
      body: "...",
    });
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].confidence).toBe("low");
  });
});
