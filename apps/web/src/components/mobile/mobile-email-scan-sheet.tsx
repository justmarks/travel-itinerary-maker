"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  useApplyParsedSegments,
  useCreateTrip,
  useDismissEmail,
  useGmailLabels,
  usePendingEmails,
  useScanEmails,
  useTrips,
} from "@travel-app/api-client";
import type {
  EmailScanResult,
  NewTripProposal,
  ParsedSegment,
  SegmentMatchStatus,
} from "@travel-app/shared";
import { NEW_TRIP_PREFIX, proposeNewTrips } from "@travel-app/shared";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Inbox,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { describeError } from "@/lib/api-error";
import { useAuth } from "@/lib/auth";
import { useDemoMode } from "@/lib/demo";
import {
  buildGmailLabelTree,
  indentedLabel,
} from "@/lib/gmail-labels";
import { isGmailLinkConfigured, startGmailLink } from "@/lib/oauth";
import { cn } from "@/lib/utils";
import { fmt12h, SEGMENT_CONFIG } from "./mobile-segment-config";
import { MobileBottomSheet } from "./mobile-bottom-sheet";

// ── Types ──────────────────────────────────────────────────

/**
 * Steps in the scan flow:
 * - `verifying`: short loading screen while we confirm the cached
 *   `hasGmailLink` is still good — fires labels + pending queries
 *   and transitions to config / review / needs-scope based on the
 *   results. Without this step, a stale cache from a previously-
 *   revoked Gmail link would briefly show config before the bounce.
 * - `needs-scope`: user hasn't linked Gmail (or the refresh token was
 *   revoked / rejected). Shown both on first open and after a 403
 *   `GMAIL_SCOPE_REQUIRED` mid-flight. CTA bounces to the Gmail
 *   OAuth client.
 * - `config`: pick a label + decide on re-parse.
 * - `scanning`: mutation in flight.
 * - `review`: parsed segments to triage.
 * - `done`: terminal state.
 */
type Step =
  | "verifying"
  | "needs-scope"
  | "config"
  | "scanning"
  | "review"
  | "done";

type ApplyAction = "create" | "merge" | "replace" | "skip";

interface ReviewItem {
  emailId: string;
  emailSubject: string;
  segment: ParsedSegment;
  /** Local UI state — selected to apply, with a chosen action + trip. */
  selected: boolean;
  action: ApplyAction;
  /**
   * Either a real existing trip id OR a new-trip-proposal sentinel
   * (`__new__N`). Sentinels are swapped for real ids in `handleApply`
   * after `useCreateTrip` resolves. Empty string means "unassigned —
   * Apply will refuse to send this segment."
   */
  tripId: string;
}

// ── Helpers ────────────────────────────────────────────────

const STATUS_LABEL: Record<SegmentMatchStatus, string> = {
  new: "New",
  enrichment: "Enrich",
  conflict: "Conflict",
  duplicate: "Duplicate",
};

const STATUS_TOKEN: Record<SegmentMatchStatus, string> = {
  new: "ok",
  enrichment: "info",
  conflict: "warn",
  duplicate: "muted",
};

function defaultActionFor(status: SegmentMatchStatus | undefined): ApplyAction {
  if (status === "duplicate") return "skip";
  if (status === "enrichment") return "merge";
  if (status === "conflict") return "merge";
  return "create";
}

/**
 * What to default `selected` to. Skip duplicates AND low-confidence
 * segments — the user can opt them in if they want, but a half-confident
 * parse silently overwriting their itinerary is the wrong default. This
 * matches desktop's `defaultSelected` rule.
 */
function defaultSelectedFor(seg: ParsedSegment): boolean {
  const status = seg.match?.status ?? "new";
  return status !== "duplicate" && seg.confidence !== "low";
}

function dayShort(date: string) {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Formats a trip's date range for the trip-picker dropdown:
 * `"Mar 5 – Mar 12"` (same year) or `"Dec 28 2026 – Jan 3 2027"` when
 * the range crosses calendar years. Compact enough to fit alongside
 * a trip title even on narrow phone widths.
 */
function fmtTripRange(start: string, end: string): string {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const sameYear = s.getFullYear() === e.getFullYear();
  const opts: Intl.DateTimeFormatOptions = sameYear
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" };
  const fmt = (d: Date) => d.toLocaleDateString("en-US", opts);
  return `${fmt(s)} – ${fmt(e)}`;
}

/**
 * Build the review-step state from a scan response. Returns both
 * `items` and the `proposals` derived from items that didn't match
 * an existing trip — each unassigned item is pre-bound to its
 * proposal's sentinel id so the picker shows "Create Maui April
 * 2026" as the default.
 *
 * `tripIdFilter` is set when the sheet was opened from a specific
 * trip's overflow menu — segments outside that trip are dropped so
 * the user only sees the relevant ones. In that mode, no proposals
 * are generated (the user is targeting a known trip).
 */
function buildReviewItems(
  results: readonly EmailScanResult[],
  tripIdFilter: string | undefined,
): { items: ReviewItem[]; proposals: NewTripProposal[] } {
  const items: ReviewItem[] = [];
  for (const res of results) {
    if (res.parseStatus !== "success") continue;
    for (const seg of res.parsedSegments) {
      // When opened from a specific trip, only surface segments
      // suggested for that trip — keeps the review focused.
      if (tripIdFilter && seg.suggestedTripId && seg.suggestedTripId !== tripIdFilter) {
        continue;
      }
      // Per-trip scans default unassigned items to the active trip;
      // account-level scans leave them empty here and we fill them in
      // below from the proposal clustering.
      const tripId = seg.suggestedTripId ?? tripIdFilter ?? "";
      const action = defaultActionFor(seg.match?.status);
      // Two reasons to start unselected: (a) duplicate / skip default,
      // (b) low-confidence parse — same rule desktop uses.
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

  // Per-trip scans never propose new trips — the user is targeting
  // a specific existing one, so unassigned segments either belong
  // there or get skipped.
  if (tripIdFilter) return { items, proposals: [] };

  // Cluster items that still have no trip into proposed new trips,
  // and bind each item to its proposal's sentinel id so the picker
  // shows "Create <name>" as that item's default selection.
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

// ── Component ──────────────────────────────────────────────

/**
 * Multi-step bottom sheet for the mobile email-scan flow:
 * config → scanning → review → done. Mirrors the desktop
 * `EmailScanDialog` + `EmailReportDialog` but tuned for thumbs.
 *
 * Open from two entry points:
 * - Per-trip: trip-detail overflow menu, with `tripId` set so the
 *   review step pre-filters to segments matched to this trip.
 * - Account-level: mobile user menu, no `tripId` — review shows all
 *   parsed segments and the user picks a trip per row.
 *
 * Out of scope (desktop has these; the mobile cut omits to fit):
 * - Inline "create new trip" from the review step. Mobile users can
 *   create the trip first via `MobileCreateTripSheet`, then re-scan.
 * - Email-report mailto: flow for reporting bad parses.
 * - Low-confidence / skipped collapsibles — all parsed segments
 *   render inline.
 */
export function MobileEmailScanSheet({
  tripId,
  open,
  onClose,
}: {
  /** When set, the review step pre-filters to segments matched here. */
  tripId?: string;
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <MobileBottomSheet open={open} onClose={onClose} ariaLabel="Scan emails">
      {open && <ScanBody tripId={tripId} onClose={onClose} />}
    </MobileBottomSheet>
  );
}

function ScanBody({
  tripId,
  onClose,
}: {
  tripId?: string;
  onClose: () => void;
}): React.JSX.Element {
  const { hasGmailLink } = useAuth();
  const isDemo = useDemoMode();
  // Demo mode bypasses real Google APIs via MockApiClient, so treat
  // every scope as granted there. For real users, gate the scan path
  // on the Gmail OAuth client being linked — same logic the desktop
  // EmailScanDialog uses. Pairs with the 403 GMAIL_SCOPE_REQUIRED
  // bounce in `handleStartScan` for tokens that were revoked or
  // rejected after first link.
  const gmailGranted = isDemo || hasGmailLink;

  const { data: trips = [], error: tripsError } = useTrips();
  // Don't fetch Gmail labels or pending results until we've confirmed
  // the link — fetches would 401/403 and pollute the console. The
  // desktop dialog gates the same way.
  const {
    data: labels = [],
    error: labelsError,
    isLoading: labelsLoading,
  } = useGmailLabels(gmailGranted);
  // Pending-results restoration: if a previous scan left results that
  // weren't applied (e.g. user closed the sheet mid-review), surface
  // them on next open instead of forcing a re-scan. The hook is gated
  // on `gmailGranted` so unlinked users skip the call.
  const {
    data: pendingData,
    error: pendingError,
    isLoading: pendingLoading,
  } = usePendingEmails(gmailGranted);
  const scanEmails = useScanEmails();
  const applySegments = useApplyParsedSegments();
  const dismissEmail = useDismissEmail();
  const createTrip = useCreateTrip();

  // Initial step: needs-scope when we know the user isn't linked,
  // otherwise verifying — a brief loading screen while the labels +
  // pending queries confirm the cached `hasGmailLink` is still good.
  // The transition effect below promotes to config / review (or
  // bounces to needs-scope on 401/403) once the queries settle.
  const [step, setStep] = useState<Step>(
    gmailGranted ? "verifying" : "needs-scope",
  );
  const [labelId, setLabelId] = useState<string | null>(null);
  const [forceRescan, setForceRescan] = useState(false);
  const [results, setResults] = useState<EmailScanResult[]>([]);
  const [items, setItems] = useState<ReviewItem[]>([]);
  /**
   * New-trip proposals for this scan. Populated by `buildReviewItems`
   * from the items that didn't auto-match an existing trip; each
   * proposal carries a sentinel id (`__new__N`) that's used as the
   * picker value until apply, when `useCreateTrip` resolves it to a
   * real trip id. Empty when the sheet was opened from a specific
   * trip (the user is targeting a known one).
   */
  const [proposals, setProposals] = useState<NewTripProposal[]>([]);
  const [appliedCount, setAppliedCount] = useState(0);
  // Tracks emails the user dismissed (deselected every segment, or
  // skipped them all) so the Done step can distinguish "did nothing"
  // from "skipped on purpose".
  const [dismissedCount, setDismissedCount] = useState(0);
  /**
   * Inline banner shown above the review list when a scan returned
   * partial results with a billing (402) or overload (503) error —
   * surfaces what the user can still do without forcing a retry.
   */
  const [partialError, setPartialError] = useState<string | null>(null);

  // When labels load, default to "Travel" if it exists (matches what
  // most people use for confirmations) — otherwise leave unfiltered.
  useEffect(() => {
    if (labelId !== null) return;
    const travel = labels.find((l) => l.name.toLowerCase() === "travel");
    if (travel) setLabelId(travel.id);
  }, [labels, labelId]);

  // Promote `verifying` → real step once the labels + pending queries
  // have settled. We need both because either one can reveal a stale
  // Gmail link (auth error) — once they're both confirmed-good (or one
  // returns useful data), we can safely show config or review. While
  // either is still loading we stay on the spinner so the user never
  // sees a config screen for a link the backend's about to reject.
  //
  // Restore pending results when the sheet promotes — if a previous
  // scan left results that weren't applied (e.g. user closed mid-
  // review), surface them on next open instead of forcing a re-scan.
  useEffect(() => {
    if (step !== "verifying") return;
    const isAuthError = (e: unknown): boolean => {
      if (!(e instanceof ApiError)) return false;
      const body = e.body as { code?: string } | null;
      return (
        e.status === 401 ||
        e.status === 403 ||
        body?.code === "GMAIL_SCOPE_REQUIRED"
      );
    };
    // Auth error wins immediately — bounce before showing anything.
    if (isAuthError(labelsError) || isAuthError(pendingError)) {
      setStep("needs-scope");
      return;
    }
    // Wait for both queries to settle (either succeed or fail with a
    // non-auth error). Without this, we'd promote to config the
    // microsecond labels comes back even if pending is still in flight.
    if (labelsLoading || pendingLoading) return;
    const pending = pendingData?.results;
    if (pending && pending.length > 0) {
      const built = buildReviewItems(pending, tripId);
      if (built.items.length > 0) {
        setResults(pending);
        setItems(built.items);
        setProposals(built.proposals);
        setStep("review");
        return;
      }
    }
    setStep("config");
  }, [
    step,
    labelsError,
    pendingError,
    labelsLoading,
    pendingLoading,
    pendingData,
    tripId,
  ]);

  // Mid-flight bounce: if a query starts failing AFTER we already
  // promoted past `verifying` (rare — usually a stale cache that
  // refetches and now errors), still bounce. Same predicate.
  useEffect(() => {
    if (step === "verifying" || step === "needs-scope") return;
    const isAuthError = (e: unknown): boolean => {
      if (!(e instanceof ApiError)) return false;
      const body = e.body as { code?: string } | null;
      return (
        e.status === 401 ||
        e.status === 403 ||
        body?.code === "GMAIL_SCOPE_REQUIRED"
      );
    };
    if (isAuthError(labelsError) || isAuthError(pendingError)) {
      setStep("needs-scope");
    }
  }, [step, labelsError, pendingError]);

  const handleStartScan = async () => {
    setStep("scanning");
    setPartialError(null);
    try {
      const response = await scanEmails.mutateAsync({
        labelFilter: labelId || undefined,
        forceRescan: forceRescan || undefined,
      });
      const built = buildReviewItems(response.results, tripId);
      setResults(response.results);
      setItems(built.items);
      setProposals(built.proposals);
      // Skip the review step entirely if nothing parsed — go straight
      // to a "done — no new emails" terminal state.
      setStep(built.items.length === 0 ? "done" : "review");
    } catch (err) {
      // The user's Gmail link was revoked at Google or the refresh
      // token was rejected — bounce back to the connect step so
      // they can re-link instead of seeing a generic error toast.
      // Mirrors the desktop dialog's mid-flight handling.
      if (err instanceof ApiError) {
        const body = err.body as
          | {
              code?: string;
              error?: string;
              emailsFound?: number;
              results?: EmailScanResult[];
            }
          | null;

        if (err.status === 403 && body?.code === "GMAIL_SCOPE_REQUIRED") {
          setStep("needs-scope");
          return;
        }

        // Partial-results path: the AI batch hit a billing (402) or
        // temporary overload (503) before finishing. Show what got
        // parsed plus an inline banner explaining what the user can
        // still do without retrying. Mirrors the desktop dialog.
        const isBilling = err.status === 402;
        const isOverloaded =
          err.status === 503 || body?.code === "ANTHROPIC_OVERLOADED";
        const partial = body?.results;
        if ((isBilling || isOverloaded) && partial && partial.length > 0) {
          const built = buildReviewItems(partial, tripId);
          setResults(partial);
          setItems(built.items);
          setProposals(built.proposals);
          setPartialError(
            body?.error ??
              (isOverloaded
                ? "The AI service is temporarily overloaded. The segments below were parsed before the rest of the batch failed — you can apply them and try again later for the rest."
                : "The AI service needs credits to finish parsing. The segments below got through; add credits at console.anthropic.com to retry the rest."),
          );
          setStep(built.items.length === 0 ? "done" : "review");
          return;
        }

        // No partial results — surface a specific message instead of
        // the generic "Request failed (402)" describeError emits.
        if (isBilling) {
          const found = body?.emailsFound
            ? ` (${body.emailsFound} emails found)`
            : "";
          toast.error("AI service needs credits", {
            description: `Found emails${found} but the AI service needs credits to parse them. Add credits at console.anthropic.com, then try again.`,
          });
          setStep("config");
          return;
        }
        if (isOverloaded) {
          toast.error("AI service overloaded", {
            description:
              "The AI service is temporarily busy. Please try scanning again in a few minutes.",
          });
          setStep("config");
          return;
        }
      }

      toast.error("Couldn't scan emails", { description: describeError(err) });
      setStep("config");
    }
  };

  const summary = useMemo(() => {
    const counts: Record<SegmentMatchStatus | "skipped", number> = {
      new: 0,
      enrichment: 0,
      conflict: 0,
      duplicate: 0,
      skipped: 0,
    };
    for (const it of items) {
      const status = it.segment.match?.status ?? "new";
      counts[status] += 1;
    }
    counts.skipped = results.filter((r) => r.parseStatus !== "success").length;
    return counts;
  }, [items, results]);

  const selectedCount = items.filter((it) => it.selected).length;
  // Nothing to apply against if (a) the trip-list fetch failed AND
  // there are no proposed new trips either, or (b) the user has no
  // existing trips AND no parsed segments to seed a proposal from.
  // The per-trip entry point side-steps this entirely — `tripId` is
  // always set there.
  const hasNoTripTargets =
    !tripId && trips.length === 0 && proposals.length === 0;
  // Eligible-to-apply count — items that are selected, action !== skip,
  // AND have a non-empty tripId. This is what handleApply actually
  // sends to the server, so the Apply button label + disabled state
  // should track it (not raw selectedCount).
  const applyableCount = items.filter(
    (it) => it.selected && it.action !== "skip" && it.tripId,
  ).length;

  const toggleSelected = (idx: number) => {
    setItems((prev) =>
      prev.map((it, i) =>
        i === idx ? { ...it, selected: !it.selected } : it,
      ),
    );
  };

  const setTripId = (idx: number, next: string) => {
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, tripId: next } : it)),
    );
  };

  const cycleAction = (idx: number) => {
    const order: ApplyAction[] = ["create", "merge", "replace", "skip"];
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const cur = order.indexOf(it.action);
        const next = order[(cur + 1) % order.length];
        return { ...it, action: next, selected: next !== "skip" };
      }),
    );
  };

  const handleApply = async () => {
    const toApply = items.filter(
      (it) => it.selected && it.action !== "skip" && it.tripId,
    );
    try {
      // Step 1: create any proposed new trips that the user kept
      // selected. We do this BEFORE the apply call so each segment
      // can be sent with a real trip id. Sequential because
      // `useCreateTrip` rejects overlapping trips for the same user
      // — running them in parallel would race the overlap check.
      const sentinelToRealId = new Map<string, string>();
      const usedSentinels = new Set(
        toApply
          .map((it) => it.tripId)
          .filter((id) => id.startsWith(NEW_TRIP_PREFIX)),
      );
      for (const sentinel of usedSentinels) {
        const proposal = proposals.find((p) => p.id === sentinel);
        if (!proposal) continue;
        // Expand the proposal's date range to cover all segments the
        // user assigned to it — they may have moved a segment into
        // this proposal whose date falls outside the auto-clustered
        // range. Apply would otherwise fail because the trip's days
        // wouldn't include the segment's date.
        const assigned = toApply.filter((it) => it.tripId === sentinel);
        const dates = assigned.flatMap((it) => [
          it.segment.date,
          it.segment.endDate ?? it.segment.date,
        ]);
        const startDate = dates.reduce(
          (a, b) => (a < b ? a : b),
          proposal.startDate,
        );
        const endDate = dates.reduce(
          (a, b) => (a > b ? a : b),
          proposal.endDate,
        );
        const created = await createTrip.mutateAsync({
          title: proposal.title,
          startDate,
          endDate,
        });
        sentinelToRealId.set(sentinel, created.id);
      }

      // Step 2: apply the segments with sentinel ids swapped for real
      // trip ids.
      let added = 0;
      if (toApply.length > 0) {
        const res = await applySegments.mutateAsync({
          segments: toApply.map((it) => {
            // Filter above guarantees `it.action !== "skip"`. The
            // server schema's `action` enum is just create / merge /
            // replace, so narrow back to that union here — TS can't
            // infer the narrowing from the .filter() predicate.
            const action = it.action as "create" | "merge" | "replace";
            const tripIdResolved =
              sentinelToRealId.get(it.tripId) ?? it.tripId;
            return {
              ...it.segment,
              tripId: tripIdResolved,
              emailId: it.emailId,
              action,
              // The schema only expects existingSegmentId for merge /
              // replace — sending it on `create` is harmless but noisy.
              // Match desktop's exact shape.
              existingSegmentId:
                action === "merge" || action === "replace"
                  ? it.segment.match?.existingSegmentId
                  : undefined,
            };
          }),
        });
        // Use the server's actual created + updated counts so the
        // "Added N" line matches reality (e.g. a merge increments
        // `updated`, not `created`). Desktop does the same.
        added = res.created.length + (res.updated?.length ?? 0);
      }
      // Auto-dismiss emails whose every segment was skipped/deselected
      // — matches desktop. Reduces re-scan noise. Errors here are
      // non-fatal (dismissals can be retried by re-scanning), but we
      // still attach an `onError` so failures don't surface as
      // unhandled-promise warnings in production logs. Counts so the
      // done screen can distinguish "added 0 because all skipped"
      // from "no new emails found at all".
      const appliedEmailIds = new Set(toApply.map((it) => it.emailId));
      const allEmailIds = new Set(results.map((r) => r.emailId));
      let dismissedCount = 0;
      for (const id of allEmailIds) {
        if (!appliedEmailIds.has(id)) {
          dismissedCount += 1;
          dismissEmail.mutate(id, {
            onError: (e) => {
              console.warn("[email-scan] failed to dismiss email", id, e);
            },
          });
        }
      }
      setAppliedCount(added);
      setDismissedCount(dismissedCount);
      setStep("done");
    } catch (err) {
      toast.error("Couldn't apply segments", {
        description: describeError(err),
      });
    }
  };

  // ── Render per step ──

  if (step === "verifying") {
    // Brief spinner while we confirm the cached `hasGmailLink` is
    // still good with the backend. Never shown for unlinked users
    // (initial step is `needs-scope` for them) — only for the cached-
    // linked path, where the alternative is a flash-of-config before
    // a stale-token bounce.
    return (
      <>
        <Header title="Scan emails" onClose={onClose} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
          <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Checking Gmail connection…
          </p>
        </div>
      </>
    );
  }

  if (step === "needs-scope") {
    const configured = isGmailLinkConfigured();
    return (
      <>
        <Header title="Connect Gmail" onClose={onClose} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
          {configured ? (
            <>
              <Mail className="h-8 w-8 text-muted-foreground" />
              <p className="text-base font-medium">Connect Gmail to scan</p>
              <p className="max-w-[280px] text-xs text-muted-foreground">
                Granting read-only Gmail access lets us find travel
                confirmations and turn them into trip segments. You can
                revoke this any time from your Google Account.
              </p>
            </>
          ) : (
            // Build is missing NEXT_PUBLIC_GOOGLE_CLIENT_ID_GMAIL.
            // Bail before the click handler so the user sees a
            // meaningful message instead of a silent no-op.
            <>
              <AlertCircle
                className="h-8 w-8"
                style={{ color: "var(--status-warn-fg)" }}
              />
              <p className="text-base font-medium">
                Gmail scanning isn&apos;t configured
              </p>
              <p className="max-w-[280px] text-xs text-muted-foreground">
                This build is missing the{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
                  NEXT_PUBLIC_GOOGLE_CLIENT_ID_GMAIL
                </code>{" "}
                env var, so the Gmail OAuth flow can&apos;t start.
              </p>
            </>
          )}
        </div>
        <Footer>
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-full border bg-background text-sm font-medium"
          >
            {configured ? "Not now" : "Close"}
          </button>
          {configured && (
            <button
              type="button"
              onClick={() => {
                // Send the user back to the same page they were on so
                // re-opening the sheet after consent feels seamless.
                // Gmail consent runs against a separate OAuth client
                // (kept off the primary so the primary stays off
                // CASA), so this is a fresh consent screen — not an
                // incremental scope grant on the primary client.
                const returnTo =
                  window.location.pathname + window.location.search;
                startGmailLink(returnTo);
              }}
              className="inline-flex h-11 flex-[2] items-center justify-center gap-1.5 rounded-full bg-primary text-sm font-semibold text-primary-foreground"
            >
              <Mail className="h-4 w-4" />
              Connect Gmail
            </button>
          )}
        </Footer>
      </>
    );
  }

  if (step === "scanning") {
    return (
      <>
        <Header title="Scanning email" onClose={onClose} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm font-medium">Searching Gmail…</p>
          <p className="max-w-[280px] text-xs text-muted-foreground">
            We&apos;re looking through travel emails and parsing each
            with Claude. This usually takes a few seconds.
          </p>
        </div>
      </>
    );
  }

  if (step === "done") {
    return (
      <>
        <Header title="Done" onClose={onClose} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
          {appliedCount > 0 ? (
            <>
              <CheckCircle2
                className="h-8 w-8"
                style={{ color: "var(--status-ok-fg)" }}
              />
              <p className="text-sm font-medium">
                Added {appliedCount} segment{appliedCount === 1 ? "" : "s"}
              </p>
              <p className="max-w-[280px] text-xs text-muted-foreground">
                Look for the yellow{" "}
                <span
                  className="inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium"
                  style={{
                    backgroundColor: "var(--status-warn-bg)",
                    color: "var(--status-warn-fg)",
                    borderColor: "var(--status-warn-rail)",
                  }}
                >
                  Review
                </span>{" "}
                badge on each one. Tap to confirm.
              </p>
            </>
          ) : dismissedCount > 0 ? (
            // User intentionally skipped everything — distinguish from
            // "scan returned nothing" so the screen isn't misleading.
            <>
              <Inbox className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">
                Dismissed {dismissedCount} email
                {dismissedCount === 1 ? "" : "s"}
              </p>
              <p className="max-w-[280px] text-xs text-muted-foreground">
                Nothing was added. The dismissed emails won&apos;t show
                up again on future scans.
              </p>
            </>
          ) : (
            <>
              <Inbox className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">No new emails to add</p>
              <p className="max-w-[280px] text-xs text-muted-foreground">
                Either nothing matched, or everything was already
                processed. Try the &quot;Re-parse&quot; toggle if you
                expected results.
              </p>
            </>
          )}
        </div>
        <Footer>
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-full bg-primary text-sm font-semibold text-primary-foreground"
          >
            Done
          </button>
        </Footer>
      </>
    );
  }

  if (step === "review") {
    return (
      <>
        <Header
          title={`Review (${items.length})`}
          subtitle={`${selectedCount} selected`}
          onClose={onClose}
        />
        <div className="flex shrink-0 flex-wrap gap-1.5 border-b bg-background px-3 py-2">
          {(["new", "enrichment", "conflict", "duplicate"] as const).map(
            (k) =>
              summary[k] > 0 ? (
                <SummaryChip
                  key={k}
                  label={STATUS_LABEL[k]}
                  count={summary[k]}
                  token={STATUS_TOKEN[k]}
                />
              ) : null,
          )}
          {summary.skipped > 0 && (
            <SummaryChip
              label="Skipped"
              count={summary.skipped}
              token="muted"
            />
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {hasNoTripTargets && (
            // Account-level scan with zero trips (or trips fetch
            // failed). Apply will silently no-op without this hint
            // because every item's tripId is empty — surface why.
            <div
              className="mb-2 flex items-start gap-2 rounded-lg border p-2.5 text-xs"
              style={{
                backgroundColor: "var(--status-info-bg)",
                color: "var(--status-info-fg)",
                borderColor: "var(--status-info-rail)",
              }}
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                {tripsError
                  ? "Couldn't load your trips, so the parsed segments below can't be applied. Close and re-open this sheet, or check your connection."
                  : "You don't have any trips yet. Create a trip first, then re-open this sheet to apply the parsed segments to it."}
              </p>
            </div>
          )}
          {partialError && (
            <div
              className="mb-2 flex items-start gap-2 rounded-lg border p-2.5 text-xs"
              style={{
                backgroundColor: "var(--status-warn-bg)",
                color: "var(--status-warn-fg)",
                borderColor: "var(--status-warn-rail)",
              }}
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{partialError}</p>
            </div>
          )}
          {labelsError &&
            // Auth errors are handled by the bounce-to-needs-scope
            // effect above; this banner only surfaces for non-auth
            // failures (network, server) where the user is still on
            // the review screen but their label suggestions are
            // missing.
            !(
              labelsError instanceof ApiError &&
              (labelsError.status === 401 || labelsError.status === 403)
            ) && (
              <div
                className="mb-2 flex items-start gap-2 rounded-lg border p-2.5 text-xs"
                style={{
                  backgroundColor: "var(--status-warn-bg)",
                  color: "var(--status-warn-fg)",
                  borderColor: "var(--status-warn-rail)",
                }}
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Couldn&apos;t load Gmail labels — the scan may still
                  work, but suggestions below will be empty.
                </p>
              </div>
            )}
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <Inbox className="h-7 w-7 text-muted-foreground" />
              <p className="text-sm font-medium">No matching segments</p>
              <p className="max-w-[260px] text-xs text-muted-foreground">
                The scan didn&apos;t find anything that matched this
                trip&apos;s dates.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((item, idx) => (
                <ReviewCard
                  key={`${item.emailId}-${idx}`}
                  item={item}
                  trips={trips.map((t) => ({
                    id: t.id,
                    title: t.title,
                    startDate: t.startDate,
                    endDate: t.endDate,
                  }))}
                  proposals={proposals}
                  showTripPicker={!tripId}
                  onToggleSelected={() => toggleSelected(idx)}
                  onCycleAction={() => cycleAction(idx)}
                  onChangeTrip={(next) => setTripId(idx, next)}
                />
              ))}
            </ul>
          )}
        </div>
        <Footer>
          <button
            type="button"
            onClick={() => {
              // "Scan more" returns the user to the config step so
              // they can change the label / re-parse toggle and run
              // another pass without closing the sheet.
              setItems([]);
              setResults([]);
              setPartialError(null);
              setStep("config");
            }}
            className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full border bg-background text-sm font-medium"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Scan more
          </button>
          <button
            type="button"
            onClick={handleApply}
            // Disable when nothing eligible to send (selected + non-skip
            // + has trip target) — `applyableCount` reflects the same
            // filter `handleApply` uses to build the request, so the
            // button can't be tapped into a no-op call.
            disabled={applyableCount === 0 || applySegments.isPending}
            className="inline-flex h-11 flex-[2] items-center justify-center gap-1.5 rounded-full bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {applySegments.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Apply {applyableCount > 0 ? applyableCount : ""}
          </button>
        </Footer>
      </>
    );
  }

  // Default: config step.
  return (
    <>
      <Header title="Scan emails" onClose={onClose} />
      <div className="flex-1 overflow-y-auto px-5 py-3">
        <p className="text-sm text-muted-foreground">
          We&apos;ll look through your Gmail for travel confirmations and
          parse each one with Claude. Pick a label below to narrow the
          search.
        </p>

        <div className="mt-4 space-y-1.5">
          <label
            htmlFor="m-scan-label"
            className="text-kicker font-medium text-muted-foreground"
          >
            Gmail label
          </label>
          {/* Native <select> so Android / iOS use their platform pickers
              — the same call we made for the segment-type select. The
              option list is a depth-tagged tree (parents above children,
              non-breaking-space indent) so nested labels like
              `Travel/Hotels` read as Hotels nested under Travel rather
              than the full path repeated everywhere. */}
          <select
            id="m-scan-label"
            value={labelId ?? ""}
            onChange={(e) => setLabelId(e.target.value || null)}
            className={cn(
              "h-11 w-full appearance-none rounded-xl border border-input bg-background px-3 py-2 pr-9 text-sm shadow-xs",
              "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
              "bg-[length:16px] bg-[right_0.75rem_center] bg-no-repeat",
              "bg-[url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>\")]",
            )}
          >
            <option value="">All mail (no label filter)</option>
            {buildGmailLabelTree(labels).map((node) => (
              <option key={node.label.id} value={node.label.id}>
                {indentedLabel(node)}
              </option>
            ))}
          </select>
        </div>

        <label className="mt-4 flex items-center gap-3 rounded-xl border bg-card p-3">
          <input
            type="checkbox"
            checked={forceRescan}
            onChange={(e) => setForceRescan(e.target.checked)}
            className="h-4 w-4"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Re-parse processed emails</p>
            <p className="text-xs text-muted-foreground">
              Re-scans emails that previously failed or were skipped.
              Skips ones already added to a trip.
            </p>
          </div>
        </label>
      </div>
      <Footer>
        <button
          type="button"
          onClick={onClose}
          className="h-11 flex-1 rounded-full border bg-background text-sm font-medium"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleStartScan}
          disabled={scanEmails.isPending}
          className="inline-flex h-11 flex-[2] items-center justify-center gap-1.5 rounded-full bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {scanEmails.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          Start scan
        </button>
      </Footer>
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────

function Header({
  title,
  subtitle,
  onClose,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-1">
      <div className="min-w-0 flex-1">
        <p className="text-kicker font-semibold text-muted-foreground">
          <Mail className="mr-1 inline h-3 w-3" />
          Email scan
        </p>
        <h2 className="mt-0.5 text-lg font-semibold leading-snug">{title}</h2>
        {subtitle && (
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}

function Footer({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-2 border-t bg-background px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
      {children}
    </div>
  );
}

function SummaryChip({
  label,
  count,
  token,
}: {
  label: string;
  count: number;
  token: string;
}): React.JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{
        backgroundColor: `var(--status-${token}-bg)`,
        color: `var(--status-${token}-fg)`,
        borderColor: `var(--status-${token}-rail)`,
      }}
    >
      <span className="tabular-nums">{count}</span>
      {label}
    </span>
  );
}

function ReviewCard({
  item,
  trips,
  proposals,
  showTripPicker,
  onToggleSelected,
  onCycleAction,
  onChangeTrip,
}: {
  item: ReviewItem;
  trips: { id: string; title: string; startDate: string; endDate: string }[];
  /**
   * Proposed-new-trip clusters surfaced as picker options. Each one
   * has a sentinel `id` (`__new__N`) that the apply handler swaps for
   * a real trip id after `useCreateTrip` resolves. Empty for per-trip
   * scans (the user is targeting a specific existing trip).
   */
  proposals: NewTripProposal[];
  showTripPicker: boolean;
  onToggleSelected: () => void;
  onCycleAction: () => void;
  onChangeTrip: (next: string) => void;
}): React.JSX.Element {
  const cfg = SEGMENT_CONFIG[item.segment.type] ?? SEGMENT_CONFIG.activity;
  const Icon = cfg.icon;
  const status = item.segment.match?.status ?? "new";
  const startTime = fmt12h(item.segment.startTime);

  const actionLabel: Record<ApplyAction, string> = {
    create: "Add",
    merge: "Merge",
    replace: "Replace",
    skip: "Skip",
  };

  return (
    <li
      className={cn(
        "flex flex-col gap-2 rounded-xl border bg-card p-3 transition-opacity",
        !item.selected && "opacity-60",
      )}
    >
      <div className="flex items-start gap-2">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          style={{ background: cfg.bg, color: cfg.fg }}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">
            {item.segment.title}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {dayShort(item.segment.date)}
            {startTime && ` · ${startTime}`}
            {item.segment.venueName && ` · ${item.segment.venueName}`}
          </p>
        </div>
        <span
          className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
          style={{
            backgroundColor: `var(--status-${STATUS_TOKEN[status]}-bg)`,
            color: `var(--status-${STATUS_TOKEN[status]}-fg)`,
            borderColor: `var(--status-${STATUS_TOKEN[status]}-rail)`,
          }}
        >
          {STATUS_LABEL[status]}
        </span>
      </div>

      {showTripPicker && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Trip</span>
          <select
            value={item.tripId}
            onChange={(e) => onChangeTrip(e.target.value)}
            className="flex-1 rounded-md border bg-background px-2 py-1 text-xs"
          >
            {trips.length === 0 && proposals.length === 0 && (
              <option value="">(no trips)</option>
            )}
            {/* Proposed new trips (rendered first as the more common
                target on a fresh scan with no auto-matches). The
                sentinel id is swapped for a real one in handleApply
                via `useCreateTrip`. */}
            {proposals.length > 0 && (
              <optgroup label="Create new trip">
                {proposals.map((p) => (
                  <option key={p.id} value={p.id}>
                    + {p.title} ({fmtTripRange(p.startDate, p.endDate)})
                  </option>
                ))}
              </optgroup>
            )}
            {trips.length > 0 && (
              <optgroup label="Existing trips">
                {trips.map((t) => (
                  <option key={t.id} value={t.id}>
                    {/* Suffix the date range so a phone-only user can
                        distinguish two trips with similar names — e.g.
                        "Tokyo Apr 2026" vs "Tokyo Sep 2026". */}
                    {t.title} ({fmtTripRange(t.startDate, t.endDate)})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCycleAction}
          aria-label={`Action: ${actionLabel[item.action]}. Tap to cycle.`}
          className="inline-flex h-8 items-center gap-1 rounded-full border bg-background px-2.5 text-[11px] font-medium"
        >
          {actionLabel[item.action]}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onToggleSelected}
          aria-pressed={item.selected}
          aria-label={item.selected ? "Deselect" : "Select"}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full border",
            item.selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background text-muted-foreground",
          )}
        >
          {item.selected && <Check className="h-4 w-4" />}
        </button>
      </div>
    </li>
  );
}
