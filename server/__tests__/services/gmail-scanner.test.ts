import {
  GMAIL_SYSTEM_LABELS,
  decodeBase64Url,
  extractBody,
  htmlToText,
  resolveLabelId,
  type GmailLabelSummary,
} from "../../src/services/gmail-scanner";

/**
 * Unit tests for the pure helpers that back GmailScanner. The class itself
 * wraps the Gmail API and is covered indirectly by the /emails/scan route
 * tests (which mock the class). These tests cover the logic that matters for
 * behaviour — name resolution and MIME body extraction — in isolation.
 */

// ─── base64url decoding ─────────────────────────────────────────────────────

describe("decodeBase64Url", () => {
  it("decodes a standard base64 string", () => {
    // "Hello, world!" encoded as base64url
    expect(decodeBase64Url("SGVsbG8sIHdvcmxkIQ")).toBe("Hello, world!");
  });

  it("converts base64url -/_ back to +// before decoding", () => {
    // The string "??>" is ">>>" + ... — use a string whose base64 encoding
    // actually contains `+` and `/` so we can verify the url-safe mapping.
    const raw = Buffer.from(">>>", "utf-8").toString("base64"); // "Pj4+"
    const urlSafe = raw.replace(/\+/g, "-").replace(/\//g, "_");
    expect(decodeBase64Url(urlSafe)).toBe(">>>");
  });

  it("decodes UTF-8 multibyte characters correctly", () => {
    const raw = Buffer.from("東京 → ロンドン", "utf-8").toString("base64");
    const urlSafe = raw.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(decodeBase64Url(urlSafe)).toBe("東京 → ロンドン");
  });
});

// ─── Label resolution ──────────────────────────────────────────────────────

describe("resolveLabelId", () => {
  const labels: GmailLabelSummary[] = [
    { id: "Label_1", name: "Travel" },
    { id: "Label_2", name: "Work/Travel" },
    { id: "Label_3", name: "Personal/Receipts" },
    { id: "Label_4", name: "Flights" },
  ];

  it("passes system labels through unchanged", () => {
    expect(resolveLabelId("INBOX", labels)).toBe("INBOX");
    expect(resolveLabelId("STARRED", labels)).toBe("STARRED");
    expect(resolveLabelId("CATEGORY_UPDATES", labels)).toBe("CATEGORY_UPDATES");
  });

  it("passes raw Label_ IDs through unchanged", () => {
    expect(resolveLabelId("Label_9999", labels)).toBe("Label_9999");
  });

  it("lists every documented system label in GMAIL_SYSTEM_LABELS", () => {
    // Guard against future drift: if someone adds a case to the set but
    // forgets to document it, this test keeps the list honest.
    for (const name of [
      "INBOX", "STARRED", "SENT", "IMPORTANT", "TRASH", "SPAM",
      "DRAFT", "UNREAD", "CATEGORY_PERSONAL", "CATEGORY_SOCIAL",
      "CATEGORY_PROMOTIONS", "CATEGORY_UPDATES", "CATEGORY_FORUMS",
    ]) {
      expect(GMAIL_SYSTEM_LABELS.has(name)).toBe(true);
    }
  });

  it("matches a user label by name, case-insensitively", () => {
    expect(resolveLabelId("Travel", labels)).toBe("Label_1");
    expect(resolveLabelId("travel", labels)).toBe("Label_1");
    expect(resolveLabelId("TRAVEL", labels)).toBe("Label_1");
  });

  it("trims whitespace from the input filter", () => {
    expect(resolveLabelId("  Travel  ", labels)).toBe("Label_1");
  });

  it("matches the trailing segment of a nested label when no exact match exists", () => {
    // "Flights" exactly matches Label_4; nested fallback doesn't apply.
    expect(resolveLabelId("Flights", labels)).toBe("Label_4");
    // But "Receipts" only exists as "Personal/Receipts" — nested match wins.
    expect(resolveLabelId("Receipts", labels)).toBe("Label_3");
  });

  it("prefers an exact name match over a nested trailing match", () => {
    // Both "Travel" and "Work/Travel" exist. The exact match should win.
    expect(resolveLabelId("Travel", labels)).toBe("Label_1");
  });

  it("returns null when no label matches", () => {
    expect(resolveLabelId("Nonexistent", labels)).toBeNull();
  });

  it("returns null against an empty label list", () => {
    expect(resolveLabelId("Travel", [])).toBeNull();
  });
});

// ─── Body extraction ───────────────────────────────────────────────────────

/** Build a Gmail-style base64url-encoded body part for test fixtures */
function b64(text: string): string {
  return Buffer.from(text, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

describe("extractBody", () => {
  it("returns a single text/plain payload body", () => {
    const payload = {
      mimeType: "text/plain",
      body: { data: b64("Your reservation is confirmed.") },
    };
    expect(extractBody(payload)).toBe("Your reservation is confirmed.");
  });

  it("prefers text/plain over text/html in a multipart/alternative", () => {
    const payload = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64("Plain version") } },
        {
          mimeType: "text/html",
          body: { data: b64("<p>HTML version</p>") },
        },
      ],
    };
    expect(extractBody(payload)).toBe("Plain version");
  });

  it("falls back to text/html when text/plain is blank whitespace", () => {
    // Marketing emails often include a blank text/plain part alongside
    // the real HTML body. Treat that case as if text/plain were missing.
    const payload = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64("   \n\n  ") } },
        {
          mimeType: "text/html",
          body: { data: b64("<p>Real content</p>") },
        },
      ],
    };
    expect(extractBody(payload).trim()).toBe("Real content");
  });

  it("falls back to text/html when text/plain is absent entirely", () => {
    const payload = {
      mimeType: "multipart/alternative",
      parts: [
        {
          mimeType: "text/html",
          body: { data: b64("<h1>Booking #1234</h1>") },
        },
      ],
    };
    expect(extractBody(payload).trim()).toBe("BOOKING #1234");
  });

  it("walks nested multipart structures (multipart/mixed → alternative)", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            {
              mimeType: "text/plain",
              body: { data: b64("Nested body") },
            },
          ],
        },
        {
          mimeType: "application/pdf",
          body: { attachmentId: "att-1" }, // no text data
        },
      ],
    };
    expect(extractBody(payload)).toBe("Nested body");
  });

  it("concatenates multiple text/plain parts with newlines", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "text/plain", body: { data: b64("First chunk") } },
        { mimeType: "text/plain", body: { data: b64("Second chunk") } },
      ],
    };
    expect(extractBody(payload)).toBe("First chunk\nSecond chunk");
  });

  it("returns empty string when no text parts are present", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "application/pdf", body: { attachmentId: "att-1" } },
        { mimeType: "image/png", body: { attachmentId: "att-2" } },
      ],
    };
    expect(extractBody(payload)).toBe("");
  });

  it("handles an empty payload with no body and no parts", () => {
    expect(extractBody({ mimeType: "text/plain" })).toBe("");
  });
});

// ─── HTML to text ──────────────────────────────────────────────────────────

describe("htmlToText", () => {
  it("strips images", () => {
    const html = `<p>Hello <img src="spacer.gif" alt="logo"> world</p>`;
    expect(htmlToText(html)).not.toMatch(/spacer\.gif/);
    expect(htmlToText(html)).toMatch(/Hello.+world/);
  });

  it("drops anchor hrefs but keeps link text", () => {
    const html = `<a href="https://example.com/booking/12345">Manage booking</a>`;
    const out = htmlToText(html);
    expect(out).toContain("Manage booking");
    expect(out).not.toContain("example.com");
  });

  it("does not wordwrap long lines", () => {
    const html = `<p>${"a".repeat(500)}</p>`;
    const out = htmlToText(html);
    expect(out.split("\n")[0]!.length).toBeGreaterThanOrEqual(500);
  });
});
