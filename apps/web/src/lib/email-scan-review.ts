/**
 * Shared helpers for the "parsed segments → review → apply" UX.
 *
 * Both the multi-step Gmail-scan sheet (`MobileEmailScanSheet`) and
 * the PWA share-target receiver (`/m/share`) build the same review
 * model from one or more `EmailScanResult`s: each parsed segment is
 * paired with a default action (create / merge / replace / skip), a
 * default `selected` flag, and a `tripId` that's either an existing
 * trip or a sentinel ID into a `NewTripProposal` cluster.
 *
 * Keeping these helpers in one place stops the two surfaces from
 * drifting on the small but load-bearing rules — e.g. "default-skip
 * duplicates and low-confidence parses" or "cluster unmatched
 * segments into proposed new trips and bind each item to its
 * proposal's sentinel id."
 */

import type {
  EmailScanResult,
  NewTripProposal,
  ParsedSegment,
  SegmentMatchStatus,
} from "@itinly/shared";
import { proposeNewTrips } from "@itinly/shared";

export type ApplyAction = "create" | "merge" | "replace" | "skip";

export interface ReviewItem {
  emailId: string;
  emailSubject: string;
  segment: ParsedSegment;
  /** Local UI state — selected to apply, with a chosen action + trip. */
  selected: boolean;
  action: ApplyAction;
  /**
   * Either a real existing trip id OR a new-trip-proposal sentinel
   * (`__new__N`). Sentinels are swapped for real ids in the apply
   * handler after `useCreateTrip` resolves. Empty string means
   * "unassigned" — Apply will refuse to send such a segment.
   */
  tripId: string;
}

/**
 * Pick the default "what should this segment do?" action from the
 * server-side match classification. Duplicates default to skip,
 * enrichment/conflict default to merge so the user's existing data is
 * preserved + augmented, and net-new gets create.
 */
export function defaultActionFor(
  status: SegmentMatchStatus | undefined,
): ApplyAction {
  if (status === "duplicate") return "skip";
  if (status === "enrichment") return "merge";
  if (status === "conflict") return "merge";
  return "create";
}

/**
 * Whether a parsed segment should start checked. Skip duplicates AND
 * low-confidence parses — the user can opt them in, but a half-confident
 * parse silently overwriting their itinerary is the wrong default.
 */
export function defaultSelectedFor(seg: ParsedSegment): boolean {
  const status = seg.match?.status ?? "new";
  return status !== "duplicate" && seg.confidence !== "low";
}

/**
 * Build the review-step state from a scan response. Returns both
 * `items` and the `proposals` derived from items that didn't match
 * an existing trip — each unassigned item is pre-bound to its
 * proposal's sentinel id so the picker shows "Create <name>" as the
 * default selection.
 */
export function buildReviewItems(
  results: readonly EmailScanResult[],
): { items: ReviewItem[]; proposals: NewTripProposal[] } {
  const items: ReviewItem[] = [];
  for (const res of results) {
    if (res.parseStatus !== "success") continue;
    for (const seg of res.parsedSegments) {
      const tripId = seg.suggestedTripId ?? "";
      const action = defaultActionFor(seg.match?.status);
      const selected = action !== "skip" && defaultSelectedFor(seg);
      items.push({
        emailId: res.emailId,
        emailSubject: res.subject,
        segment: seg,
        selected,
        action,
        tripId,
      });
    }
  }

  const unassigned = items
    .map((it, idx) => ({ idx, it }))
    .filter(({ it }) => !it.tripId);
  const proposals = proposeNewTrips(
    unassigned.map(({ idx, it }) => ({
      key: String(idx),
      segment: it.segment,
    })),
  );
  for (const proposal of proposals) {
    for (const key of proposal.segmentKeys) {
      const idx = parseInt(key, 10);
      if (Number.isNaN(idx)) continue;
      items[idx].tripId = proposal.id;
    }
  }
  return { items, proposals };
}

/**
 * Formats a trip's date range for the trip-picker dropdown:
 * `"Mar 5 – Mar 12"` (same year) or `"Dec 28 2026 – Jan 3 2027"`
 * when the range crosses calendar years.
 */
export function fmtTripRange(start: string, end: string): string {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const sameYear = s.getFullYear() === e.getFullYear();
  const opts: Intl.DateTimeFormatOptions = sameYear
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" };
  const fmt = (d: Date) => d.toLocaleDateString("en-US", opts);
  return `${fmt(s)} – ${fmt(e)}`;
}

/** Short "Wed, Mar 5" formatting for a parsed segment date. */
export function dayShort(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Status pill label (review step). */
export const STATUS_LABEL: Record<SegmentMatchStatus, string> = {
  new: "New",
  enrichment: "Enrich",
  conflict: "Conflict",
  duplicate: "Duplicate",
};

/** Status pill token family (review step) — keys into `--status-{token}-*`. */
export const STATUS_TOKEN: Record<SegmentMatchStatus, string> = {
  new: "ok",
  enrichment: "info",
  conflict: "warn",
  duplicate: "muted",
};
