/**
 * Today's date in the browser's local timezone, formatted as `YYYY-MM-DD`.
 * Trip days are stored as plain ISO date strings with no timezone, so we
 * want today relative to the user's wall clock — not UTC.
 */
export function getTodayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
