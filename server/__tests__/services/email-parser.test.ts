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


describe("EmailParser.htmlToText", () => {
  it("returns an empty string for empty input", () => {
    expect(EmailParser.htmlToText("")).toBe("");
  });

  it("strips simple tags and keeps the text", () => {
    const html = "<p>Hello <strong>world</strong></p>";
    expect(EmailParser.htmlToText(html)).toBe("Hello world");
  });

  it("drops <script> blocks entirely", () => {
    const html = `
      <html>
        <head><title>t</title></head>
        <body>
          <script>var x = 'secret';</script>
          <p>Booking confirmed</p>
        </body>
      </html>
    `;
    const out = EmailParser.htmlToText(html);
    expect(out).toContain("Booking confirmed");
    expect(out).not.toContain("secret");
    expect(out).not.toContain("var x");
  });

  it("drops <style> blocks entirely", () => {
    const html = "<style>.foo{color:red}</style><p>Hotel</p>";
    const out = EmailParser.htmlToText(html);
    expect(out).toBe("Hotel");
  });

  it("preserves anchor hrefs inline so booking URLs survive", () => {
    const html =
      '<p>Manage your booking at <a href="https://hotel.example/b/abc">this link</a>.</p>';
    const out = EmailParser.htmlToText(html);
    expect(out).toContain("this link (https://hotel.example/b/abc)");
  });

  it("omits the text form when the anchor text equals the href", () => {
    const html = '<a href="https://hotel.example">https://hotel.example</a>';
    const out = EmailParser.htmlToText(html);
    expect(out).toBe("https://hotel.example");
  });

  it("falls back to the href when the anchor has no inner text", () => {
    const html = '<a href="https://hotel.example/image"><img src="x.png"/></a>';
    const out = EmailParser.htmlToText(html);
    expect(out).toBe("https://hotel.example/image");
  });

  it("converts <br> and block closers into newlines", () => {
    const html = "<p>Line 1</p><p>Line 2<br>Line 3</p>";
    const out = EmailParser.htmlToText(html);
    expect(out.split("\n")).toEqual(["Line 1", "Line 2", "Line 3"]);
  });

  it("converts table rows into newlines", () => {
    const html =
      "<table><tr><td>Flight</td><td>BA 52</td></tr><tr><td>Date</td><td>Dec 19</td></tr></table>";
    const out = EmailParser.htmlToText(html);
    expect(out.split("\n")).toEqual(["Flight BA 52", "Date Dec 19"]);
  });

  it("decodes common named entities", () => {
    const html = "<p>Smith &amp; Sons &mdash; &ldquo;luxury&rdquo;</p>";
    const out = EmailParser.htmlToText(html);
    expect(out).toBe("Smith & Sons \u2014 \u201cluxury\u201d");
  });

  it("decodes numeric decimal entities", () => {
    const html = "<p>&#8364;100.00</p>";
    const out = EmailParser.htmlToText(html);
    expect(out).toBe("\u20ac100.00");
  });

  it("decodes numeric hex entities", () => {
    const html = "<p>&#x20AC;100.00</p>";
    const out = EmailParser.htmlToText(html);
    expect(out).toBe("\u20ac100.00");
  });

  it("collapses runs of whitespace inside a line", () => {
    const html = "<p>Hello     world  \n  \t  again</p>";
    const out = EmailParser.htmlToText(html);
    expect(out).toBe("Hello world again");
  });

  it("strips leading/trailing whitespace per line and removes empty lines", () => {
    const html = "<div>   </div><p>real content</p><div>   </div>";
    const out = EmailParser.htmlToText(html);
    expect(out).toBe("real content");
  });

  it("handles a realistic hotel confirmation snippet", () => {
    const html = `
      <html>
        <body>
          <h1>Booking Confirmation</h1>
          <p>Dear guest,</p>
          <p>Your reservation at <strong>Palazzo Natoli</strong> is confirmed.</p>
          <table>
            <tr><td>Check-in</td><td>June 15, 2026</td></tr>
            <tr><td>Check-out</td><td>June 18, 2026</td></tr>
            <tr><td>Confirmation</td><td>ABC123456</td></tr>
            <tr><td>Total</td><td>&euro;540.00</td></tr>
          </table>
          <p>Manage booking: <a href="https://palazzo.example/b/ABC123456">here</a></p>
        </body>
      </html>
    `;
    const out = EmailParser.htmlToText(html);
    expect(out).toContain("Palazzo Natoli");
    expect(out).toContain("Check-in June 15, 2026");
    expect(out).toContain("Check-out June 18, 2026");
    expect(out).toContain("Confirmation ABC123456");
    expect(out).toContain("\u20ac540.00");
    expect(out).toContain("here (https://palazzo.example/b/ABC123456)");
  });
});

describe("EmailParser.emlToEmail", () => {
  it("parses a simple text/plain EML with all headers", async () => {
    const eml = [
      "From: Alice <alice@example.com>",
      "To: bob@example.com",
      "Subject: Your booking",
      "Date: Mon, 15 Jun 2026 14:30:00 +0000",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Hotel confirmed. Check-in June 15.",
      "",
    ].join("\r\n");

    const out = await EmailParser.emlToEmail(eml);
    expect(out.subject).toBe("Your booking");
    expect(out.from).toBe("Alice <alice@example.com>");
    expect(out.body).toContain("Hotel confirmed");
    expect(out.body).toContain("Check-in June 15");
    expect(out.receivedAt).toBe("2026-06-15T14:30:00.000Z");
  });

  it("prefers the text/html part of a multipart message and strips HTML", async () => {
    const boundary = "----boundary";
    const eml = [
      "From: noreply@hotel.example",
      "Subject: Reservation",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Plain fallback body",
      "",
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "",
      "<html><body><p>Reservation <strong>ABC123</strong></p></body></html>",
      "",
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const out = await EmailParser.emlToEmail(eml);
    expect(out.body).toContain("Reservation ABC123");
    expect(out.body).not.toContain("<strong>");
    expect(out.body).not.toContain("Plain fallback body");
  });

  it("decodes quoted-printable body content", async () => {
    const eml = [
      "From: hotel@example.com",
      "Subject: Total due",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Total: =E2=82=AC540.00 for 3 nights",
      "",
    ].join("\r\n");

    const out = await EmailParser.emlToEmail(eml);
    expect(out.body).toContain("\u20ac540.00");
  });

  it("decodes base64-encoded body content", async () => {
    // "Confirmation code: XYZ789" in base64
    const base64Body = Buffer.from("Confirmation code: XYZ789\r\n").toString(
      "base64",
    );
    const eml = [
      "From: a@b.com",
      "Subject: Booking",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      base64Body,
      "",
    ].join("\r\n");

    const out = await EmailParser.emlToEmail(eml);
    expect(out.body).toContain("Confirmation code: XYZ789");
  });

  it("decodes RFC 2047 encoded-word subject lines", async () => {
    const eml = [
      "From: a@b.com",
      "Subject: =?UTF-8?B?UGFsYXp6byBOYXRvbGkg4oCT?= booking",
      "",
      "body",
      "",
    ].join("\r\n");

    const out = await EmailParser.emlToEmail(eml);
    expect(out.subject).toContain("Palazzo Natoli");
  });

  it("falls back to a placeholder subject when missing", async () => {
    const eml = "From: a@b.com\r\n\r\nbody\r\n";
    const out = await EmailParser.emlToEmail(eml);
    expect(out.subject).toBe("(EML import — no subject)");
  });

  it("falls back to a placeholder sender when From header is missing", async () => {
    const eml = "Subject: Stuff\r\n\r\nbody\r\n";
    const out = await EmailParser.emlToEmail(eml);
    expect(out.from).toBe("(unknown sender)");
  });

  it("returns undefined receivedAt when Date header is absent", async () => {
    const eml = "From: a@b.com\r\nSubject: s\r\n\r\nbody\r\n";
    const out = await EmailParser.emlToEmail(eml);
    expect(out.receivedAt).toBeUndefined();
  });

  it("accepts a Buffer as input", async () => {
    const eml = Buffer.from(
      "From: a@b.com\r\nSubject: From buffer\r\n\r\nhi\r\n",
      "utf-8",
    );
    const out = await EmailParser.emlToEmail(eml);
    expect(out.subject).toBe("From buffer");
  });

  it("handles a realistic hotel confirmation EML with HTML body", async () => {
    const boundary = "=_boundary_42";
    const eml = [
      "From: Palazzo Natoli <noreply@palazzo.example>",
      "To: traveler@example.com",
      "Subject: Booking confirmation ABC123456",
      "Date: Fri, 15 May 2026 09:00:00 +0000",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "",
      "<html><body>",
      "<h1>Booking Confirmation</h1>",
      "<table>",
      "<tr><td>Check-in</td><td>June 15, 2026</td></tr>",
      "<tr><td>Check-out</td><td>June 18, 2026</td></tr>",
      "<tr><td>Total</td><td>&euro;540.00</td></tr>",
      "</table>",
      "</body></html>",
      "",
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const out = await EmailParser.emlToEmail(eml);
    expect(out.subject).toBe("Booking confirmation ABC123456");
    expect(out.from).toContain("palazzo.example");
    expect(out.receivedAt).toBe("2026-05-15T09:00:00.000Z");
    expect(out.body).toContain("Check-in June 15, 2026");
    expect(out.body).toContain("Check-out June 18, 2026");
    expect(out.body).toContain("\u20ac540.00");
  });
});
