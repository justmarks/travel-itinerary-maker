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
  /**
   * Display label for the trip's hero. Usually a city, but for cruise-
   * dominant trips this is the ship name (e.g. "Disney Fantasy") so the
   * UI can pull a recognisable picture of the ship rather than a forgettable
   * port photo.
   */
  city: string;
  /** ISO 3166-1 alpha-2 country code, when known. Undefined for cruise ships. */
  countryCode?: string;
  /** Human-readable country name, when known. Undefined for cruise ships. */
  country?: string;
  /** Number of trip days this location/ship covers. */
  dayCount: number;
  /**
   * What kind of subject `city` refers to. The UI uses this to skip
   * country-flag rendering for ships and to relax the "Untitled
   * destination" copy when a ship has no flag.
   */
  kind: "city" | "cruise";
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
 * skip-worthy entries (empty / "at sea" cruise days). Slashes are kept as
 * part of the key (so transfer-day strings stay distinct) — see
 * `normalizeCities` for the per-city split.
 */
function normalizeCity(raw: string): string {
  if (!raw) return "";
  const folded = fold(raw);
  if (!folded || folded === "at sea") return "";
  const head = folded.split(",")[0]?.trim() ?? folded;
  return head;
}

/**
 * Normalise a city string into one entry per city. Transfer days encoded
 * with a slash ("Paris / Rome", "Tokyo/Kyoto") count toward each city's
 * tally. For non-slash inputs the result is a single-element array
 * equivalent to `normalizeCity`. The original (trimmed) part is preserved
 * as `display` so casing and diacritics survive into the trip card.
 */
function normalizeCities(
  raw: string,
): Array<{ key: string; display: string }> {
  if (!raw) return [];
  const hasSlash = raw.includes("/");
  // Without a slash, treat the whole string as one city so "Orlando, FL"
  // keeps its original display form (matches pre-slash behaviour).
  const parts = hasSlash
    ? raw
        .split("/")
        .map((p) => p.trim())
        .filter(Boolean)
    : [raw];
  return parts
    .map((part) => {
      const folded = fold(part);
      if (!folded || folded === "at sea") return null;
      const head = folded.split(",")[0]?.trim() ?? folded;
      return head ? { key: head, display: part } : null;
    })
    .filter((x): x is { key: string; display: string } => x !== null);
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
 * Cruise titles in this app commonly read "Ship Name — descriptor",
 * "Ship Name · descriptor", or "Ship Name – descriptor" — split on the
 * first such separator and trim. Some real ship names contain hyphens
 * (e.g. "Norwegian Pearl-Star"), so unspaced `-` is intentionally NOT a
 * separator here.
 */
function extractShipName(title: string | undefined): string | undefined {
  if (!title) return undefined;
  const match = title.match(/^(.*?)\s*[—·–]\s/u);
  const head = (match ? match[1] : title).trim();
  return head || undefined;
}

/**
 * Look for a cruise segment that dominates the trip and return it as the
 * "primary location" (using the ship name) when it covers at least half
 * the trip's days. Without this, the cruise's embarkation port wins the
 * city tally and the user gets a picture of Port Canaveral instead of
 * the Disney Fantasy.
 *
 * Coverage = inclusive count of trip days from the day where the cruise
 * segment lives through `segment.endDate`. Cruise segments without an
 * `endDate` are skipped (we can't tell how long they last).
 */
function findCruiseLocation(trip: Pick<Trip, "days">): PrimaryLocation | undefined {
  if (trip.days.length === 0) return undefined;
  const dateIndex = new Map<string, number>();
  trip.days.forEach((d, i) => dateIndex.set(d.date, i));

  let best: { name: string; coverage: number } | undefined;
  trip.days.forEach((day: TripDay, dayIdx: number) => {
    for (const seg of day.segments) {
      if (seg.type !== "cruise") continue;
      if (!seg.endDate) continue;
      const endIdx = dateIndex.get(seg.endDate);
      if (endIdx === undefined || endIdx < dayIdx) continue;
      const coverage = endIdx - dayIdx + 1;
      const name = extractShipName(seg.title);
      if (!name) continue;
      if (!best || coverage > best.coverage) {
        best = { name, coverage };
      }
    }
  });

  if (!best) return undefined;
  // Require the cruise to cover at least half the trip to take precedence
  // over city-based aggregation. A 2-night cruise on a 10-day trip
  // shouldn't replace the rest of the itinerary's hero.
  if (best.coverage * 2 < trip.days.length) return undefined;
  return { city: best.name, dayCount: best.coverage, kind: "cruise" };
}

/**
 * Identify a "home" bookend city. The user's home is the place they depart
 * from on day 1 and return to on the last day — encoded in transfer-day
 * notation as the FIRST city of the first day's slash list, and the LAST
 * city of the last day's slash list. When those match, that city is the
 * user's home origin/return point and gets excluded from the destination
 * tally. Returns the set of keys to exclude (size 0 or 1 in practice).
 *
 * Examples:
 *   - "Seattle" → "Seattle"                       → bookend = {seattle}
 *   - "Seattle / New York" → "New York / Seattle" → bookend = {seattle}
 *   - "Seattle" → "Munich / Seattle"              → bookend = {seattle}
 *   - "Seattle / Paris" → "Rome / Seattle"        → bookend = {seattle}
 *   - "Seattle" → "Paris"                         → bookend = {} (no match)
 *   - 1-day trips                                 → bookend = {} (no pattern)
 */
function findBookendKeys(trip: Pick<Trip, "days">): Set<string> {
  let firstDay: TripDay | undefined;
  let lastDay: TripDay | undefined;
  let firstIdx = -1;
  let lastIdx = -1;
  for (let i = 0; i < trip.days.length; i++) {
    if (normalizeCities(trip.days[i].city).length === 0) continue;
    if (!firstDay) {
      firstDay = trip.days[i];
      firstIdx = i;
    }
    lastDay = trip.days[i];
    lastIdx = i;
  }
  if (!firstDay || !lastDay || firstIdx === lastIdx) return new Set();

  const firstCities = normalizeCities(firstDay.city);
  const lastCities = normalizeCities(lastDay.city);
  // First slash part of the first day = where the trip departs from.
  // Last slash part of the last day = where the trip returns to.
  const departureHome = firstCities[0]?.key;
  const returnHome = lastCities[lastCities.length - 1]?.key;
  if (!departureHome || !returnHome) return new Set();
  if (departureHome !== returnHome) return new Set();
  return new Set([departureHome]);
}

/**
 * Pick the most representative location for a trip's hero image. For
 * cruise-dominant trips this is the ship name; otherwise it's the city the
 * user spends the most days in. Returns `undefined` for trips with no
 * usable data (all empty / all "at sea" with no cruise segment).
 *
 * Cities are grouped by their normalised form so "Reykjavík" and "Reykjavik"
 * are treated as the same place; the displayed `city` is taken from the
 * first day in that group (preserving the user's original casing/diacritics).
 *
 * Two refinements beyond pure day-count:
 * 1. Transfer days encoded as "Paris / Rome" count toward each city
 *    individually (see `normalizeCities`).
 * 2. If the first and last days of the trip share the same city, that
 *    city is treated as a bookend "home" and excluded from the tally —
 *    so a SEA → Europe → SEA itinerary picks the European primary, not
 *    the airport you started and ended at. The exclusion is dropped
 *    automatically if it would leave the trip with no candidates (e.g.
 *    a local Seattle staycation), in which case the bookend wins as
 *    primary after all.
 */
export function primaryLocationFor(trip: Pick<Trip, "days">): PrimaryLocation | undefined {
  const cruise = findCruiseLocation(trip);
  if (cruise) return cruise;

  const bookendKeys = findBookendKeys(trip);

  const tally = (excludeBookend: boolean) => {
    const groups = new Map<
      string,
      { display: string; count: number; firstIndex: number }
    >();
    trip.days.forEach((day: TripDay, idx: number) => {
      for (const { key, display } of normalizeCities(day.city)) {
        if (excludeBookend && bookendKeys.has(key)) continue;
        const existing = groups.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          groups.set(key, { display, count: 1, firstIndex: idx });
        }
      }
    });
    return groups;
  };

  let groups = tally(true);
  if (groups.size === 0 && bookendKeys.size > 0) {
    // The trip has nothing but the bookend city — local/staycation pattern.
    // Fall back to including the bookend so the card shows that city.
    groups = tally(false);
  }
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

  // TEMPORARY DEBUG (option C from the rebrand session) — logs the per-trip
  // city tally so we can see why a particular city won. Remove once we're
  // done diagnosing mis-classified trips. (Always logs, including from
  // tests; that's by design — keeps the gating logic dependency-free.)
  // eslint-disable-next-line no-console
  console.log("[primary-location]", {
    bookendKeys: [...bookendKeys],
    groups: Array.from(groups.entries()).map(([k, v]) => ({ key: k, ...v })),
    winner,
  });

  const country = lookupCountry(winner.display);
  return {
    city: winner.display,
    countryCode: country?.code,
    country: country?.name,
    dayCount: winner.count,
    kind: "city",
  };
}
