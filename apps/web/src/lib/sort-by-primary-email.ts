/**
 * Sorts items so the entry whose email matches the user's primary
 * Supabase email comes first, then everything else in original order.
 * Used across `ConnectedProvidersPanel` and `ConnectedServicesPanel`
 * so all three sections on /settings/account open with the
 * primary-account row consistently.
 *
 * Returns a new array; original is not mutated.
 */
export function sortByPrimaryEmail<T>(
  items: readonly T[],
  emailOf: (item: T) => string,
  primaryEmail: string | null,
): T[] {
  if (!primaryEmail || items.length <= 1) return items.slice();
  const target = primaryEmail.toLowerCase();
  // Stable partition: matching items first (in their original order),
  // non-matching after. Array.prototype.sort isn't stable enough in
  // older runtimes for "0 means equal preserves order" — splitting
  // into two passes guarantees it.
  const primary: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    if (emailOf(item).toLowerCase() === target) primary.push(item);
    else rest.push(item);
  }
  return [...primary, ...rest];
}
