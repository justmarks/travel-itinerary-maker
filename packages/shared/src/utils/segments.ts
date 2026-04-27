import type { Segment, Trip } from "../types/trip";
import { lookupAirport } from "./airport-lookup";

/**
 * Combine `carrier` and `routeCode` into a display label like
 * "Delta 359". Returns an empty string when neither is set.
 */
export function formatFlightLabel(
  segment: Pick<Segment, "carrier" | "routeCode">,
): string {
  return [segment.carrier, segment.routeCode].filter(Boolean).join(" ");
}

/**
 * Format one end of a flight (departure or arrival) for display.
 *
 * Resolution order:
 *  1. IATA code known: `City (CODE)` (e.g. "New York (JFK)")
 *  2. IATA code unknown but provided: bare code (e.g. "XYZ")
 *  3. No code, only city: city
 *  4. Neither: undefined
 *
 * `style: "compact"` returns just the IATA code when one is set, falling
 * back to the city. Use it in tight layouts (timeline pills) where the
 * code alone is enough to identify the leg.
 */
export function formatFlightEndpoint(
  airportCode: string | undefined,
  fallbackCity: string | undefined,
  style: "full" | "compact" = "full",
): string | undefined {
  const code = airportCode?.trim().toUpperCase();
  if (code && /^[A-Z]{3}$/.test(code)) {
    if (style === "compact") return code;
    const info = lookupAirport(code);
    return info ? `${info.city} (${code})` : code;
  }
  return fallbackCity?.trim() || undefined;
}

/**
 * For every cruise segment in the trip, walk its `portsOfCall` array and
 * overwrite `day.city` on the matching TripDay with the port name for that
 * day (or "At Sea" on sea days). A cruise confirmation lists a specific port
 * for each day of the voyage — that's the most authoritative city signal
 * available for those days, so it wins over any previously-set value (empty
 * string, propagated value, or a city picked at trip creation).
 *
 * Mutates the trip in place. Returns a list of `{date, from, to}` records
 * describing the days that changed, so callers can log or return the diff.
 */
export function applyCruisePortsToDayCities(
  trip: Trip,
): Array<{ date: string; from: string; to: string }> {
  const changes: Array<{ date: string; from: string; to: string }> = [];
  const daysByDate = new Map(trip.days.map((d) => [d.date, d]));

  for (const day of trip.days) {
    for (const seg of day.segments) {
      if (seg.type !== "cruise" || !seg.portsOfCall) continue;
      for (const portDay of seg.portsOfCall) {
        const target = daysByDate.get(portDay.date);
        if (!target) continue;
        const nextCity = portDay.atSea ? "At Sea" : portDay.port;
        if (!nextCity) continue;
        if (target.city !== nextCity) {
          changes.push({ date: target.date, from: target.city, to: nextCity });
          target.city = nextCity;
        }
      }
    }
  }

  return changes;
}
