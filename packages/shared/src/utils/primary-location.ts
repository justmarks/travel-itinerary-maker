/**
 * Determine the "primary" location for a trip — the city where the user
 * spends the most days. Used by the trip-card UI to pick a hero image and
 * country flag without scanning every segment in the client.
 *
 * Tie-break: earliest first appearance in `trip.days`. Empty cities and
 * "at sea" cruise days are skipped (they don't represent a place to image).
 */

import type { Trip, TripDay } from "../types/trip";

export interface PrimaryLocation {
  /** Display city as it appears on the day (preserves diacritics + casing). */
  city: string;
  /** ISO 3166-1 alpha-2 country code, when known. */
  countryCode?: string;
  /** Human-readable country name, when known. */
  country?: string;
  /** Number of days spent in that city (i.e. the winning count). */
  dayCount: number;
}

/** Lowercase + strip diacritics. Used internally for map lookups. */
function fold(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Normalise a city string for lookup: fold + take the first comma-separated
 * part. "Reykjavík" → "reykjavik"; "Orlando, FL" → "orlando". Returns "" for
 * skip-worthy entries (empty / "at sea" cruise days).
 */
function normalizeCity(raw: string): string {
  if (!raw) return "";
  const folded = fold(raw);
  if (!folded || folded === "at sea") return "";
  const head = folded.split(",")[0]?.trim() ?? folded;
  return head;
}

/**
 * Country lookup keyed by normalised city name. Kept intentionally small —
 * extend as new destinations show up in real trips. Cities not in the map
 * still produce a valid `PrimaryLocation` (just without country data), so the
 * UI can fall back to a name-only / gradient hero.
 */
const CITY_TO_COUNTRY: Record<string, { code: string; name: string }> = {
  // Japan
  tokyo: { code: "JP", name: "Japan" },
  kyoto: { code: "JP", name: "Japan" },
  osaka: { code: "JP", name: "Japan" },
  nara: { code: "JP", name: "Japan" },
  hiroshima: { code: "JP", name: "Japan" },
  hakone: { code: "JP", name: "Japan" },
  nikko: { code: "JP", name: "Japan" },
  yokohama: { code: "JP", name: "Japan" },

  // France
  paris: { code: "FR", name: "France" },
  nice: { code: "FR", name: "France" },
  lyon: { code: "FR", name: "France" },
  marseille: { code: "FR", name: "France" },

  // Iceland
  reykjavik: { code: "IS", name: "Iceland" },
  selfoss: { code: "IS", name: "Iceland" },
  vik: { code: "IS", name: "Iceland" },
  akureyri: { code: "IS", name: "Iceland" },

  // United States
  "new york": { code: "US", name: "United States" },
  nyc: { code: "US", name: "United States" },
  seattle: { code: "US", name: "United States" },
  orlando: { code: "US", name: "United States" },
  "port canaveral": { code: "US", name: "United States" },
  "san francisco": { code: "US", name: "United States" },
  "los angeles": { code: "US", name: "United States" },
  chicago: { code: "US", name: "United States" },
  boston: { code: "US", name: "United States" },
  miami: { code: "US", name: "United States" },

  // United Kingdom
  london: { code: "GB", name: "United Kingdom" },
  edinburgh: { code: "GB", name: "United Kingdom" },

  // Italy
  rome: { code: "IT", name: "Italy" },
  florence: { code: "IT", name: "Italy" },
  venice: { code: "IT", name: "Italy" },
  milan: { code: "IT", name: "Italy" },

  // Spain
  barcelona: { code: "ES", name: "Spain" },
  madrid: { code: "ES", name: "Spain" },

  // Germany
  berlin: { code: "DE", name: "Germany" },
  munich: { code: "DE", name: "Germany" },

  // Netherlands
  amsterdam: { code: "NL", name: "Netherlands" },

  // Bahamas (cruise stops)
  nassau: { code: "BS", name: "Bahamas" },
  "castaway cay": { code: "BS", name: "Bahamas" },

  // A few more popular destinations — extend as needed.
  bangkok: { code: "TH", name: "Thailand" },
  singapore: { code: "SG", name: "Singapore" },
  "hong kong": { code: "HK", name: "Hong Kong" },
  seoul: { code: "KR", name: "South Korea" },
  sydney: { code: "AU", name: "Australia" },
  melbourne: { code: "AU", name: "Australia" },
  dubai: { code: "AE", name: "United Arab Emirates" },
  istanbul: { code: "TR", name: "Türkiye" },
  lisbon: { code: "PT", name: "Portugal" },
  mexico: { code: "MX", name: "Mexico" },
  toronto: { code: "CA", name: "Canada" },
  vancouver: { code: "CA", name: "Canada" },
};

/**
 * Look up country info for a (potentially comma-suffixed, accented) city.
 * Falls back to matching the part *after* the first comma — handles
 * "Castaway Cay, Bahamas" when only "bahamas" is in the table by extension.
 */
function lookupCountry(rawCity: string): { code: string; name: string } | undefined {
  const head = normalizeCity(rawCity);
  if (!head) return undefined;
  const direct = CITY_TO_COUNTRY[head];
  if (direct) return direct;
  // Fallback: try the suffix (e.g. "Castaway Cay, Bahamas" → "bahamas").
  const parts = fold(rawCity)
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts.slice(1)) {
    if (CITY_TO_COUNTRY[part]) return CITY_TO_COUNTRY[part];
  }
  return undefined;
}

/**
 * Pick the city the user spends the most days in. Returns `undefined` for
 * trips with no usable city data (all empty / all "at sea").
 *
 * Cities are grouped by their normalised form so "Reykjavík" and "Reykjavik"
 * are treated as the same place; the displayed `city` is taken from the
 * first day in that group (preserving the user's original casing/diacritics).
 */
export function primaryLocationFor(trip: Pick<Trip, "days">): PrimaryLocation | undefined {
  const groups = new Map<string, { display: string; count: number; firstIndex: number }>();
  trip.days.forEach((day: TripDay, idx: number) => {
    const key = normalizeCity(day.city);
    if (!key) return;
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, { display: day.city, count: 1, firstIndex: idx });
    }
  });

  if (groups.size === 0) return undefined;

  // Highest count, tie-break on earliest first appearance.
  let winner: { display: string; count: number; firstIndex: number } | undefined;
  for (const group of groups.values()) {
    if (
      !winner ||
      group.count > winner.count ||
      (group.count === winner.count && group.firstIndex < winner.firstIndex)
    ) {
      winner = group;
    }
  }
  if (!winner) return undefined;

  const country = lookupCountry(winner.display);
  return {
    city: winner.display,
    countryCode: country?.code,
    country: country?.name,
    dayCount: winner.count,
  };
}
