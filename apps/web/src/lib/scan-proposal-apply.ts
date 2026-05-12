/**
 * Shared between `email-scan-dialog` (desktop) and
 * `mobile-email-scan-sheet`: the sentinel-resolution loop that turns
 * `__new__N` proposal ids into real trip ids before an Apply.
 *
 * Each surface stores selections in its own shape — desktop's
 * `SegmentSelection` flattens `ParsedSegment` + assignedTripId, while
 * mobile's `ReviewItem` wraps `segment: ParsedSegment` alongside its
 * tripId — so callers `.map()` into the normalised `ProposalApplyItem`
 * shape this helper consumes. Keeps both surfaces in lockstep on the
 * subtle bits (date-range expansion when a user moves a segment from
 * one proposal into another) without forcing them to share state types.
 */

import { NEW_TRIP_PREFIX, type NewTripProposal } from "@travel-app/shared";

export interface ProposalApplyItem {
  /** Trip id this selection is currently bound to. May be a sentinel
   *  (`__new__N`), a real trip id, or empty. */
  tripId: string;
  /** Start date of the segment span. */
  startDate: string;
  /** End date of the segment span; defaults to startDate when the
   *  segment doesn't span multiple days (most non-cruise types). */
  endDate?: string;
}

export interface CreateTripFn {
  (input: {
    title: string;
    startDate: string;
    endDate: string;
  }): Promise<{ id: string }>;
}

/**
 * Walks the items that are about to be applied, finds the proposal
 * sentinels they're bound to, and creates a real trip per used
 * proposal. Returns a Map from sentinel id → real trip id; the
 * caller swaps each item's `tripId` through the map before building
 * the apply payload.
 *
 * For each used proposal, the date range is expanded to cover any
 * segments the user moved INTO it whose date falls outside the
 * auto-clustered range — the segments-apply call would otherwise
 * fail because the trip's days wouldn't include the segment's date.
 *
 * Trips are created sequentially because `createTrip` rejects
 * overlapping trips for the same user; running these in parallel
 * would race the overlap check and intermittently fail in pairs.
 */
export async function resolveProposalSentinels(
  toApply: readonly ProposalApplyItem[],
  proposals: readonly NewTripProposal[],
  createTrip: CreateTripFn,
): Promise<Map<string, string>> {
  const sentinelToRealId = new Map<string, string>();
  const usedSentinels = new Set(
    toApply
      .map((it) => it.tripId)
      .filter((id) => id.startsWith(NEW_TRIP_PREFIX)),
  );
  for (const sentinel of usedSentinels) {
    const proposal = proposals.find((p) => p.id === sentinel);
    if (!proposal) continue;
    const assigned = toApply.filter((it) => it.tripId === sentinel);
    const dates = assigned.flatMap((it) => [
      it.startDate,
      it.endDate ?? it.startDate,
    ]);
    const startDate = dates.reduce(
      (a, b) => (a < b ? a : b),
      proposal.startDate,
    );
    const endDate = dates.reduce(
      (a, b) => (a > b ? a : b),
      proposal.endDate,
    );
    const created = await createTrip({
      title: proposal.title,
      startDate,
      endDate,
    });
    sentinelToRealId.set(sentinel, created.id);
  }
  return sentinelToRealId;
}
