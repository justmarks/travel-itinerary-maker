/**
 * Sorts items so the entry whose email matches the user's primary
 * account email comes first, then everything else in original order.
 *
 * Used on the /settings/account page so all three sections (Linked
 * sign-in methods, Email, Calendar) open with the row tied to the
 * user's primary Supabase email at the top — consistent ordering
 * across the panels regardless of which provider the user signed
 * up with first.
 *
 * Stable partition (two-pass) rather than `Array.prototype.sort`
 * because:
 *   - Older JS engines don't guarantee stable sort, and we DO need
 *     non-matching entries to keep their original relative order.
 *   - The two-pass is `O(n)` vs sort's `O(n log n)`; not a perf
 *     concern at typical N (≤4) but makes the intent obvious.
 *
 * Returns a new array; the input is not mutated.
 */
export function sortByPrimaryEmail<T>(
  items: readonly T[],
  emailOf: (item: T) => string,
  primaryEmail: string | null,
): T[] {
  if (!primaryEmail || items.length <= 1) return items.slice();
  const target = primaryEmail.toLowerCase();
  const primary: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    if (emailOf(item).toLowerCase() === target) primary.push(item);
    else rest.push(item);
  }
  return [...primary, ...rest];
}
