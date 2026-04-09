import Anthropic from "@anthropic-ai/sdk";
import { parsedSegmentSchema, SEGMENT_TYPES } from "@travel-app/shared";
import type { ParsedSegment } from "@travel-app/shared";

const SYSTEM_PROMPT = `You are a travel itinerary extraction assistant. Given an email, extract all travel-related bookings and return them as a JSON array.

Each item in the array must be a JSON object with these fields:
- "type": one of: ${SEGMENT_TYPES.map((t) => `"${t}"`).join(", ")}
- "title": short descriptive title (e.g. "SEA → NRT", "Hilton Garden Inn", "Dinner at Canlis")
- "date": date in YYYY-MM-DD format
- "startTime": time in HH:MM format (if available)
- "endTime": time in HH:MM format (if available)
- "city": city name (if available)
- "venueName": hotel/restaurant/venue name (if applicable)
- "address": street address (if available)
- "confirmationCode": booking confirmation number (if available)
- "provider": booking provider or airline/company name (if available)
- "carrier": airline or transport carrier code (if applicable, e.g. "AS" for Alaska Airlines)
- "routeCode": flight number or route (e.g. "AS123")
- "departureCity": departure city (for flights/trains)
- "arrivalCity": arrival city (for flights/trains)
- "seatNumber": seat assignment (if available)
- "partySize": number of guests (for restaurants)
- "breakfastIncluded": boolean (for hotels, if mentioned)
- "phone": contact phone number (if available)
- "url": booking URL (if available)
- "cost": { "amount": number, "currency": "USD"|"EUR"|etc, "details": "description" } (if price mentioned)
- "confidence": "high" if clearly a confirmed booking, "medium" if likely a booking, "low" if uncertain

Only include fields that are actually present in the email. Do not guess or fabricate data.
For restaurant types, use restaurant_breakfast, restaurant_brunch, restaurant_lunch, or restaurant_dinner based on time or context.

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
    try {
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
    } catch (err) {
      console.error("Claude parsing error:", err);
      return [];
    }
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
