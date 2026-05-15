"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  useApplyParsedSegments,
  useCreateTrip,
  useDismissEmail,
  useGmailLabels,
  usePendingEmails,
  useStreamingScanEmails,
  useTrips,
} from "@itinly/api-client";
import type {
  EmailScanResult,
  NewTripProposal,
  SegmentMatchStatus,
} from "@itinly/shared";
import { resolveProposalSentinels } from "@/lib/scan-proposal-apply";
import {
  buildReviewItems,
  dayShort,
  fmtTripRange,
  STATUS_LABEL,
  STATUS_TOKEN,
  type ApplyAction,
  type ReviewItem,
} from "@/lib/email-scan-review";
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
import {
  useActiveEmailProvider,
  useConnectedEmailProviders,
  emailLabelNoun,
  emailProviderLabel,
  type EmailProvider,
} from "@/lib/use-active-provider";
import { useDemoMode } from "@/lib/demo";
import {
  buildGmailLabelTree,
  indentedLabel,
} from "@/lib/gmail-labels";
import { isGmailLinkConfigured, startGmailLink } from "@/lib/oauth";
import { NotConnectedNotice } from "@/components/not-connected-notice";
import { cn } from "@/lib/utils";
import { toastMutationError } from "@/lib/api-error";
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
  | "not-connected"
  | "config"
  | "scanning"
  | "review"
  | "done";

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
  const isDemo = useDemoMode();
  // Resolve the active email provider across both auth paths:
  //   - Supabase user with an `email` connection → google or microsoft
  //   - Legacy Gmail-linked user → google
  //   - Demo mode → google
  //   - Nothing linked → null → render the "not-connected" step
  //
  // Pairs with the 403 GMAIL_SCOPE_REQUIRED + 401 EMAIL_NOT_CONNECTED
  // bounces in `handleStartScan` for tokens that were revoked or
  // rejected after first link.
  // ScanBody only renders when the parent sheet is open, so the hook
  // is always enabled in this context.
  const { provider: autoProvider, isLoading: providerLoading } =
    useActiveEmailProvider(true);
  const { providers: connectedEmailProviders } = useConnectedEmailProviders(true);
  const emailGranted = isDemo || autoProvider !== null;

  // Per-user mailbox picker — same shape as the desktop dialog. Stored
  // choice survives session boundaries; falls back to the auto-pick if
  // the provider is no longer connected.
  const [selectedProvider, setSelectedProviderState] =
    useState<EmailProvider | null>(() => {
      if (typeof window === "undefined") return null;
      const raw = window.localStorage.getItem("itinly:email-provider");
      return raw === "google" || raw === "microsoft" ? raw : null;
    });
  const effectiveProvider: EmailProvider | null =
    selectedProvider && connectedEmailProviders.includes(selectedProvider)
      ? selectedProvider
      : autoProvider;
  const setSelectedProvider = (next: EmailProvider) => {
    setSelectedProviderState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("itinly:email-provider", next);
    }
  };
  const activeEmailProvider = effectiveProvider;
  const showProviderPicker = connectedEmailProviders.length > 1;

  const { data: trips = [], error: tripsError } = useTrips();
  // Don't fetch labels/folders or pending results until we've
  // confirmed the link — fetches would 401/403 and pollute the
  // console. The desktop dialog gates the same way.
  const {
    data: labels = [],
    error: labelsError,
    isLoading: labelsLoading,
  } = useGmailLabels(emailGranted, effectiveProvider ?? undefined);
  // Pending-results restoration: if a previous scan left results that
  // weren't applied (e.g. user closed the sheet mid-review), surface
  // them on next open instead of forcing a re-scan. The hook is gated
  // on `emailGranted` so unlinked users skip the call.
  const {
    data: pendingData,
    error: pendingError,
    isLoading: pendingLoading,
  } = usePendingEmails(emailGranted);
  const scanEmails = useStreamingScanEmails();
  // Live progress while the SSE scan stream is in flight. See the
  // desktop dialog for the equivalent state — kept identical so both
  // surfaces show the same "Found N → Parsing X of M" cadence.
  const [scanProgress, setScanProgress] = useState<{
    foundTotal: number | null;
    parsed: number;
    total: number;
    current: { subject: string; from: string } | null;
  }>({ foundTotal: null, parsed: 0, total: 0, current: null });
  const applySegments = useApplyParsedSegments();
  const dismissEmail = useDismissEmail();
  const createTrip = useCreateTrip();

  // Initial step:
  //  - we know the user has nothing linked → not-connected (Supabase
  //    users with no provider connection AND no legacy Gmail link)
  //  - we know they're still loading → verifying
  //  - we know they're linked → verifying (queries refute below if stale)
  // The transition effect promotes to config / review (or bounces to
  // not-connected / needs-scope on 401/403) once the queries settle.
  const initialStep: Step = providerLoading
    ? "verifying"
    : emailGranted
      ? "verifying"
      : "not-connected";
  const [step, setStep] = useState<Step>(initialStep);
  const [labelId, setLabelId] = useState<string | null>(null);
  const [includeSublabels, setIncludeSublabels] = useState(false);
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
  /**
   * Ref-backed guard against double-tap on Apply. State alone isn't
   * enough — React doesn't flush between two synchronous click
   * events, so the second handler reads the stale `false` from the
   * closure and runs a duplicate `useCreateTrip` → second trip
   * created with the same segments applied. The ref is updated
   * synchronously so the second tap bails out.
   *
   * `isApplying` (state, mirror of the ref) drives the button's
   * disabled + spinner so the visual feedback covers both the trip-
   * creation phase and the apply-segments phase. (`applySegments.isPending`
   * alone misses the create-trip phase entirely.)
   */
  const applyingRef = useRef(false);
  const [isApplying, setIsApplying] = useState(false);

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
    const isNotConnected = (e: unknown): boolean => {
      if (!(e instanceof ApiError)) return false;
      const body = e.body as { code?: string } | null;
      return e.status === 401 && body?.code === "EMAIL_NOT_CONNECTED";
    };
    const isLegacyAuthError = (e: unknown): boolean => {
      if (!(e instanceof ApiError)) return false;
      const body = e.body as { code?: string } | null;
      // GMAIL_SCOPE_REQUIRED is the legacy "Gmail link revoked"
      // signal; 401/403 without our new EMAIL_NOT_CONNECTED code is
      // some other auth failure that the legacy "Connect Gmail"
      // flow can also fix.
      return (
        e.status === 403 ||
        (e.status === 401 && body?.code !== "EMAIL_NOT_CONNECTED") ||
        body?.code === "GMAIL_SCOPE_REQUIRED"
      );
    };
    // Auth error wins immediately — route to the right "Connect"
    // surface. The new code path (Supabase users with no link) goes
    // to the provider-agnostic not-connected step; everything else
    // keeps using the existing Gmail-only needs-scope step.
    if (isNotConnected(labelsError) || isNotConnected(pendingError)) {
      setStep("not-connected");
      return;
    }
    if (isLegacyAuthError(labelsError) || isLegacyAuthError(pendingError)) {
      setStep("needs-scope");
      return;
    }
    // Wait for both queries to settle (either succeed or fail with a
    // non-auth error). Without this, we'd promote to config the
    // microsecond labels comes back even if pending is still in flight.
    if (labelsLoading || pendingLoading) return;
    const pending = pendingData?.results;
    if (pending && pending.length > 0) {
      const built = buildReviewItems(pending);
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
    if (
      step === "verifying" ||
      step === "needs-scope" ||
      step === "not-connected"
    )
      return;
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
    setScanProgress({ foundTotal: null, parsed: 0, total: 0, current: null });
    try {
      const response = await scanEmails.mutateAsync({
        input: {
          labelFilter: labelId || undefined,
          // Only meaningful with a picked label — on "All mail" the
          // scan already covers everything by definition.
          includeSublabels: labelId && includeSublabels ? true : undefined,
          forceRescan: forceRescan || undefined,
          provider: effectiveProvider ?? undefined,
        },
        onFound: (total) =>
          setScanProgress((p) => ({ ...p, foundTotal: total })),
        onPlan: (newCount) =>
          setScanProgress((p) => ({ ...p, total: newCount })),
        onProgress: (parsed, total, current) =>
          setScanProgress((p) => ({
            ...p,
            parsed,
            total,
            current: current ?? p.current,
          })),
      });
      const built = buildReviewItems(response.results);
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
          const built = buildReviewItems(partial);
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

      toastMutationError("scan emails")(err);
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
    // Synchronous guard: a second tap that fires before React has
    // re-rendered with the disabled button still calls handleApply.
    // The ref intercepts those duplicate runs (state can't, since
    // closures from earlier renders see the old value).
    if (applyingRef.current) return;
    applyingRef.current = true;
    setIsApplying(true);
    const toApply = items.filter(
      (it) => it.selected && it.action !== "skip" && it.tripId,
    );
    try {
      // Step 1: create any proposed new trips that the user kept
      // selected. We do this BEFORE the apply call so each segment
      // can be sent with a real trip id. Shared with the desktop
      // dialog via `resolveProposalSentinels` so both surfaces handle
      // the subtle date-range expansion identically.
      const sentinelToRealId = await resolveProposalSentinels(
        toApply.map((it) => ({
          tripId: it.tripId,
          startDate: it.segment.date,
          endDate: it.segment.endDate,
        })),
        proposals,
        createTrip.mutateAsync,
      );

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
      toastMutationError("apply segments")(err);
    } finally {
      // Clear the guard whether we landed on Done or stayed on
      // review after an error — either way the user might want to
      // tap Apply again (e.g. retry after a transient failure).
      applyingRef.current = false;
      setIsApplying(false);
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
            Checking {emailProviderLabel(activeEmailProvider)} connection…
          </p>
        </div>
      </>
    );
  }

  if (step === "not-connected") {
    return (
      <>
        <Header title="Scan emails" onClose={onClose} />
        <div className="flex flex-1 flex-col px-4 py-6">
          <NotConnectedNotice capability="email" variant="mobile" />
        </div>
      </>
    );
  }

  if (step === "needs-scope") {
    // If the user has a non-Gmail email connection (Outlook), or any
    // mix of connected providers, route them to Settings via the
    // provider-agnostic NotConnectedNotice — the legacy "Connect
    // Gmail" hardcoded CTA was wrong UX for a Microsoft-primary user
    // whose Outlook capability row is missing a refresh token. Only
    // fall through to the legacy Gmail CTA when the user has zero
    // active email connections (pre-migration accounts that still
    // need to grant Gmail through the legacy OAuth client).
    const hasOutlookConnection = connectedEmailProviders.includes("microsoft");
    if (hasOutlookConnection || connectedEmailProviders.length > 0) {
      return (
        <>
          <Header title="Reconnect email" onClose={onClose} />
          <div className="flex flex-1 flex-col gap-3 px-5 py-6">
            <NotConnectedNotice capability="email" variant="mobile" />
          </div>
          <Footer>
            <button
              type="button"
              onClick={onClose}
              className="h-11 flex-1 rounded-full border bg-background text-sm font-medium"
            >
              Close
            </button>
          </Footer>
        </>
      );
    }

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
    const showProgressBar =
      scanProgress.foundTotal !== null && scanProgress.total > 0;
    return (
      <>
        <Header title="Scanning email" onClose={onClose} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          {scanProgress.foundTotal === null ? (
            <>
              <p className="text-sm font-medium">
                Searching {emailProviderLabel(activeEmailProvider)}…
              </p>
              <p className="max-w-[280px] text-xs text-muted-foreground">
                We&apos;re looking through travel emails. This usually
                takes a few seconds.
              </p>
            </>
          ) : scanProgress.total === 0 ? (
            <>
              <p className="text-sm font-medium">
                Found {scanProgress.foundTotal} email
                {scanProgress.foundTotal === 1 ? "" : "s"}
              </p>
              <p className="max-w-[280px] text-xs text-muted-foreground">
                Checking which still need parsing…
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">
                Parsing{" "}
                {Math.min(scanProgress.parsed + 1, scanProgress.total)} of{" "}
                {scanProgress.total}
              </p>
              <p className="max-w-[280px] truncate text-xs text-muted-foreground">
                {scanProgress.current?.subject ?? "Reading with Claude…"}
              </p>
            </>
          )}
          {showProgressBar && (
            <div
              className="mt-2 h-1.5 w-44 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={scanProgress.parsed}
              aria-valuemin={0}
              aria-valuemax={scanProgress.total}
            >
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{
                  width: `${Math.round(
                    (scanProgress.parsed / Math.max(scanProgress.total, 1)) *
                      100,
                  )}%`,
                }}
              />
            </div>
          )}
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
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b bg-background px-3 py-2">
          {activeEmailProvider && (
            <span
              className="inline-flex items-center rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
              title={`Scanned from ${emailProviderLabel(activeEmailProvider)}`}
            >
              {emailProviderLabel(activeEmailProvider)}
            </span>
          )}
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
                <div className="space-y-1">
                  <p>
                    Couldn&apos;t load {emailLabelNoun(activeEmailProvider)}s
                    for {emailProviderLabel(activeEmailProvider)} — the scan
                    may still work, but suggestions below will be empty.
                  </p>
                  <p className="opacity-75">{describeError(labelsError)}</p>
                </div>
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
            disabled={applyableCount === 0 || isApplying}
            className="inline-flex h-11 flex-[2] items-center justify-center gap-1.5 rounded-full bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {isApplying && (
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
          We&apos;ll look through your {emailProviderLabel(activeEmailProvider)}{" "}
          for travel confirmations and parse each one with Claude. Pick a{" "}
          {emailLabelNoun(activeEmailProvider)} below to narrow the search.
        </p>

        {showProviderPicker && (
          <div className="mt-4 space-y-1.5">
            <p className="text-kicker font-medium text-muted-foreground">
              Mailbox
            </p>
            <div
              className="flex gap-2"
              role="radiogroup"
              aria-label="Mailbox account"
            >
              {connectedEmailProviders.map((p) => {
                const active = effectiveProvider === p;
                return (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setSelectedProvider(p)}
                    className={cn(
                      "h-10 flex-1 rounded-full border text-sm font-medium transition-colors",
                      active
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-background text-foreground active:bg-muted/40",
                    )}
                  >
                    {emailProviderLabel(p)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-4 space-y-1.5">
          <label
            htmlFor="m-scan-label"
            className="text-kicker font-medium text-muted-foreground"
          >
            {`${emailProviderLabel(activeEmailProvider)} ${emailLabelNoun(activeEmailProvider)}`}
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
            <option value="">All mail (no {emailLabelNoun(activeEmailProvider)} filter)</option>
            {buildGmailLabelTree(labels).map((node) => (
              <option key={node.label.id} value={node.label.id}>
                {indentedLabel(node)}
              </option>
            ))}
          </select>
        </div>

        {/*
          "Include sub-folders / sub-labels" widens the scan to
          descendants of the picked label/folder. Only meaningful when
          a specific label is picked — "All mail" already covers
          everything. Kept in the layout (greyed) when no label is
          picked so the row doesn't jump as the user toggles the
          select.
        */}
        <label
          className={cn(
            "mt-4 flex items-start gap-3 rounded-xl border bg-card p-3",
            !labelId && "opacity-50",
          )}
        >
          <input
            type="checkbox"
            checked={labelId ? includeSublabels : false}
            onChange={(e) => setIncludeSublabels(e.target.checked)}
            disabled={!labelId}
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              Include sub{emailLabelNoun(activeEmailProvider)}s
            </p>
            <p className="text-xs text-muted-foreground">
              Also scan {emailLabelNoun(activeEmailProvider)}s nested under
              the one above (e.g.{" "}
              <span className="font-mono text-[10px]">Travel/Hotels</span> when{" "}
              <span className="font-mono text-[10px]">Travel</span> is picked).
            </p>
          </div>
        </label>

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
  onToggleSelected,
  onCycleAction,
  onChangeTrip,
}: {
  item: ReviewItem;
  trips: { id: string; title: string; startDate: string; endDate: string }[];
  /**
   * Proposed-new-trip clusters surfaced as picker options. Each one
   * has a sentinel `id` (`__new__N`) that the apply handler swaps for
   * a real trip id after `useCreateTrip` resolves. Empty when every
   * parsed segment auto-matched an existing trip.
   */
  proposals: NewTripProposal[];
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
