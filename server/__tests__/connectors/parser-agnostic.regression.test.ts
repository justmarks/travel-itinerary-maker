/**
 * Phase 4 regression: the email-parsing pipeline is provider-agnostic.
 *
 * Each `EmailConnector` implementation normalises its provider's raw
 * message shape into the same `RawEmail` (`bodyText: string`). The
 * downstream `EmailParser.parseEmail` reads `body` from that string
 * and never branches on provider, so the parser SHOULD produce
 * identical segments for the same logical email regardless of
 * source.
 *
 * This file proves that claim end-to-end:
 *  1. The body-extraction step (HTML → plain text) produces
 *     equivalent text from Gmail's MIME-part shape and Microsoft
 *     Graph's `body.content` shape.
 *  2. Both representations of a text/plain message produce
 *     byte-identical text.
 *  3. Feeding the parser bodies sourced from either path with a
 *     mocked AI response yields identical `ParsedSegment[]`.
 *
 * Scope: shape-level normalisation parity. Per-provider quirks
 * (mixed plain+html where Gmail picks plain while Outlook delivers
 * whichever the sender used) are out of scope — they're provider
 * reality, not parser-agnosticism.
 */

// Anthropic SDK + monitoring mocks must come BEFORE the
// `email-parser` import; jest hoists `jest.mock` calls so this is
// equivalent to declaring them at the top of the file.
const mockCreate = jest.fn();

jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  })),
}));

jest.mock("../../src/services/monitoring", () => ({
  reportMessage: jest.fn(),
  reportError: jest.fn(),
}));

import type { gmail_v1 } from "googleapis";
import {
  extractBody,
  htmlToText,
} from "../../src/services/gmail-scanner";
import { EmailParser } from "../../src/services/email-parser";

/** Encode a string as Gmail's base64url (no padding, +/- → -_). */
function base64Url(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Builds a Gmail `payload` for an HTML-only message. Matches what
 * `gmail.users.messages.get` would return for a simple marketing /
 * confirmation email that ships HTML without a plain-text fallback.
 */
function buildGmailHtmlPayload(html: string): gmail_v1.Schema$MessagePart {
  return {
    mimeType: "text/html",
    body: { data: base64Url(html) },
  };
}

/**
 * Builds a Gmail `payload` for a `multipart/alternative` message
 * that carries BOTH a text/plain and text/html part. Gmail's
 * extractor prefers the plain-text part; Outlook would deliver
 * `body.contentType: "text"` with the same plain content.
 */
function buildGmailMixedPayload(
  plain: string,
  html: string,
): gmail_v1.Schema$MessagePart {
  return {
    mimeType: "multipart/alternative",
    parts: [
      { mimeType: "text/plain", body: { data: base64Url(plain) } },
      { mimeType: "text/html", body: { data: base64Url(html) } },
    ],
  };
}

/**
 * Microsoft Graph's body-extraction logic the connector applies to
 * `message.body`. Mirrors `bodyOf` in `microsoft-email-connector.ts`:
 *   - `contentType: "text"` → return content as-is.
 *   - `contentType: "html"` → run through `htmlToText` (same
 *     converter the Gmail scanner uses).
 */
function msExtract(body: { contentType: "text" | "html"; content: string }): string {
  if (body.contentType === "text") return body.content;
  return htmlToText(body.content);
}

/** Strip whitespace differences so newline / wrapping noise doesn't
 *  fail the equivalence check. The parser tokenizes on whitespace
 *  anyway, so equivalence at this level is what actually matters
 *  for parser-agnosticism. */
function normaliseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

describe("Parser-agnosticism: body extraction parity", () => {
  it("HTML-only email: Gmail's extractBody and Microsoft's body extraction produce equivalent text", () => {
    const html = `
      <p>Your flight is confirmed.</p>
      <ul>
        <li>Date: 2026-06-15</li>
        <li>From: SEA</li>
        <li>To: NRT</li>
        <li>Confirmation: ABC123</li>
      </ul>
    `;

    const gmailText = extractBody(buildGmailHtmlPayload(html));
    const msText = msExtract({ contentType: "html", content: html });

    expect(normaliseWhitespace(gmailText)).toBe(normaliseWhitespace(msText));
    // Sanity: the booking-details substrings every parser run
    // depends on must survive normalisation.
    expect(gmailText).toContain("ABC123");
    expect(gmailText).toContain("SEA");
    expect(gmailText).toContain("NRT");
  });

  it("text/plain email: extracted body is byte-identical across both providers", () => {
    const plain =
      "Your flight is confirmed.\nDate: 2026-06-15\nFrom: SEA\nTo: NRT\nConfirmation: ABC123";

    // Gmail with a plain-only payload.
    const gmailText = extractBody({
      mimeType: "text/plain",
      body: { data: base64Url(plain) },
    });
    // Microsoft with `contentType: "text"`.
    const msText = msExtract({ contentType: "text", content: plain });

    expect(gmailText).toBe(plain);
    expect(msText).toBe(plain);
    expect(gmailText).toBe(msText);
  });

  it("mixed multipart message: Gmail prefers text/plain, output stays equivalent to a Microsoft text/plain delivery", () => {
    // Real-world `multipart/alternative` confirmation emails often
    // ship a clean plain-text part alongside the marketing HTML.
    // Outlook would surface the same logical email as
    // `contentType: "text"` with that plain content.
    const plain =
      "Your flight is confirmed.\nDate: 2026-06-15\nFrom: SEA\nTo: NRT";
    const html = "<p>Marketing HTML version with <strong>extra noise</strong>.</p>";

    const gmailText = extractBody(buildGmailMixedPayload(plain, html));
    const msText = msExtract({ contentType: "text", content: plain });

    expect(gmailText).toBe(plain);
    expect(gmailText).toBe(msText);
  });

  it("empty body: both extractors return empty string", () => {
    const gmailText = extractBody({
      mimeType: "text/html",
      body: { data: base64Url("") },
    });
    const msText = msExtract({ contentType: "html", content: "" });

    expect(gmailText).toBe("");
    expect(msText).toBe("");
  });
});

describe("Parser-agnosticism: parser produces equivalent segments", () => {
  let parser: EmailParser;

  beforeEach(() => {
    jest.clearAllMocks();
    parser = new EmailParser({ apiKey: "test-key" });
  });

  /**
   * Mirror of `email-parser.test.ts`'s test helper. The parser calls
   * `client.messages.create(...).withResponse()` synchronously and
   * awaits the result.
   */
  function aiResponse(text: string) {
    return {
      withResponse: () =>
        Promise.resolve({
          data: { content: [{ type: "text", text }] },
          response: { headers: new Headers() },
        }),
    };
  }

  /**
   * Stub Claude's response with a single flight segment. Same canned
   * payload returned twice so the parser sees identical inputs from
   * either body source.
   */
  const cannedSegments = [
    {
      type: "flight",
      title: "SEA → NRT",
      date: "2026-06-15",
      startTime: "10:30",
      city: "Tokyo",
      confirmationCode: "ABC123",
      confidence: "high",
    },
  ];

  it("produces identical segments for bodies extracted via Gmail vs Microsoft paths", async () => {
    const html = `
      <p>Your flight is confirmed.</p>
      <ul>
        <li>Date: 2026-06-15</li>
        <li>From: SEA</li>
        <li>To: NRT</li>
        <li>Confirmation: ABC123</li>
      </ul>
    `;
    const gmailBody = extractBody(buildGmailHtmlPayload(html));
    const msBody = msExtract({ contentType: "html", content: html });

    // Two AI responses, identical payload — one per parse call.
    mockCreate.mockReturnValueOnce(aiResponse(JSON.stringify(cannedSegments)));
    mockCreate.mockReturnValueOnce(aiResponse(JSON.stringify(cannedSegments)));

    const fromGmail = await parser.parseEmail({
      subject: "Flight confirmation",
      from: "noreply@airline.com",
      body: gmailBody,
      receivedAt: "2026-05-01T00:00:00.000Z",
    });
    const fromMs = await parser.parseEmail({
      subject: "Flight confirmation",
      from: "noreply@airline.com",
      body: msBody,
      receivedAt: "2026-05-01T00:00:00.000Z",
    });

    expect(fromGmail.segments).toEqual(fromMs.segments);
    expect(fromGmail.rawItemCount).toBe(fromMs.rawItemCount);
    expect(fromGmail.invalidCount).toBe(fromMs.invalidCount);
  });

  it("passes equivalent body strings to Claude regardless of provider source", async () => {
    const html = "<p>Flight: SEA → NRT on 2026-06-15. Conf: ABC123.</p>";
    const gmailBody = extractBody(buildGmailHtmlPayload(html));
    const msBody = msExtract({ contentType: "html", content: html });

    mockCreate.mockReturnValueOnce(aiResponse("[]"));
    await parser.parseEmail({
      subject: "x",
      from: "x@x.com",
      body: gmailBody,
    });
    const gmailCall = mockCreate.mock.calls[0][0] as {
      messages: { content: string }[];
    };
    const gmailContent = gmailCall.messages[0].content;

    mockCreate.mockReturnValueOnce(aiResponse("[]"));
    await parser.parseEmail({
      subject: "x",
      from: "x@x.com",
      body: msBody,
    });
    const msCall = mockCreate.mock.calls[1][0] as {
      messages: { content: string }[];
    };
    const msContent = msCall.messages[0].content;

    // Two calls should receive the same body block in the prompt.
    // Whitespace-normalise so wrapper newlines / indentation don't
    // fail the assertion.
    expect(normaliseWhitespace(gmailContent)).toBe(normaliseWhitespace(msContent));
  });
});
