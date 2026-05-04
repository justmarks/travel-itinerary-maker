import type { Trip, TripHistoryEntry } from "../types/trip";

/**
 * Hard cap on per-trip history entries. Old entries are trimmed off the
 * front when the list grows past this limit. 500 covers heavy editing on
 * a multi-week trip and stays well under the size at which a single trip
 * JSON document becomes unwieldy (~100 KB at typical entry sizes).
 */
export const TRIP_HISTORY_MAX_ENTRIES = 500;

/**
 * Append a history entry to a trip immutably. The most recent entry is at
 * the END of the array; UI flips it to reverse-chrono on render. If the
 * resulting list exceeds the cap, the oldest entries are dropped.
 *
 * Pure / side-effect-free — returns a new Trip; does not mutate the input.
 */
export function appendTripHistory(trip: Trip, entry: TripHistoryEntry): Trip {
  const existing = trip.history ?? [];
  const next = [...existing, entry];
  const trimmed =
    next.length > TRIP_HISTORY_MAX_ENTRIES
      ? next.slice(next.length - TRIP_HISTORY_MAX_ENTRIES)
      : next;
  return { ...trip, history: trimmed };
}
