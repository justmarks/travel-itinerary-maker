"use client";

import { useState, useCallback, useEffect } from "react";
import type {
  EmailScanResult,
  ParsedSegment,
  SegmentMatchStatus,
  ApplyAction,
  NewTripProposal,
} from "@itinly/shared";
import { proposeNewTrips } from "@itinly/shared";
import { resolveProposalSentinels } from "@/lib/scan-proposal-apply";
import {
  useStreamingScanEmails,
  useApplyParsedSegments,
  useDismissEmail,
  useGmailLabels,
  usePendingEmails,
  useTrips,
  useCreateTrip,
} from "@itinly/api-client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Mail,
  Loader2,
  CheckCircle2,
  XCircle,
  MinusCircle,
  AlertCircle,
  Check,
  Plus,
  ChevronDown,
  ChevronRight,
  Eye,
  Flag,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { ParseReportReason } from "@itinly/shared";
import { EmailReportDialog } from "@/components/email-report-dialog";
import {
  useActiveEmailProvider,
  useConnectedEmailProviders,
  emailLabelNoun,
  emailProviderLabel,
  type EmailProvider,
} from "@/lib/use-active-provider";
import { describeError, toastMutationError } from "@/lib/api-error";
import { useDemoMode } from "@/lib/demo";
import {
  buildGmailLabelTree,
  indentedLabel,
} from "@/lib/gmail-labels";
import { isGmailLinkConfigured, startGmailLink } from "@/lib/oauth";
import { NotConnectedNotice } from "@/components/not-connected-notice";

// Each badge maps to a `--status-*` token trio. Pulling the colors
// from the design system rather than hand-rolling Tailwind 50/700
// classes means any palette tweak in `globals.css` propagates.
type StatusTone = "ok" | "warn" | "danger" | "info" | "muted";

function statusBadgeStyle(tone: StatusTone): React.CSSProperties {
  return {
    backgroundColor: `var(--status-${tone}-bg)`,
    color: `var(--status-${tone}-fg)`,
    borderColor: `var(--status-${tone}-rail)`,
  };
}

const CONFIDENCE_TONE: Record<string, StatusTone> = {
  high:   "ok",
  medium: "warn",
  low:    "danger",
};

const MATCH_STATUS_TONE: Record<SegmentMatchStatus, StatusTone> = {
  new:        "info",
  enrichment: "info",
  conflict:   "warn",
  duplicate:  "muted",
};

const MATCH_STATUS_LABEL: Record<SegmentMatchStatus, string> = {
  new: "New",
  enrichment: "Adds details",
  conflict: "Conflict",
  duplicate: "Already in trip",
};

/** Default action to propose when loading a scan result for the user. */
function defaultActionFor(status: SegmentMatchStatus): ApplyAction {
  switch (status) {
    case "enrichment":
      return "merge";
    case "conflict":
      return "merge"; // safer default — user can switch to replace or create
    case "duplicate":
      return "create"; // irrelevant, deselected by default
    case "new":
    default:
      return "create";
  }
}

interface SegmentSelection extends ParsedSegment {
  emailId: string;
  selected: boolean;
  assignedTripId: string;
  action: ApplyAction;
  existingSegmentId?: string;
}

type ScanStep =
  | "loading"
  | "needs-scope"
  | "not-connected"
  | "config"
  | "scanning"
  | "results"
  | "applying"
  | "done"
  | "error";

export function EmailScanDialog({
  tripId,
  triggerLabel = "Scan emails",
  triggerVariant = "outline",
  triggerSize = "sm",
  defaultOpen = false,
}: {
  tripId?: string;
  triggerLabel?: string;
  triggerVariant?: "outline" | "default" | "ghost";
  triggerSize?: "sm" | "default" | "lg";
  /**
   * Render the dialog already open on mount. Used by
   * `EmailScanDialogFromQuery` so the AutoScanBanner's `?review=1`
   * deep-link pops the scan dialog straight into its review step
   * (driven by `usePendingEmails`).
   */
  defaultOpen?: boolean;
}): React.JSX.Element | null {
  const [open, setOpen] = useState(defaultOpen);

  // Treat `defaultOpen` as an imperative "open now" trigger when it
  // flips from false → true after mount. The previous behaviour
  // (`useState(defaultOpen)` only) seeded the initial state and then
  // ignored later prop changes — so `EmailScanDialogFromQuery`'s
  // `?review=1` deep-link worked on a fresh page load but silently
  // failed when the user clicked the AutoScanBanner from the same
  // page (Next's `<Link>` does a soft navigation; the dialog
  // component instance survives, so its `open` state is stuck at
  // its initial value).
  //
  // We don't gate this on `prev === false` — the parent scrubs the
  // `?review=1` query param immediately, so `defaultOpen` snaps back
  // to false on the next render. That means a subsequent click on
  // the same banner correctly transitions false → true again and
  // re-fires this effect.
  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);
  const [step, setStep] = useState<ScanStep>("loading");
  const [selectedLabel, setSelectedLabel] = useState<string>("");
  const [includeSublabels, setIncludeSublabels] = useState<boolean>(false);
  const [results, setResults] = useState<EmailScanResult[]>([]);
  const [selections, setSelections] = useState<SegmentSelection[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [appliedCount, setAppliedCount] = useState(0);
  const [showLowConfidence, setShowLowConfidence] = useState(false);
  const [forceRescan, setForceRescan] = useState(false);
  const [reportTarget, setReportTarget] = useState<{
    emailId: string;
    subject?: string;
    reason: ParseReportReason;
  } | null>(null);

  // Auto-clustered new-trip proposals (mirrors mobile). Each
  // unassigned segment is bound to a proposal sentinel id of the form
  // `__new__N` so the trip picker can show "Create Maui April 2026"
  // alongside existing trips. Sentinels are resolved into real trip
  // ids in `handleApply` via sequential `createTrip` mutations before
  // the segments are applied. The user can also pick an existing trip
  // from the dropdown, drop the proposal entirely.
  const [proposals, setProposals] = useState<NewTripProposal[]>([]);

  const isDemo = useDemoMode();
  // Resolve the active email provider across both auth paths:
  //   - Supabase user with an `email` connection → google or microsoft
  //   - Legacy Gmail-linked user → google
  //   - Demo mode → google
  //   - Nothing linked → null → render the "not-connected" step
  // The gate also drives the "Connect Gmail / Outlook" prompt below.
  const { provider: autoProvider } = useActiveEmailProvider(open);
  const { providers: connectedEmailProviders } = useConnectedEmailProviders(open);
  const emailGranted = isDemo || autoProvider !== null;

  // Per-user mailbox picker — defaults to the last choice from
  // localStorage if it's still a linked provider, else the resolver's
  // Microsoft-first auto-pick. Switching here re-keys the labels query
  // and threads `provider` into the scan request.
  const [selectedProvider, setSelectedProviderState] =
    useState<EmailProvider | null>(() => {
      if (typeof window === "undefined") return null;
      const raw = window.localStorage.getItem("itinly:email-provider");
      return raw === "google" || raw === "microsoft" ? raw : null;
    });
  // Fall back to the auto-pick if the stored choice is no longer
  // connected (e.g. user disconnected Outlook after last using it).
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

  const { data: labels, error: labelsError } = useGmailLabels(
    open && emailGranted,
    effectiveProvider ?? undefined,
  );
  const { data: pendingData, isLoading: pendingLoading } = usePendingEmails(
    open && emailGranted,
  );
  const { data: trips } = useTrips();
  const scanEmails = useStreamingScanEmails();
  // Live progress while the SSE stream is in flight. `total` is the
  // count of *new* (unprocessed) emails we'll actually run through
  // Claude — `foundTotal` is the raw mailbox count including those
  // we'll skip. Both are useful: foundTotal frames "we looked at N",
  // total frames "we're parsing M of those."
  const [scanProgress, setScanProgress] = useState<{
    foundTotal: number | null;
    parsed: number;
    total: number;
    current: { subject: string; from: string } | null;
  }>({ foundTotal: null, parsed: 0, total: 0, current: null });
  const applySegments = useApplyParsedSegments();
  const dismissEmail = useDismissEmail();
  const createTrip = useCreateTrip();

  const reset = useCallback(() => {
    setStep("loading");
    setResults([]);
    setSelections([]);
    setProposals([]);
    setErrorMessage("");
    setAppliedCount(0);
    setShowLowConfidence(false);
  }, []);

  // When dialog opens, check for pending results and pick the initial
  // step. Gate on `step === "loading"` so this only runs ONCE per
  // dialog session — without it, the apply mutation invalidates the
  // `pendingEmails` query, which retriggers this effect and slams the
  // user back to "config" right after the apply succeeds. The done
  // screen is supposed to persist until the user closes the dialog,
  // at which point `reset()` flips step back to "loading" and we
  // re-initialize fresh on the next open.
  useEffect(() => {
    if (!open) return;
    if (step !== "loading") return;

    // No email provider linked — show the provider-agnostic
    // not-connected notice pointing at /settings/account.
    if (!emailGranted) {
      setStep("not-connected");
      return;
    }

    if (pendingLoading) return;

    if (pendingData?.results && pendingData.results.length > 0) {
      // We have pending results — go straight to results view
      loadResultsIntoState(pendingData.results);
      setStep("results");
    } else {
      setStep("config");
    }
  }, [open, emailGranted, pendingLoading, pendingData, step]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Populate results + selections state from an array of EmailScanResult */
  const loadResultsIntoState = useCallback(
    (scanResults: EmailScanResult[]) => {
      setResults(scanResults);
      const sels: SegmentSelection[] = [];
      for (const result of scanResults) {
        for (const seg of result.parsedSegments) {
          const matchStatus: SegmentMatchStatus = seg.match?.status ?? "new";
          // Default selection: skip duplicates + low-confidence. User can opt in.
          const defaultSelected =
            matchStatus !== "duplicate" && seg.confidence !== "low";
          // Trust the server's suggestedTripId: a trip-scoped scan still
          // sends `tripId` to the backend, and the backend honors that
          // hint only when the segment date is inside that trip's
          // window. Segments outside the active trip's range come back
          // with `suggestedTripId` either pointing at the trip that
          // actually covers the date or undefined — those flow into
          // proposeNewTrips below for the "create a trip for it" UX,
          // just like an account-level scan from the trips homepage.
          sels.push({
            ...seg,
            emailId: result.emailId,
            selected: defaultSelected,
            assignedTripId: seg.suggestedTripId ?? "",
            action: defaultActionFor(matchStatus),
            existingSegmentId: seg.match?.existingSegmentId,
          });
        }
      }

      // Cluster items that still have no trip into proposed new trips
      // by date-gap. Each proposal carries a sentinel id of the form
      // `__new__N`; we bind those ids onto the unassigned selections
      // so the picker defaults to "Create <proposal title>".
      const unassigned = sels
        .map((s, idx) => ({ idx, seg: s }))
        .filter(({ seg }) => !seg.assignedTripId);
      const next = proposeNewTrips(
        unassigned.map(({ idx, seg }) => ({
          key: String(idx),
          segment: seg,
        })),
      );
      for (const proposal of next) {
        for (const key of proposal.segmentKeys) {
          const idx = parseInt(key, 10);
          if (Number.isNaN(idx)) continue;
          sels[idx].assignedTripId = proposal.id;
        }
      }
      setSelections(sels);
      setProposals(next);
    },
    [],
  );

  // True when a selected segment has no assigned trip AND isn't bound
  // to one of the auto-clustered proposals. With proposeNewTrips
  // pre-binding sentinels, the only way this is true is if the user
  // explicitly cleared the trip picker on a segment — used as the
  // "Apply is disabled" guard.
  const hasUnassignedSegments = selections.some((s) => s.selected && !s.assignedTripId);

  const handleScan = async () => {
    setStep("scanning");
    setErrorMessage("");
    setScanProgress({ foundTotal: null, parsed: 0, total: 0, current: null });

    try {
      const input: Record<string, unknown> = {};
      if (tripId) input.tripId = tripId;
      if (selectedLabel && selectedLabel !== "__all__") {
        input.labelFilter = selectedLabel;
        // Only meaningful with a picked label; on "All mail" the scan
        // already covers everything by definition.
        if (includeSublabels) input.includeSublabels = true;
      }
      if (forceRescan) input.forceRescan = true;
      if (effectiveProvider) input.provider = effectiveProvider;

      const res = await scanEmails.mutateAsync({
        input,
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

      if (!res.results || res.results.length === 0) {
        setResults([]);
        setSelections([]);
        setStep("results");
        return;
      }

      loadResultsIntoState(res.results);
      setStep("results");
    } catch (err) {
      const apiErr = err as { status?: number; body?: { code?: string; error?: string; emailsFound?: number; results?: EmailScanResult[] } };
      const status = apiErr.status;
      const body = apiErr.body;

      // If we got partial results with a billing or overloaded error, show them
      if (
        (status === 402 || status === 503) &&
        body?.results &&
        body.results.length > 0
      ) {
        loadResultsIntoState(body.results);
        setErrorMessage(
          body.error ||
            (status === 503
              ? "The AI service is temporarily overloaded. Please try scanning again in a few minutes. You can still process the segments that were already parsed."
              : "AI service needs credits. You can still process the segments that were already parsed."),
        );
        setStep("results");
        return;
      }

      if (status === 403 && body?.code === "GMAIL_SCOPE_REQUIRED") {
        // The user's Gmail link is gone (never linked, revoked at
        // Google, or refresh token rejected). Bounce to the same
        // connect step we use for first-time links — it'll re-run the
        // Gmail OAuth flow.
        setStep("needs-scope");
        return;
      } else if (status === 401 && body?.code === "EMAIL_NOT_CONNECTED") {
        // Phase 4b-2 returns this for Supabase-authed users with no
        // email connection. Different from GMAIL_SCOPE_REQUIRED
        // (which is the legacy Gmail-token-revoked case): the user
        // might want to connect Gmail OR Outlook, so route them to
        // /settings/account instead of forcing the Gmail flow.
        setStep("not-connected");
        return;
      } else if (status === 503 && body?.code === "ANTHROPIC_OVERLOADED") {
        setErrorMessage(
          "The AI service is temporarily overloaded. Please try scanning again in a few minutes.",
        );
      } else if (status === 402) {
        const found = body?.emailsFound ? ` (${body.emailsFound} emails found)` : "";
        setErrorMessage(
          `Found emails${found} but the AI service needs credits to parse them. Please add credits at console.anthropic.com, then try scanning again.`,
        );
      } else if (body?.error) {
        setErrorMessage(body.error);
      } else {
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to scan emails",
        );
      }
      setStep("error");
    }
  };

  const toggleSelection = (index: number) => {
    setSelections((prev) =>
      prev.map((s, i) => (i === index ? { ...s, selected: !s.selected } : s)),
    );
  };

  const setTripForSegment = (index: number, tid: string) => {
    setSelections((prev) =>
      prev.map((s, i) => (i === index ? { ...s, assignedTripId: tid } : s)),
    );
  };

  const setActionForSegment = (index: number, action: ApplyAction) => {
    setSelections((prev) =>
      prev.map((s, i) => (i === index ? { ...s, action } : s)),
    );
  };

  const handleApply = async () => {
    const toApply = selections.filter((s) => s.selected && s.assignedTripId);
    if (!toApply.length) return;

    setStep("applying");

    try {
      // Turn proposal sentinels (`__new__N`) into real trip ids by
      // creating each used proposal. Shared with the mobile sheet via
      // `resolveProposalSentinels` so both surfaces handle the subtle
      // date-range expansion identically.
      const sentinelToRealId = await resolveProposalSentinels(
        toApply.map((s) => ({
          tripId: s.assignedTripId,
          startDate: s.date,
          endDate: s.endDate,
        })),
        proposals,
        createTrip.mutateAsync,
      );

      const resolvedSegments = toApply.map((s) => ({
        type: s.type,
        title: s.title,
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        venueName: s.venueName,
        address: s.address,
        city: s.city,
        url: s.url,
        confirmationCode: s.confirmationCode,
        provider: s.provider,
        departureCity: s.departureCity,
        arrivalCity: s.arrivalCity,
        departureAirport: s.departureAirport,
        arrivalAirport: s.arrivalAirport,
        carrier: s.carrier,
        routeCode: s.routeCode,
        partySize: s.partySize,
        creditCardHold: s.creditCardHold,
        phone: s.phone,
        endDate: s.endDate,
        portsOfCall: s.portsOfCall,
        breakfastIncluded: s.breakfastIncluded,
        seatNumber: s.seatNumber,
        cabinClass: s.cabinClass,
        baggageInfo: s.baggageInfo,
        contactName: s.contactName,
        cost: s.cost,
        confidence: s.confidence,
        tripId: sentinelToRealId.get(s.assignedTripId) ?? s.assignedTripId,
        emailId: s.emailId,
        action: s.action,
        existingSegmentId:
          s.action === "merge" || s.action === "replace"
            ? s.existingSegmentId
            : undefined,
      }));

      const res = await applySegments.mutateAsync({ segments: resolvedSegments });
      setAppliedCount(res.created.length + (res.updated?.length ?? 0));

      // Dismiss emails that had segments but none were selected
      const appliedEmailIds = new Set(toApply.map((s) => s.emailId));
      const unappliedWithTravel = results.filter(
        (r) => r.parsedSegments.length > 0 && !appliedEmailIds.has(r.emailId),
      );
      // Only auto-dismiss emails where ALL their segments were deselected.
      // A failure here isn't blocking — the segments still applied, the
      // emails just stay in the pending list. Toast so the user knows
      // the dismiss didn't take, but don't bounce them out of the success
      // path.
      for (const r of unappliedWithTravel) {
        const anySelected = selections.some(
          (s) => s.emailId === r.emailId && s.selected,
        );
        if (!anySelected) {
          try {
            await dismissEmail.mutateAsync(r.emailId);
          } catch (err) {
            toastMutationError("dismiss email")(err);
          }
        }
      }

      setStep("done");
    } catch (err) {
      setErrorMessage(describeError(err));
      setStep("error");
    }
  };

  /** Dismiss all remaining pending emails (user doesn't want them) */
  const handleDismissAll = async () => {
    const pendingEmailIds = new Set(
      results
        .filter((r) => r.parsedSegments.length > 0)
        .map((r) => r.emailId),
    );
    let failed = 0;
    for (const eid of pendingEmailIds) {
      try {
        await dismissEmail.mutateAsync(eid);
      } catch {
        failed++;
      }
    }
    if (failed > 0) {
      toast.error(
        `Couldn't dismiss ${failed} email${failed === 1 ? "" : "s"}`,
        {
          description:
            "They'll stay in the pending list — try again from Scan emails.",
        },
      );
    }
    setOpen(false);
  };

  const selectedCount = selections.filter((s) => s.selected && s.assignedTripId).length;
  const travelResults = results.filter((r) => r.parsedSegments.length > 0);
  const noTravelResults = results.filter((r) => r.parsedSegments.length === 0);

  // Split selections into main (medium/high) and low-confidence
  const mainSelections = selections.filter((s) => s.confidence !== "low");
  const lowSelections = selections.filter((s) => s.confidence === "low");

  // Counts by match status (for summary bar)
  const matchCounts = selections.reduce(
    (acc, s) => {
      const status: SegmentMatchStatus = s.match?.status ?? "new";
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    },
    {} as Record<SegmentMatchStatus, number>,
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size={triggerSize}>
          <Mail className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">{triggerLabel}</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] flex-col overflow-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Scan emails
          </DialogTitle>
          <DialogDescription>
            Search your mailbox for travel confirmations and add them to your itinerary.
          </DialogDescription>
        </DialogHeader>

        {/* ── Step: Loading pending results ── */}
        {step === "loading" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-8">
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Checking for pending results...</p>
          </div>
        )}

        {/* ── Step: Needs Gmail scope ── */}
        {step === "needs-scope" && (
          <>
            {isGmailLinkConfigured() ? (
              <>
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
                  <Mail className="h-8 w-8 text-muted-foreground" />
                  <p className="text-base font-medium">Connect Gmail to scan</p>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    Granting read-only Gmail access lets us find travel
                    confirmations and turn them into trip segments. You can
                    revoke this any time from your Google Account.
                  </p>
                </div>
                <DialogFooter className="flex-row justify-end gap-2">
                  <Button variant="outline" onClick={() => setOpen(false)}>
                    Not now
                  </Button>
                  <Button
                    onClick={() => {
                      // Send the user back to the same page they were on so
                      // re-opening the dialog after consent feels seamless.
                      // Gmail consent runs against a separate OAuth client
                      // (kept off the primary so the primary stays off
                      // CASA), so this is a fresh consent screen — not an
                      // incremental scope grant on the primary client.
                      const returnTo =
                        window.location.pathname + window.location.search;
                      startGmailLink(returnTo);
                    }}
                  >
                    <Mail className="mr-2 h-4 w-4" />
                    Connect Gmail
                  </Button>
                </DialogFooter>
              </>
            ) : (
              // Build is missing NEXT_PUBLIC_GOOGLE_CLIENT_ID_GMAIL.
              // Bail out before the click handler so the user sees a
              // meaningful message instead of an unexplained no-op.
              <>
                <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
                  <AlertCircle
                    className="h-8 w-8"
                    style={{ color: "var(--status-warn-fg)" }}
                  />
                  <p className="text-base font-medium">
                    Gmail scanning isn&apos;t configured
                  </p>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    This build is missing the{" "}
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">
                      NEXT_PUBLIC_GOOGLE_CLIENT_ID_GMAIL
                    </code>{" "}
                    environment variable, so the Gmail OAuth flow can&apos;t
                    start. Set it in your hosting provider and redeploy to
                    enable email scanning.
                  </p>
                </div>
                <DialogFooter className="flex-row justify-end gap-2">
                  <Button variant="outline" onClick={() => setOpen(false)}>
                    Close
                  </Button>
                </DialogFooter>
              </>
            )}
          </>
        )}

        {/* ── Step: Not connected (Supabase user with no email link) ── */}
        {step === "not-connected" && (
          <>
            <div className="flex flex-1 flex-col gap-3 py-2">
              <NotConnectedNotice capability="email" />
            </div>
            <DialogFooter className="flex-row justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── Step: Config ── */}
        {step === "config" && (
          <>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
              {showProviderPicker && (
                <div className="space-y-2">
                  <p className="text-kicker text-muted-foreground">Mailbox</p>
                  <div
                    className="flex gap-2"
                    role="radiogroup"
                    aria-label="Mailbox account"
                  >
                    {connectedEmailProviders.map((p) => (
                      <Button
                        key={p}
                        type="button"
                        variant={effectiveProvider === p ? "default" : "outline"}
                        size="sm"
                        className="flex-1"
                        role="radio"
                        aria-checked={effectiveProvider === p}
                        onClick={() => setSelectedProvider(p)}
                      >
                        {emailProviderLabel(p)}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <label
                  htmlFor="email-scan-label"
                  className="text-sm font-medium"
                >
                  {`${emailProviderLabel(activeEmailProvider)} ${emailLabelNoun(activeEmailProvider)} (optional)`}
                </label>
                {/* Dropdown tree — labels are flat with `/`-delimited
                    paths, so we sort + tag-with-depth and render with
                    a non-breaking-space indent so nested labels read
                    as a tree. Replaces the freeform input + chip
                    strip; the chip strip lost its purpose once we
                    had a complete labels list anyway, and the input
                    encouraged typos. The unique value-by-id approach
                    matches what the mobile sheet does. */}
                <Select
                  value={selectedLabel || "__all__"}
                  onValueChange={(v) =>
                    setSelectedLabel(v === "__all__" ? "" : v)
                  }
                >
                  <SelectTrigger id="email-scan-label" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="__all__">
                      All mail (no {emailLabelNoun(activeEmailProvider)} filter)
                    </SelectItem>
                    {buildGmailLabelTree(labels ?? []).map((node) => (
                      <SelectItem key={node.label.id} value={node.label.name}>
                        {indentedLabel(node)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Leave on &ldquo;All mail&rdquo; to search every message for
                  travel keywords.
                </p>
                {/*
                  "Include sub-folders / sub-labels" widens the scan to
                  descendants of the picked label/folder. Only meaningful
                  when a specific label is picked — "All mail" already
                  covers everything. We keep the row visible but greyed
                  out when no label is picked, mirroring the
                  scheduled-scan editor so the layout is stable as the
                  user toggles between filters.
                */}
                <label
                  className={cn(
                    "mt-1 flex items-start gap-2 rounded-md border border-border bg-card p-2.5 text-xs cursor-pointer hover:bg-muted/50 transition-colors",
                    !selectedLabel && "opacity-50 cursor-default hover:bg-card",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selectedLabel ? includeSublabels : false}
                    onChange={(e) => setIncludeSublabels(e.target.checked)}
                    disabled={!selectedLabel}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                  />
                  <div className="space-y-0.5">
                    <p className="font-medium text-foreground">
                      Include sub{emailLabelNoun(activeEmailProvider)}s
                    </p>
                    <p className="text-muted-foreground">
                      Also scan {emailLabelNoun(activeEmailProvider)}s nested
                      under the one above (e.g.{" "}
                      <span className="font-mono text-[10px]">Travel/Hotels</span>{" "}
                      when{" "}
                      <span className="font-mono text-[10px]">Travel</span> is
                      picked).
                    </p>
                  </div>
                </label>
              </div>

              {labelsError && (
                <div
                  className="flex items-start gap-2 rounded-md border p-2.5 text-xs"
                  style={statusBadgeStyle("warn")}
                >
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div className="space-y-1">
                    <p>
                      Couldn't load {emailLabelNoun(activeEmailProvider)}s for{" "}
                      {emailProviderLabel(activeEmailProvider)}. Try
                      reconnecting in Settings if the problem persists.
                    </p>
                    <p className="opacity-75">
                      {describeError(labelsError)}
                    </p>
                  </div>
                </div>
              )}

              <label className="flex items-start gap-2 rounded-md border border-border p-2.5 text-xs cursor-pointer hover:bg-muted/50 transition-colors">
                <input
                  type="checkbox"
                  checked={forceRescan}
                  onChange={(e) => setForceRescan(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer"
                />
                <div className="space-y-0.5">
                  <p className="font-medium text-foreground">Re-parse previously processed emails</p>
                  <p className="text-muted-foreground">
                    Retries emails that were previously skipped, failed, or already parsed. Use this to recover after fixing a parser bug. Emails already applied to trips are not re-parsed.
                  </p>
                </div>
              </label>
            </div>

            <DialogFooter>
              <Button
                onClick={handleScan}
                disabled={scanEmails.isPending}
                className="w-full"
              >
                <Mail className="mr-2 h-4 w-4" />
                {scanEmails.isPending ? "Scanning…" : "Start scan"}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── Step: Scanning ── */}
        {step === "scanning" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-8">
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            {scanProgress.foundTotal === null ? (
              <>
                <p className="font-medium">Scanning emails...</p>
                <p className="text-sm text-muted-foreground">
                  Searching {emailProviderLabel(activeEmailProvider)}.
                </p>
              </>
            ) : scanProgress.total === 0 ? (
              <>
                <p className="font-medium">
                  Found {scanProgress.foundTotal} email
                  {scanProgress.foundTotal === 1 ? "" : "s"}
                </p>
                <p className="text-sm text-muted-foreground">
                  Checking which need parsing…
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">
                  Parsing {Math.min(scanProgress.parsed + 1, scanProgress.total)} of{" "}
                  {scanProgress.total}
                </p>
                <p className="max-w-md truncate text-sm text-muted-foreground">
                  {scanProgress.current?.subject ?? "Reading with Claude…"}
                </p>
                <div
                  className="mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-muted"
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
              </>
            )}
          </div>
        )}

        {/* ── Step: Results ── */}
        {step === "results" && (
          <>
            {results.length === 0 && selections.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
                <MinusCircle className="h-7 w-7 text-muted-foreground" />
                <p className="font-medium">No new emails found</p>
                <p className="text-sm text-muted-foreground">
                  Already processed, or no confirmations found.
                </p>
              </div>
            ) : (
              <>
                {/* Summary bar */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  {activeEmailProvider && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-xs font-medium text-muted-foreground"
                      title={`Scanned from ${emailProviderLabel(activeEmailProvider)}`}
                    >
                      {emailProviderLabel(activeEmailProvider)}
                    </span>
                  )}
                  {matchCounts.new > 0 && (
                    <span
                      className="flex items-center gap-1.5"
                      style={{ color: "var(--status-info-fg)" }}
                    >
                      <Plus className="h-4 w-4" />
                      {matchCounts.new} new
                    </span>
                  )}
                  {matchCounts.enrichment > 0 && (
                    <span
                      className="flex items-center gap-1.5"
                      style={{ color: "var(--status-info-fg)" }}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {matchCounts.enrichment} with details
                    </span>
                  )}
                  {matchCounts.conflict > 0 && (
                    <span
                      className="flex items-center gap-1.5"
                      style={{ color: "var(--status-warn-fg)" }}
                    >
                      <AlertCircle className="h-4 w-4" />
                      {matchCounts.conflict} conflict{matchCounts.conflict !== 1 ? "s" : ""}
                    </span>
                  )}
                  {matchCounts.duplicate > 0 && (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <MinusCircle className="h-4 w-4" />
                      {matchCounts.duplicate} already present
                    </span>
                  )}
                  {noTravelResults.length > 0 && (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <MinusCircle className="h-4 w-4" />
                      {noTravelResults.length} skipped
                    </span>
                  )}
                  {errorMessage && (
                    <p
                      className="w-full text-xs"
                      style={{ color: "var(--status-warn-fg)" }}
                    >
                      {errorMessage}
                    </p>
                  )}
                </div>

                {/* Scrollable content area */}
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {/* Auto-clustered new-trip proposals get surfaced in the
                      per-segment trip picker as "Create <title>" options.
                      A leftover unassigned segment (user manually
                      cleared the picker) shows a warning banner so they
                      can't miss it before tapping Apply. */}
                  {hasUnassignedSegments && (
                    <div
                      className="mb-3 rounded-lg border p-2.5"
                      style={statusBadgeStyle("warn")}
                    >
                      <p className="text-xs">
                        Some segments don&apos;t have a trip assigned. Pick one
                        below or check the &quot;Create&quot; option in the
                        trip dropdown.
                      </p>
                    </div>
                  )}

                  {/* Main segment list */}
                  {mainSelections.length > 0 ? (
                    <div className="space-y-2 pr-1">
                      <p className="text-sm font-medium">
                        {mainSelections.length} segment{mainSelections.length !== 1 ? "s" : ""} found:
                      </p>
                      {mainSelections.map((seg) => {
                        const globalIdx = selections.indexOf(seg);
                        return (
                          <SegmentCard
                            key={`${seg.emailId}-${globalIdx}`}
                            seg={seg}
                            index={globalIdx}
                            results={results}
                            trips={trips || []}
                            onToggle={toggleSelection}
                            onSetTrip={setTripForSegment}
                            onSetAction={setActionForSegment}
                            proposals={proposals}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      No travel segments found in scanned emails.
                    </p>
                  )}

                  {/* Low-confidence segments (collapsible) */}
                  {lowSelections.length > 0 && (
                    <div className="mt-4">
                      <button
                        onClick={() => setShowLowConfidence((v) => !v)}
                        className="flex w-full items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showLowConfidence ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                        {lowSelections.length} low-confidence segment{lowSelections.length !== 1 ? "s" : ""}
                      </button>
                      {showLowConfidence && (
                        <div className="mt-2 space-y-2">
                          {lowSelections.map((seg) => {
                            const globalIdx = selections.indexOf(seg);
                            return (
                              <SegmentCard
                                key={`${seg.emailId}-${globalIdx}`}
                                seg={seg}
                                index={globalIdx}
                                results={results}
                                trips={trips || []}
                                onToggle={toggleSelection}
                                onSetTrip={setTripForSegment}
                                onSetAction={setActionForSegment}
                                proposals={proposals}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Skipped emails (no travel content) — collapsible review */}
                  {noTravelResults.length > 0 && (
                    <SkippedEmailsSection
                      emails={noTravelResults}
                      onReport={(email) =>
                        setReportTarget({
                          emailId: email.emailId,
                          subject: email.subject,
                          reason:
                            email.parseStatus === "failed"
                              ? "failed"
                              : "no_travel_content",
                        })
                      }
                    />
                  )}
                </div>
              </>
            )}

            {/* Footer — always visible */}
            <DialogFooter className="flex-row justify-between gap-2 border-t pt-3">
              <div className="flex gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  {results.length === 0 ? "Close" : "Later"}
                </Button>
                {travelResults.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={handleDismissAll}
                  >
                    Dismiss All
                  </Button>
                )}
              </div>
              <div className="flex gap-1.5">
                {step === "results" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setStep("config");
                    }}
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Scan More
                  </Button>
                )}
                {selections.length > 0 && (
                  <Button
                    size="sm"
                    onClick={handleApply}
                    disabled={selectedCount === 0}
                  >
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                    Add {selectedCount} segment{selectedCount !== 1 ? "s" : ""}
                  </Button>
                )}
              </div>
            </DialogFooter>
          </>
        )}

        {/* ── Step: Applying ── */}
        {step === "applying" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-8">
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            <p className="font-medium">Adding segments to your trip...</p>
          </div>
        )}

        {/* ── Step: Done ── */}
        {step === "done" && (
          <>
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
              <CheckCircle2 className="h-8 w-8" style={{ color: "var(--status-ok-fg)" }} />
              <p className="text-lg font-medium">
                {appliedCount} segment{appliedCount !== 1 ? "s" : ""} added!
              </p>
              <p className="text-sm text-muted-foreground">
                Look for the yellow &quot;Review&quot; badge to verify.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => setOpen(false)} className="w-full">Done</Button>
            </DialogFooter>
          </>
        )}

        {/* ── Step: Error ── */}
        {step === "error" && (
          <>
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
              <XCircle className="h-8 w-8 text-destructive" />
              <p className="text-lg font-medium">Scan Failed</p>
              <p className="text-sm text-muted-foreground">{errorMessage}</p>
            </div>
            <DialogFooter className="flex-row justify-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                Close
              </Button>
              <Button size="sm" onClick={() => { reset(); setStep("config"); }}>
                Retry
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>

      {reportTarget && (
        <EmailReportDialog
          open={true}
          onOpenChange={(o) => {
            if (!o) setReportTarget(null);
          }}
          emailId={reportTarget.emailId}
          emailSubject={reportTarget.subject}
          defaultReason={reportTarget.reason}
        />
      )}
    </Dialog>
  );
}

/** Individual segment card */
function SegmentCard({
  seg,
  index,
  results,
  trips,
  proposals,
  onToggle,
  onSetTrip,
  onSetAction,
}: {
  seg: SegmentSelection;
  index: number;
  results: EmailScanResult[];
  trips: Array<{ id: string; title: string; startDate: string }>;
  proposals: NewTripProposal[];
  onToggle: (idx: number) => void;
  onSetTrip: (idx: number, tripId: string) => void;
  onSetAction: (idx: number, action: ApplyAction) => void;
}) {
  const email = results.find((r) => r.emailId === seg.emailId);
  const matchStatus: SegmentMatchStatus = seg.match?.status ?? "new";
  const hasExistingMatch = Boolean(seg.existingSegmentId);

  const handleTripChange = (value: string) => {
    if (value === "__create_new__") {
      onSetTrip(index, "");
    } else {
      onSetTrip(index, value);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border p-2.5 transition-colors",
        seg.selected
          ? "border-border bg-card"
          : "border-muted bg-muted/30 opacity-60",
      )}
    >
      <div className="flex items-start gap-2.5">
        <button
          onClick={() => onToggle(index)}
          className="mt-0.5 shrink-0"
        >
          {seg.selected ? (
            <Check className="h-4 w-4 rounded border border-primary bg-primary p-0.5 text-primary-foreground" />
          ) : (
            <div className="h-4 w-4 rounded border border-muted-foreground/30" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{seg.title}</span>
            <Badge
              variant="outline"
              className="text-[10px]"
              style={statusBadgeStyle(MATCH_STATUS_TONE[matchStatus])}
            >
              {MATCH_STATUS_LABEL[matchStatus]}
            </Badge>
            <Badge
              variant="outline"
              className="text-[10px]"
              style={statusBadgeStyle(
                CONFIDENCE_TONE[seg.confidence] ?? "muted",
              )}
            >
              {seg.confidence}
            </Badge>
          </div>

          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span>{seg.date}</span>
            {seg.startTime && <span>{seg.startTime}</span>}
            {seg.confirmationCode && (
              <span className="font-mono">#{seg.confirmationCode}</span>
            )}
            {seg.cost && (
              <span className="font-medium text-foreground">
                {seg.cost.currency} {seg.cost.amount.toFixed(2)}
              </span>
            )}
          </div>

          {email && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {email.subject}
            </p>
          )}

          {/* Match details: new fields being added / conflicting fields */}
          {hasExistingMatch && (matchStatus === "enrichment" || matchStatus === "conflict") && (
            <div className="mt-1.5 space-y-1 rounded border border-dashed border-muted-foreground/20 bg-muted/30 p-1.5 text-[11px]">
              {seg.match?.newFields && seg.match.newFields.length > 0 && (
                <div>
                  <span className="font-medium" style={{ color: "var(--status-info-fg)" }}>Adds: </span>
                  <span className="text-muted-foreground">
                    {seg.match.newFields.join(", ")}
                  </span>
                </div>
              )}
              {seg.match?.conflictFields && seg.match.conflictFields.length > 0 && (
                <div className="space-y-0.5">
                  <span className="font-medium" style={{ color: "var(--status-warn-fg)" }}>Conflicts:</span>
                  {seg.match.conflictFields.map((diff) => (
                    <div key={diff.field} className="pl-2 text-muted-foreground">
                      <span className="font-mono text-[10px]">{diff.field}:</span>{" "}
                      <span className="line-through">{String(diff.existing ?? "—")}</span>
                      {" → "}
                      <span className="text-foreground">{String(diff.parsed ?? "—")}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Action selector: only meaningful when an existing match is available */}
          {seg.selected && hasExistingMatch && matchStatus !== "new" && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {(["merge", "replace", "create"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => onSetAction(index, a)}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                    seg.action === a
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                  )}
                  title={
                    a === "merge"
                      ? "Fill empty fields from email; keep existing values"
                      : a === "replace"
                        ? "Overwrite existing fields with email data"
                        : "Add as a new separate segment"
                  }
                >
                  {a === "merge" ? "Merge" : a === "replace" ? "Replace" : "Add new"}
                </button>
              ))}
            </div>
          )}

          {seg.selected && (
            <div className="mt-1.5">
              <Select
                value={seg.assignedTripId}
                onValueChange={handleTripChange}
              >
                <SelectTrigger className="h-7 w-full text-xs">
                  <SelectValue placeholder="Assign to trip..." />
                </SelectTrigger>
                <SelectContent>
                  {trips.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title} ({t.startDate})
                    </SelectItem>
                  ))}
                  {proposals.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span
                        className="flex items-center gap-1.5"
                        style={{ color: "var(--status-info-fg)" }}
                      >
                        <Plus className="h-3 w-3" />
                        Create {p.title} ({p.startDate})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!seg.assignedTripId && (
                <p
                  className="mt-0.5 text-[10px]"
                  style={{ color: "var(--status-warn-fg)" }}
                >
                  Select a trip or create a new one
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Collapsible section showing emails that had no travel content */
function SkippedEmailsSection({
  emails,
  onReport,
}: {
  emails: EmailScanResult[];
  onReport: (email: EmailScanResult) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-4">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <Eye className="h-3.5 w-3.5" />
        {emails.length} skipped email{emails.length !== 1 ? "s" : ""} (duplicates or non-travel)
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5">
          {emails.map((email) => (
            <div
              key={email.emailId}
              className="flex items-start justify-between gap-2 rounded border border-muted bg-muted/20 px-2.5 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{email.subject}</p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {email.from} &middot;{" "}
                  {new Date(email.receivedAt).toLocaleDateString()}
                  {email.parseStatus === "failed" && (
                    <>
                      {" "}
                      &middot;{" "}
                      <span style={{ color: "var(--status-warn-fg)" }}>parser failed</span>
                    </>
                  )}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 shrink-0 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                onClick={() => onReport(email)}
              >
                <Flag className="mr-1 h-3 w-3" />
                Report
              </Button>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground italic">
            These emails are likely duplicates of bookings already extracted, or not related to travel segments. They won&apos;t be scanned again. If one should have been parsed, hit Report and we&apos;ll take a look.
          </p>
        </div>
      )}
    </div>
  );
}
