import Anthropic from "@anthropic-ai/sdk";
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
- "carrier": airline or transport carrier code (if applicable, e.g. "AS" for Alaska Airlines)
- "routeCode": flight number or route (e.g. "AS123")
- "departureCity": departure city (for flights/trains)
- "arrivalCity": arrival city (for flights/trains)
- "seatNumber": ALL seat assignments for this booking as a comma-separated string (e.g. "12A, 12B, 12C"). If the email lists multiple passengers on the same flight, combine all seats into ONE segment, do NOT create separate segments per passenger.
- "cabinClass": class of service for flights (e.g. "Economy", "Premium Economy", "Business", "First", "Main Cabin", "Comfort+"). Extract exactly as stated in the email.
- "baggageInfo": checked baggage policy for flights (e.g. "1 checked bag included", "2 checked bags included", "No checked bags included - $35/bag", "1 free checked bag per passenger"). Extract if mentioned in the email.
- "partySize": total number of travelers/guests
- "endDate": check-out date for hotels in YYYY-MM-DD format (if available). This is the departure/check-out date, NOT the check-in date.
- "breakfastIncluded": boolean (for hotels, if mentioned)
- "phone": contact phone number (if available)
- "url": booking URL (if available)
- "cost": { "amount": number, "currency": "USD"|"EUR"|etc, "details": "description" } (if price mentioned). The "amount" MUST be a plain number with no currency symbol (e.g. 547.20, NOT "$547.20"). The "currency" must be a string like "USD", "EUR", etc. ALWAYS extract flight prices, hotel prices, car rental prices, and any other costs mentioned in the email.
- "confidence": "high" if clearly a confirmed booking, "medium" if likely a booking, "low" if uncertain

IMPORTANT RULES:
- One booking = one segment. If an email has a flight with 4 passengers and 4 seat numbers, return ONE flight segment with all seats in "seatNumber" and partySize=4.
- **CAR RENTALS**: Return TWO separate segments — one for PICKUP and one for DROPOFF:
  - Pickup segment: type "car_rental", date = pickup date, startTime = pickup time, no endTime. Title format: "Company - City" (e.g. "National - Lihue"). Include cost on the pickup segment only.
  - Dropoff segment: type "car_rental", date = dropoff date, startTime = dropoff time, no endTime. Title format: "Company - City (Return)" (e.g. "National - Lihue (Return)"). No cost on the dropoff segment.
- **HOTELS**: The cost "amount" should be the ROOM RATE only (nightly or total room charge), NOT including fees like parking, resort fees, or taxes. Put the room type (e.g. "2 Bedroom Villa, 2 Bathrooms" or "King Room with City View") and any fees/extras (parking, resort fee, breakfast) in the "details" string so the user can see them separately.
- **FLIGHTS**: For the cost, use ONLY the total price for the booking. Do NOT break down into base fare, taxes, or fees — just the final total amount. If the email shows a per-person price, use that per-person total (multiple per-person emails will be combined later).
- **AIRLINE EMAILS**: Be sure to parse emails from ALL airlines including Hawaiian Airlines, Alaska Airlines, Delta, United, American, Southwest, JetBlue, Spirit, Frontier, and international carriers. Itinerary changes, schedule changes, and booking confirmations are all travel-related. Look for flight numbers, dates, times, and routes even if the email format is unusual.
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
   * Returns empty array if no travel content is found.
   */
  async parseEmail(email: {
    subject: string;
    from: string;
    body: string;
  }): Promise<ParsedSegment[]> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Subject: ${email.subject}\nFrom: ${email.from}\n\n${email.body}`,
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
  private parseResponse(text: string): ParsedSegment[] {
    try {
      // Extract JSON array from response (handle markdown code blocks)
      let jsonStr = text.trim();
      const jsonMatch = jsonStr.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return [];
      jsonStr = jsonMatch[0];

      const raw = JSON.parse(jsonStr);
      if (!Array.isArray(raw)) return [];

      // Validate each segment with Zod, keeping only valid ones
      const segments: ParsedSegment[] = [];
      for (const item of raw) {
        // Normalize time fields before validation
        if (item.startTime) item.startTime = this.normalizeTime(item.startTime);
        if (item.endTime) item.endTime = this.normalizeTime(item.endTime);

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
            console.warn(
              "Skipping invalid parsed segment:",
              retry.error.issues,
            );
          }
        }
      }

      return segments;
    } catch (err) {
      console.error("Failed to parse Claude response:", err);
      return [];
    }
  }
}
