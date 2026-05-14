/**
 * Async city → IANA timezone resolver for cities not in the static table.
 *
 * Flow: static table (via getCityTimezone) → Nominatim geocode → timeapi.io
 * Results are cached in-process so each unique city is only fetched once.
 *
 * Both APIs are free and require no API key:
 *   - Nominatim (OpenStreetMap): https://nominatim.openstreetmap.org
 *   - timeapi.io: https://timeapi.io
 */

import { getCityTimezone, preloadCityTimezone } from "@itinly/shared";
import type { Trip } from "@itinly/shared";
import { isTimezoneDebugEnabled } from "./debug-log";

// Bounded cache. Misspelled / one-off city strings (user typos,
// "John's place in Paris") would otherwise accumulate forever and
// each entry is a string pair, but with millions of trips × dozens
// of segments the upper bound matters. JS Maps preserve insertion
// order, so when we hit the cap we drop the oldest entry — same
// shape as an LRU but without tracking access order (each entry's
// useful lifetime is a single trip's resolve cycle anyway).
const CACHE_MAX_SIZE = 5000;
const resolvedCache = new Map<string, string>();

function cacheSet(city: string, tz: string): void {
  // Refresh ordering for an existing key by deleting + re-inserting.
  if (resolvedCache.has(city)) resolvedCache.delete(city);
  resolvedCache.set(city, tz);
  while (resolvedCache.size > CACHE_MAX_SIZE) {
    const firstKey = resolvedCache.keys().next().value;
    if (firstKey === undefined) break;
    resolvedCache.delete(firstKey);
  }
}

async function fetchTimezoneForCity(city: string): Promise<string | undefined> {
  try {
    const geoUrl =
      `https://nominatim.openstreetmap.org/search` +
      `?city=${encodeURIComponent(city)}&format=json&limit=1&addressdetails=0`;

    const geoRes = await fetch(geoUrl, {
      headers: { "User-Agent": "itinly/1.0 (timezone-lookup)" },
      signal: AbortSignal.timeout(5000),
    });
    if (!geoRes.ok) return undefined;

    const geoData = (await geoRes.json()) as Array<{ lat: string; lon: string }>;
    if (!geoData.length) return undefined;

    const { lat, lon } = geoData[0];

    const tzUrl =
      `https://timeapi.io/api/timezone/coordinate` +
      `?latitude=${lat}&longitude=${lon}`;

    const tzRes = await fetch(tzUrl, {
      signal: AbortSignal.timeout(5000),
    });
    if (!tzRes.ok) return undefined;

    const tzData = (await tzRes.json()) as { timeZone?: string };
    return tzData.timeZone ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve all cities in a trip that are not in the static table.
 * Unknown cities are looked up via Nominatim + timeapi.io and cached so
 * subsequent calls to getCityTimezone() within this process return the
 * resolved timezone without another network round-trip.
 */
export async function resolveTripTimezones(trip: Trip): Promise<void> {
  const cities = new Set<string>();
  for (const day of trip.days) {
    if (day.city) cities.add(day.city);
    for (const seg of day.segments) {
      if (seg.city) cities.add(seg.city);
      if (seg.departureCity) cities.add(seg.departureCity);
      if (seg.arrivalCity) cities.add(seg.arrivalCity);
    }
  }

  const unknown = [...cities].filter((c) => !getCityTimezone(c));
  if (!unknown.length) return;

  await Promise.all(
    unknown.map(async (city) => {
      if (resolvedCache.has(city)) {
        preloadCityTimezone(city, resolvedCache.get(city)!);
        return;
      }
      const tz = await fetchTimezoneForCity(city);
      if (tz) {
        // City strings are user-controlled and may contain PII
        // ("John's flat in Paris"). Gate the verbose echo behind
        // DEBUG_TIMEZONES=1 so production Railway logs don't carry
        // it. The aggregate resolve-count is the only signal ops
        // actually needs day-to-day.
        if (isTimezoneDebugEnabled()) {
          console.log(`[timezone-lookup] Resolved "${city}" → ${tz}`);
        }
        cacheSet(city, tz);
        preloadCityTimezone(city, tz);
      } else if (isTimezoneDebugEnabled()) {
        console.warn(`[timezone-lookup] Could not resolve timezone for: "${city}"`);
      }
    }),
  );
}
