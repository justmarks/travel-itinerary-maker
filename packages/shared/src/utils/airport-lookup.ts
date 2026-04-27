/**
 * IATA airport-code lookup.
 *
 * Backed by a static dataset (`airports-data.ts`) generated from the
 * OurAirports `large_airport` rows — every commercial hub a traveler
 * realistically flies through. Used to:
 *  1. Render flight endpoints as `City (CODE)` (e.g. "New York (JFK)").
 *  2. Derive an IANA timezone for calendar export so a 09:00 Tokyo flight
 *     stays at 09:00 JST regardless of the attendee's device zone.
 *  3. Power the airport autocomplete in the segment editor.
 *
 * Unknown codes return `undefined`; callers should fall back to displaying
 * the raw code.
 */

import { AIRPORTS } from "./airports-data";

export interface AirportInfo {
  /** Human-readable city / municipality (e.g. "New York"). */
  city: string;
  /** ISO 3166-1 alpha-2 country code (e.g. "US"). */
  country: string;
  /** Full airport name (e.g. "John F. Kennedy International Airport"). */
  airportName: string;
  /** IANA timezone (e.g. "America/New_York"). */
  timezone: string;
  /**
   * Optional aliases that should match this airport in `searchAirports`,
   * e.g. NRT carries "Tokyo" because its municipality is "Narita". Sourced
   * from the OurAirports `keywords` column, ASCII-only.
   */
  keywords?: string[];
}

/** Normalise an IATA-ish input to the canonical 3-letter uppercase form. */
function normaliseIata(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const trimmed = code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * Look up an airport by IATA code. Returns `undefined` for unknown or
 * malformed codes so callers can fall back gracefully (e.g. show the raw
 * code instead of a city name).
 */
export function lookupAirport(code: string | undefined): AirportInfo | undefined {
  const c = normaliseIata(code);
  if (!c) return undefined;
  return AIRPORTS[c];
}

/**
 * Return the IANA timezone for an airport code, or `undefined` if unknown.
 * Convenience wrapper used by the iCal generator and Google Calendar sync
 * to keep the import surface narrow.
 */
export function getAirportTimezone(code: string | undefined): string | undefined {
  return lookupAirport(code)?.timezone;
}

/**
 * Format a flight endpoint for display.
 *
 *   "JFK"  → "New York (JFK)"  (when known)
 *   "JFK"  → "JFK"             (when unknown)
 *   undef  → undefined
 *
 * Pass `style: "compact"` for tight spaces (timeline pills) — returns just
 * the code when known, the raw input otherwise.
 */
export function formatAirportLabel(
  code: string | undefined,
  style: "full" | "compact" = "full",
): string | undefined {
  const c = normaliseIata(code);
  if (!c) return code?.trim() || undefined;
  if (style === "compact") return c;
  const info = AIRPORTS[c];
  return info ? `${info.city} (${c})` : c;
}

/**
 * Search the airport table by code, city, country, or airport name.
 * Used by the autocomplete combobox in the segment editor.
 *
 * Results are scored loosely — exact code match first, then prefix matches
 * on city / name, then substring matches. Capped at `limit` rows.
 */
export function searchAirports(query: string, limit = 20): Array<{ code: string } & AirportInfo> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const exactCode = normaliseIata(query);
  const results: Array<{ code: string; info: AirportInfo; score: number }> = [];

  for (const [code, info] of Object.entries(AIRPORTS)) {
    let score = 0;
    if (exactCode && code === exactCode) score = 1000;
    else if (code.toLowerCase().startsWith(q)) score = 500;
    else if (info.city.toLowerCase() === q) score = 400;
    else if (info.city.toLowerCase().startsWith(q)) score = 300;
    else if (info.airportName.toLowerCase().startsWith(q)) score = 200;
    else if (info.city.toLowerCase().includes(q)) score = 100;
    else if (info.airportName.toLowerCase().includes(q)) score = 50;
    else if (info.keywords?.some((k) => k.toLowerCase() === q)) score = 250;
    else if (info.keywords?.some((k) => k.toLowerCase().includes(q))) score = 25;
    if (score > 0) results.push({ code, info, score });
  }

  results.sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
  return results.slice(0, limit).map(({ code, info }) => ({ code, ...info }));
}
