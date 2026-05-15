/**
 * Trip date formatting shared across the desktop trip card, mobile trip
 * row, the trip detail header, and the overlap-error lists. Three call
 * sites historically defined their own `formatDateRange` — desktop card
 * and mobile shared one shape ("Sep 12 – Sep 19, 2026" — year only on
 * the end), the detail header used another ("Sep 12, 2026 – Sep 19,
 * 2026" — year repeated). Same trip data ended up rendered three
 * different ways depending on where you looked.
 *
 * One helper, one shape: year on the end only. Compact in the card +
 * row, still unambiguous in the header.
 */
export function formatTripDateRange(start: string, end: string): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const fmt = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-US", opts);
  const yr = new Date(end + "T00:00:00").getFullYear();
  return `${fmt(start)} – ${fmt(end)}, ${yr}`;
}
