"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  useApplyParsedSegments,
  useDismissEmail,
  useGmailLabels,
  usePendingEmails,
  useScanEmails,
  useTrips,
} from "@travel-app/api-client";
import type {
  EmailScanResult,
  ParsedSegment,
  SegmentMatchStatus,
} from "@travel-app/shared";
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
import { isGmailLinkConfigured, startGmailLink } from "@/lib/oauth";
import { cn } from "@/lib/utils";
import { fmt12h, SEGMENT_CONFIG } from "./mobile-segment-config";
import { MobileBottomSheet } from "./mobile-bottom-sheet";

// ── Types ──────────────────────────────────────────────────

/**
 * Steps in the scan flow:
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

function buildReviewItems(
  results: readonly EmailScanResult[],
  tripIdFilter: string | undefined,
  defaultTripId: string,
): ReviewItem[] {
  const items: ReviewItem[] = [];
  for (const res of results) {
    if (res.parseStatus !== "success") continue;
    for (const seg of res.parsedSegments) {
      // When opened from a specific trip, only surface segments
      // suggested for that trip — keeps the review focused.
      if (tripIdFilter && seg.suggestedTripId && seg.suggestedTripId !== tripIdFilter) {
        continue;
      }
      const tripId = seg.suggestedTripId ?? defaultTripId;
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
  return items;
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

  const { data: trips = [] } = useTrips();
  // Don't fetch Gmail labels or pending results until we've confirmed
  // the link — fetches would 401/403 and pollute the console. The
  // desktop dialog gates the same way.
  const { data: labels = [], error: labelsError } = useGmailLabels(gmailGranted);
  // Pending-results restoration: if a previous scan left results that
  // weren't applied (e.g. user closed the sheet mid-review), surface
  // them on next open instead of forcing a re-scan. The hook is gated
  // on `gmailGranted` so unlinked users skip the call.
  const { data: pendingData } = usePendingEmails(gmailGranted);
  const scanEmails = useScanEmails();
  const applySegments = useApplyParsedSegments();
  const dismissEmail = useDismissEmail();

  // Initial step: needs-scope when unlinked, otherwise config (later
  // bumped to review by the pending-results effect below if there's
  // anything to restore).
  const [step, setStep] = useState<Step>(
    gmailGranted ? "config" : "needs-scope",
  );
  const [labelId, setLabelId] = useState<string | null>(null);
  const [forceRescan, setForceRescan] = useState(false);
  const [results, setResults] = useState<EmailScanResult[]>([]);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [appliedCount, setAppliedCount] = useState(0);
  /**
   * Inline banner shown above the review list when a scan returned
   * partial results with a billing (402) or overload (503) error —
   * surfaces what the user can still do without forcing a retry.
   */
  const [partialError, setPartialError] = useState<string | null>(null);

  // Default trip for items without a `suggestedTripId` — the per-trip
  // entry point uses the active trip; account-level falls back to the
  // first available trip so the picker is never blank on first render.
  const defaultTripId = tripId ?? trips[0]?.id ?? "";

  // When labels load, default to "Travel" if it exists (matches what
  // most people use for confirmations) — otherwise leave unfiltered.
  useEffect(() => {
    if (labelId !== null) return;
    const travel = labels.find((l) => l.name.toLowerCase() === "travel");
    if (travel) setLabelId(travel.id);
  }, [labels, labelId]);

  // Restore pending results from the cache when the sheet opens. Only
  // happens once (gated on `step === "config"` to avoid clobbering a
  // mid-flight scan or an in-progress review). If pending exists, jump
  // straight to review.
  useEffect(() => {
    if (step !== "config") return;
    const pending = pendingData?.results;
    if (!pending || pending.length === 0) return;
    const built = buildReviewItems(pending, tripId, defaultTripId);
    if (built.length === 0) return;
    setResults(pending);
    setItems(built);
    setStep("review");
  }, [pendingData, step, tripId, defaultTripId]);

  const handleStartScan = async () => {
    setStep("scanning");
    setPartialError(null);
    try {
      const response = await scanEmails.mutateAsync({
        labelFilter: labelId || undefined,
        forceRescan: forceRescan || undefined,
      });
      const built = buildReviewItems(response.results, tripId, defaultTripId);
      setResults(response.results);
      setItems(built);
      // Skip the review step entirely if nothing parsed — go straight
      // to a "done — no new emails" terminal state.
      setStep(built.length === 0 ? "done" : "review");
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
          const built = buildReviewItems(partial, tripId, defaultTripId);
          setResults(partial);
          setItems(built);
          setPartialError(
            body?.error ??
              (isOverloaded
                ? "The AI service is temporarily overloaded. The segments below were parsed before the rest of the batch failed — you can apply them and try again later for the rest."
                : "The AI service needs credits to finish parsing. The segments below got through; add credits at console.anthropic.com to retry the rest."),
          );
          setStep(built.length === 0 ? "done" : "review");
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
      let added = 0;
      if (toApply.length > 0) {
        const res = await applySegments.mutateAsync({
          segments: toApply.map((it) => {
            // Filter above guarantees `it.action !== "skip"`. The
            // server schema's `action` enum is just create / merge /
            // replace, so narrow back to that union here — TS can't
            // infer the narrowing from the .filter() predicate.
            const action = it.action as "create" | "merge" | "replace";
            return {
              ...it.segment,
              tripId: it.tripId,
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
      // — matches desktop. Reduces re-scan noise.
      const appliedEmailIds = new Set(toApply.map((it) => it.emailId));
      const allEmailIds = new Set(results.map((r) => r.emailId));
      for (const id of allEmailIds) {
        if (!appliedEmailIds.has(id)) {
          dismissEmail.mutate(id);
        }
      }
      setAppliedCount(added);
      setStep("done");
    } catch (err) {
      toast.error("Couldn't apply segments", {
        description: describeError(err),
      });
    }
  };

  // ── Render per step ──

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
          {labelsError && (
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
                Couldn&apos;t load Gmail labels. You may need to sign out
                and re-link Gmail.
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
                  trips={trips.map((t) => ({ id: t.id, title: t.title }))}
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
            disabled={selectedCount === 0 || applySegments.isPending}
            className="inline-flex h-11 flex-[2] items-center justify-center gap-1.5 rounded-full bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {applySegments.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Apply {selectedCount > 0 ? selectedCount : ""}
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
          <p className="text-kicker font-medium text-muted-foreground">
            Gmail label
          </p>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1">
            <LabelPill
              active={labelId === null}
              onClick={() => setLabelId(null)}
              icon={<Inbox className="h-3 w-3" />}
              label="All mail"
            />
            {labels.map((l) => (
              <LabelPill
                key={l.id}
                active={labelId === l.id}
                onClick={() => setLabelId(l.id)}
                label={l.name}
              />
            ))}
          </div>
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

function LabelPill({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-medium transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-muted-foreground",
      )}
    >
      {icon}
      {label}
    </button>
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
  showTripPicker,
  onToggleSelected,
  onCycleAction,
  onChangeTrip,
}: {
  item: ReviewItem;
  trips: { id: string; title: string }[];
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
            {trips.length === 0 && <option value="">(no trips)</option>}
            {trips.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
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
