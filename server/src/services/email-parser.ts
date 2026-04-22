import Anthropic from "@anthropic-ai/sdk";
import { simpleParser } from "mailparser";
import { parsedSegmentSchema, SEGMENT_TYPES } from "@travel-app/shared";
import type { ParsedSegment } from "@travel-app/shared";

// TODO: Support points/miles in SegmentCost (e.g. 40,000 hotel points, points + cash combos)
// TODO: For hotels, extract key fees on top of hotel cost (self-parking vs. valet, resort fee)
//       — may need a `fees` array on SegmentCost or separate cost line items
// TODO: Allow rescan of specific emails after errors (e.g. retry button per-email in the UI)
// TODO: Extract bag fees for flights (e.g. "$35/bag first checked bag") as separate cost line items

const SYSTEM_PROMPT = `You are a travel itinerary extraction assistant. Given an email, extract all travel-related bookings and return them as a JSON array.

Each item in the array must be a JSON object with these fields:
- "type": one of: ${SEGMENT_TYPES.map((t) => `"${t}"`).join(", ")}
- "title": short descriptive title (e.g. "SEA → NRT", "Hilton Garden Inn", "Dinner at Canlis")
- "date": date in YYYY-MM-DD format
- "startTime": time in HH:MM format (if available)
- "endTime": time in HH:MM format (if available)
- "city": the destination city for this segment. For flights, use the arrival city. For hotels/restaurants/activities, use the city they are located in. Always include this field.
- "venueName": hotel/restaurant/venue name (if applicable)
- "address": street address (if available)
- "confirmationCode": booking confirmation number (if available)
- "provider": booking provider or airline/company name (if available)
- "carrier": full airline or transport carrier NAME, not a code. For example: "Delta" (NOT "DL"), "Alaska Airlines" (NOT "AS"), "American Airlines" (NOT "AA"), "United" (NOT "UA"), "Hawaiian Airlines" (NOT "HA"), "Southwest", "JetBlue", "British Airways", "Lufthansa", etc. If only a 2-letter code appears in the email, expand it to the full airline name.
- "routeCode": ONLY the flight number digits, no airline prefix. For example: "359" (NOT "DL359"), "101" (NOT "AS101"), "2410" (NOT "AA2410"). Strip any letter prefix that matches the airline code.
- "departureCity": departure city (for flights/trains)
- "arrivalCity": arrival city (for flights/trains)
- "seatNumber": ALL seat assignments for this booking as a comma-separated string (e.g. "12A, 12B, 12C"). If the email lists multiple passengers on the same flight, combine all seats into ONE segment, do NOT create separate segments per passenger. For trains, the seat/berth number(s).
- "coach": for trains only — the coach or car designation (e.g. "Car 7", "Coach B", "Voiture 12"). Free text.
- "cabinClass": class of service for flights (e.g. "Economy", "Premium Economy", "Business", "First", "Main Cabin", "Comfort+"). Extract exactly as stated in the email.
- "baggageInfo": checked baggage policy for flights (e.g. "1 checked bag included", "2 checked bags included", "No checked bags included - $35/bag", "1 free checked bag per passenger"). Extract if mentioned in the email.
- "partySize": total number of travelers/guests
- "endDate": end/return date in YYYY-MM-DD format for multi-day bookings. For hotels, this is the check-out date. For car_rental, this is the dropoff date. For cruise, this is the disembarkation date.
- "breakfastIncluded": boolean (for hotels, if mentioned)
- "phone": contact phone number (if available)
- "url": booking URL (if available)
- "cost": { "amount": number, "currency": "USD"|"EUR"|etc, "details": "description" } (if price mentioned). The "amount" MUST be a plain number with no currency symbol (e.g. 547.20, NOT "$547.20"). The "currency" must be a string like "USD", "EUR", etc. ALWAYS extract flight prices, hotel prices, car rental prices, and any other costs mentioned in the email.
- "confidence": "high" if clearly a confirmed booking, "medium" if likely a booking, "low" if uncertain

IMPORTANT RULES:
- One booking = one segment. If an email has a flight with 4 passengers and 4 seat numbers, return ONE flight segment with all seats in "seatNumber" and partySize=4.
- **CAR RENTALS**: Return ONE segment spanning the full rental:
  - type "car_rental", date = pickup date, startTime = pickup time, endDate = dropoff date, endTime = dropoff time. Title format: "Company - City" (e.g. "National - Lihue"). ALWAYS populate the "city" field with the pickup city (same city that appears in the title). If the pickup location is an airport, also put the airport name/code in "venueName" (e.g. "Lihue Airport (LIH)") and the city in "city". If the dropoff is in a different city, put it in "arrivalCity".
  - Car rental cost: The cost "amount" should be the BASE RENTAL RATE only — the total for the car itself BEFORE taxes, airport concession fees, vehicle license fees, customer facility charges, or any other surcharges. Do NOT include tax lines in the amount. Put the car class/type (e.g. "Midsize SUV", "Full-size") in "details". If taxes and fees are shown as a separate total, mention them briefly in "details" (e.g. "+$120 taxes & fees") but keep them out of "amount".
- **CRUISES**: Return ONE segment spanning the full cruise:
  - type "cruise", date = embarkation date, startTime = boarding time, endDate = disembarkation date, endTime = disembark time. "venueName" = the ship name (e.g. "Disney Fantasy"). "address" or "city" = the embarkation port. Include cost on this single segment.
- **SHOWS/TICKETED EVENTS** (concerts, theater, Broadway, opera, Kabuki, symphonies, sporting events, comedy):
  - type "show", date = show date, startTime = showtime. "venueName" = theater/arena name. "address" = venue address if given. "seatNumber" = seat assignment(s) exactly as the ticket shows (e.g. "Orchestra Row F, Seats 14-15"). Do NOT set "provider" for shows — leave it blank.
- **HOTEL CHECK-IN/CHECK-OUT TIMES**: If the email explicitly states a check-in time (e.g. "Check-in: 4:00 PM") or check-out time (e.g. "Check-out by 11:00 AM"), use those values for "startTime" (check-in) and "endTime" (check-out). Do NOT use timestamps from booking confirmation metadata, email headers, or ISO datetime fields that look like the time the email was sent — those are not real hotel policy times. If no explicit check-in/check-out time is stated in the visible email body, omit "startTime" and "endTime" entirely and the server will apply standard hotel defaults.
- **HOTELS**: The cost "amount" should be the ROOM RATE only (nightly or total room charge), NOT including fees like parking, resort fees, or taxes. Put the room type (e.g. "2 Bedroom Villa, 2 Bathrooms" or "King Room with City View") and any fees/extras (parking, resort fee, breakfast) in the "details" string so the user can see them separately.
- **FLIGHTS**: For the cost, use ONLY the total price for the booking. Do NOT break down into base fare, taxes, or fees — just the final total amount. If the email shows a per-person price, use that per-person total (multiple per-person emails will be combined later).
- **AIRLINE EMAILS**: Be sure to parse emails from ALL airlines including Hawaiian Airlines, Alaska Airlines, Delta, United, American, Southwest, JetBlue, Spirit, Frontier, and international carriers. Itinerary changes, schedule changes, and booking confirmations are all travel-related. Look for flight numbers, dates, times, and routes even if the email format is unusual.
- **YEAR INFERENCE**: If a date in the email body does not include a year (e.g. "Wednesday, April 15" or "Apr 15"), you MUST infer the year from the "Email received date" provided in the user message — NEVER default to the current real-world year or a training-data year. Use this rule:
  1. Start with the year of the email received date.
  2. If the resulting date (month + day) is more than 7 days BEFORE the email received date, add one year (the trip is in the following year).
  3. Otherwise keep the email-received year.
  For example: if the email was received on 2026-01-15 and mentions "Wednesday, April 15", the correct date is 2026-04-15 (same year, since April 15 is after January 15). If the email was received on 2026-11-15 and mentions "Friday, January 20", the correct date is 2027-01-20 (next year, since January 20 has already passed in 2026).
- Only include fields that are actually present in the email. Do not guess or fabricate data.
- For restaurant types, use restaurant_breakfast, restaurant_brunch, restaurant_lunch, or restaurant_dinner based on time or context.

If the email contains NO travel-related bookings, return an empty array: []

Return ONLY the JSON array, no other text.`;

export interface EmailParserOptions {
  apiKey: string;
  model?: string;
}

/**
 * Parses email content using Claude AI to extract travel segments.
 */
export class EmailParser {
  private client: Anthropic;
  private model: string;

  constructor(options: EmailParserOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.model = options.model || "claude-sonnet-4-20250514";
  }

  /**
   * Parse an email and return extracted travel segments.
   *
   * Returns a richer result than just segments so the caller can tell the
   * difference between "Claude said this email has no travel content" and
   * "Claude returned segments but they all failed validation". The latter is
   * a retryable failure; the former should not be retried.
   *
   * `receivedAt` should be the email's Date header (ISO string). It's used as
   * the anchor for inferring missing years on dates mentioned in the body.
   */
  /**
   * Strip HTML markup into plain text suitable for sending to Claude.
   *
   * Exposed as a static method so tests can exercise it directly and so
   * routes/services can reuse the same normalization as `parseHtml`. It's
   * intentionally simple — it's not a real HTML parser, just enough:
   * - removes <script>/<style>/<head> blocks entirely
   * - keeps the href of anchors inline as "text (url)" so booking URLs survive
   * - converts <br>, </p>, </div>, </tr>, </li> into newlines
   * - strips all remaining tags
   * - decodes a handful of common HTML entities
   * - collapses runs of whitespace
   */
  static htmlToText(html: string): string {
    if (!html) return "";
    let text = html;

    // Drop script/style/head wholesale — they're never useful for parsing.
    text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
    text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
    text = text.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, " ");
    text = text.replace(/<!--[\s\S]*?-->/g, " ");

    // HTML treats raw newlines/tabs inside text as regular whitespace. Collapse
    // them to spaces up front so pretty-printed source doesn't end up with
    // every word on its own line later. We reintroduce newlines explicitly
    // only at block-level boundaries (<br>, </p>, </tr>, etc).
    text = text.replace(/[\r\n\t]+/g, " ");

    // Preserve href info so Claude can see booking links.
    text = text.replace(
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_m, href: string, inner: string) => {
        const innerText = inner.replace(/<[^>]+>/g, "").trim();
        if (!innerText) return href;
        if (innerText === href) return href;
        return `${innerText} (${href})`;
      },
    );

    // Block-level tags → newlines so paragraphs/rows don't run together.
    // Note: <td>/<th> are intentionally NOT here — stripping their tags
    // leaves a space, which keeps table cells on the same row. Only </tr>
    // ends a row.
    text = text.replace(/<br\b[^>]*\/?>/gi, "\n");
    text = text.replace(/<\/(p|div|tr|li|h[1-6]|section|article)>/gi, "\n");

    // Strip remaining tags, leaving a space so adjacent words don't collide.
    text = text.replace(/<[^>]+>/g, " ");

    // Decode common HTML entities.
    const entityMap: Record<string, string> = {
      "&nbsp;": " ",
      "&amp;": "&",
      "&lt;": "<",
      "&gt;": ">",
      "&quot;": '"',
      "&#39;": "'",
      "&apos;": "'",
      "&mdash;": "—",
      "&ndash;": "–",
      "&rsquo;": "’",
      "&lsquo;": "‘",
      "&ldquo;": "“",
      "&rdquo;": "”",
      "&hellip;": "…",
      "&copy;": "©",
      "&reg;": "®",
      "&trade;": "™",
      "&euro;": "€",
      "&pound;": "£",
      "&yen;": "¥",
      "&cent;": "¢",
    };
    text = text.replace(/&[a-z]+;|&#39;/gi, (match) => entityMap[match] ?? match);
    // Numeric entities (decimal + hex).
    text = text.replace(/&#(\d+);/g, (_m, code: string) =>
      String.fromCodePoint(parseInt(code, 10)),
    );
    text = text.replace(/&#x([0-9a-f]+);/gi, (_m, code: string) =>
      String.fromCodePoint(parseInt(code, 16)),
    );

    // Collapse whitespace but keep paragraph breaks.
    text = text
      .split(/\n/)
      .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
      .filter((line) => line.length > 0)
      .join("\n");

    return text;
  }

  /**
   * Parse a raw HTML blob (e.g. a saved `.html` email or pasted HTML source)
   * by stripping it to plain text and running it through the same pipeline
   * as Gmail-scanned emails. The caller may provide optional subject/from/
   * receivedAt metadata from the original email. When omitted, the parser
   * uses generic placeholders so Claude still gets a well-formed prompt.
   */
  async parseHtml(input: {
    html: string;
    subject?: string;
    from?: string;
    receivedAt?: string;
  }): Promise<{ segments: ParsedSegment[]; invalidCount: number; rawItemCount: number }> {
    const body = EmailParser.htmlToText(input.html);
    return this.parseEmail({
      subject: input.subject || "(HTML import — no subject)",
      from: input.from || "(unknown sender)",
      body,
      receivedAt: input.receivedAt,
    });
  }

  /**
   * Parse a raw EML file (RFC 822 / MIME source) into a normalized email
   * shape. Decodes MIME headers (subject, from, date), picks the richest body
   * part available (prefers text/html and strips to text, otherwise uses
   * text/plain), and decodes any quoted-printable / base64 transfer encoding
   * along the way. Falls back to generic placeholders when headers are
   * missing so the downstream Claude prompt is still well-formed.
   */
  static async emlToEmail(eml: string | Buffer): Promise<{
    subject: string;
    from: string;
    body: string;
    receivedAt?: string;
  }> {
    const parsed = await simpleParser(eml);

    const subject = (parsed.subject || "").trim();

    let fromAddr = "";
    if (parsed.from?.value?.length) {
      const first = parsed.from.value[0];
      const name = (first.name || "").trim();
      const address = (first.address || "").trim();
      fromAddr = name && address ? `${name} <${address}>` : address || name;
    } else if (parsed.from?.text) {
      fromAddr = parsed.from.text.trim();
    }

    // Prefer HTML body, otherwise plain text. mailparser gives us the
    // richest available form; we run the HTML through htmlToText so the
    // downstream pipeline receives plain text either way.
    let body = "";
    if (typeof parsed.html === "string" && parsed.html.trim()) {
      body = EmailParser.htmlToText(parsed.html);
    } else if (typeof parsed.text === "string" && parsed.text.trim()) {
      body = parsed.text
        .split(/\r?\n/)
        .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
        .filter((line) => line.length > 0)
        .join("\n");
    } else if (typeof parsed.textAsHtml === "string") {
      body = EmailParser.htmlToText(parsed.textAsHtml);
    }

    const receivedAt = parsed.date ? parsed.date.toISOString() : undefined;

    return {
      subject: subject || "(EML import — no subject)",
      from: fromAddr || "(unknown sender)",
      body,
      receivedAt,
    };
  }

  /**
   * Parse a raw EML blob (a saved `.eml` file or raw MIME source) by
   * extracting headers + the richest body part and running it through the
   * same pipeline as Gmail-scanned emails. The caller's optional metadata
   * takes precedence over the values pulled from the EML headers so users
   * can override a mangled/empty subject etc.
   */
  async parseEml(input: {
    eml: string | Buffer;
    subject?: string;
    from?: string;
    receivedAt?: string;
  }): Promise<{ segments: ParsedSegment[]; invalidCount: number; rawItemCount: number }> {
    const extracted = await EmailParser.emlToEmail(input.eml);
    return this.parseEmail({
      subject: input.subject?.trim() || extracted.subject,
      from: input.from?.trim() || extracted.from,
      body: extracted.body,
      receivedAt: input.receivedAt || extracted.receivedAt,
    });
  }

  async parseEmail(email: {
    subject: string;
    from: string;
    body: string;
    receivedAt?: string;
  }): Promise<{ segments: ParsedSegment[]; invalidCount: number; rawItemCount: number }> {
    // Anchor year inference on the email's received date, not today's date.
    // Falling back to "now" is OK but should rarely happen in real scans.
    const anchor = email.receivedAt ? new Date(email.receivedAt) : new Date();
    const receivedLine = isNaN(anchor.getTime())
      ? `Email received date: unknown`
      : `Email received date: ${anchor.toISOString().slice(0, 10)} (year=${anchor.getUTCFullYear()})`;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `${receivedLine}\nSubject: ${email.subject}\nFrom: ${email.from}\n\n${email.body}`,
        },
      ],
    });

    const text =
      response.content[0].type === "text" ? response.content[0].text : "";

    return this.parseResponse(text);
  }

  /**
   * Normalize a time string to HH:MM format.
   * Handles: "4:00 PM", "16:00:00.000", "4:00", "16:00", "3:00PM", etc.
   */
  private normalizeTime(time: unknown): string | undefined {
    if (typeof time !== "string" || !time.trim()) return undefined;
    let t = time.trim();

    // Handle AM/PM formats like "4:00 PM", "3:00PM", "12:30 am"
    const ampmMatch = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm|a\.m\.|p\.m\.)$/i);
    if (ampmMatch) {
      let hours = parseInt(ampmMatch[1], 10);
      const minutes = ampmMatch[2];
      const isPM = /pm|p\.m\./i.test(ampmMatch[4]);
      if (isPM && hours < 12) hours += 12;
      if (!isPM && hours === 12) hours = 0;
      return `${hours.toString().padStart(2, "0")}:${minutes}`;
    }

    // Handle 24-hour formats: "16:00", "4:00", "16:00:00", "16:00:00.000"
    const h24Match = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/);
    if (h24Match) {
      const hours = parseInt(h24Match[1], 10);
      const minutes = h24Match[2];
      if (hours >= 0 && hours <= 23) {
        return `${hours.toString().padStart(2, "0")}:${minutes}`;
      }
    }

    return undefined;
  }

  /**
   * Normalize a URL string. Returns undefined if it isn't a valid HTTP(S) URL
   * that Zod's `.url()` validator will accept. This prevents a garbage url
   * value from disqualifying the whole segment during Zod validation.
   */
  private normalizeUrl(url: unknown): string | undefined {
    if (typeof url !== "string") return undefined;
    const trimmed = url.trim();
    if (!trimmed) return undefined;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return undefined;
      }
      return parsed.toString();
    } catch {
      return undefined;
    }
  }

  /**
   * Apply sensible defaults to hotel segments when the email doesn't state
   * explicit check-in / check-out times. Industry-standard defaults: 15:00
   * check-in and 11:00 check-out. The user can edit later.
   */
  private applyHotelDefaults(item: Record<string, unknown>): void {
    if (item.type !== "hotel") return;
    if (!item.startTime) item.startTime = "15:00";
    if (!item.endTime) item.endTime = "11:00";
  }

  /**
   * Normalize cost field so Zod validation doesn't silently strip it.
   * Handles: string amounts ("547.20", "$547.20"), missing currency, etc.
   */
  private normalizeCost(
    cost: unknown,
  ): { amount: number; currency: string; details?: string } | undefined {
    if (!cost || typeof cost !== "object") return undefined;
    const c = cost as Record<string, unknown>;

    // Coerce amount: strip currency symbols, parse to number
    let amount: number | undefined;
    if (typeof c.amount === "number") {
      amount = c.amount;
    } else if (typeof c.amount === "string") {
      const cleaned = c.amount.replace(/[^0-9.,\-]/g, "").replace(/,/g, "");
      amount = parseFloat(cleaned);
    }
    if (amount === undefined || isNaN(amount) || amount < 0) return undefined;

    // Default currency to USD if missing
    const currency =
      typeof c.currency === "string" && c.currency.length > 0
        ? c.currency
        : "USD";

    const details =
      typeof c.details === "string" ? c.details : undefined;

    return { amount, currency, ...(details ? { details } : {}) };
  }

  /** Parse and validate Claude's JSON response */
  private parseResponse(text: string): { segments: ParsedSegment[]; invalidCount: number; rawItemCount: number } {
    try {
      // Extract JSON array from response (handle markdown code blocks)
      let jsonStr = text.trim();
      const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return { segments: [], invalidCount: 0, rawItemCount: 0 };
      jsonStr = jsonMatch[0];

      const raw = JSON.parse(jsonStr);
      if (!Array.isArray(raw)) return { segments: [], invalidCount: 0, rawItemCount: 0 };

      // Validate each segment with Zod, keeping only valid ones
      const segments: ParsedSegment[] = [];
      let invalidCount = 0;
      for (const item of raw) {
        // Normalize time fields before validation
        if (item.startTime) item.startTime = this.normalizeTime(item.startTime);
        if (item.endTime) item.endTime = this.normalizeTime(item.endTime);

        // Normalize URL — strip anything that isn't a valid http(s) URL
        // so it doesn't disqualify the entire segment during Zod validation.
        item.url = this.normalizeUrl(item.url);

        // Apply sensible hotel defaults when check-in/check-out times aren't
        // stated in the email body (standard 15:00 / 11:00).
        this.applyHotelDefaults(item);

        // Log raw cost data for debugging
        if (item.cost) {
          console.log(
            `[EmailParser] Raw cost for "${item.title}":`,
            JSON.stringify(item.cost),
          );
          item.cost = this.normalizeCost(item.cost);
          console.log(
            `[EmailParser] Normalized cost for "${item.title}":`,
            JSON.stringify(item.cost),
          );
        } else {
          console.log(
            `[EmailParser] No cost returned for "${item.title}" (type: ${item.type})`,
          );
        }

        const result = parsedSegmentSchema.safeParse(item);
        if (result.success) {
          segments.push(result.data as ParsedSegment);
        } else {
          // Try to salvage by adding defaults for missing required fields
          const patched = {
            ...item,
            confidence: item.confidence || "low",
          };
          const retry = parsedSegmentSchema.safeParse(patched);
          if (retry.success) {
            segments.push(retry.data as ParsedSegment);
          } else {
            invalidCount++;
            console.warn(
              "Skipping invalid parsed segment:",
              retry.error.issues,
            );
          }
        }
      }

      return { segments, invalidCount, rawItemCount: raw.length };
    } catch (err) {
      console.error("Failed to parse Claude response:", err);
      return { segments: [], invalidCount: 0, rawItemCount: 0 };
    }
  }
}
