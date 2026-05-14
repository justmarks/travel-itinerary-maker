"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ApiError,
  useApplyParsedSegments,
  useCreateTrip,
  useImportSharedContent,
  useTrips,
} from "@itinly/api-client";
import type { EmailScanResult, NewTripProposal } from "@itinly/shared";
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
import { RequireAuth } from "@/components/require-auth";
import { MobileFrame, MobileHeader } from "@/components/mobile/mobile-shell";
import {
  fmt12h,
  SEGMENT_CONFIG,
} from "@/components/mobile/mobile-segment-config";
import { describeError, toastMutationError } from "@/lib/api-error";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Inbox,
  Link2,
  Loader2,
  Send,
  Sparkles,
} from "lucide-react";

/**
 * PWA "Send to itinly" share-target receiver.
 *
 * Web Share Target ships its payload as GET query params (`title`,
 * `text`, `url`) per the manifest declaration in `app/manifest.ts`.
 * This page collects them, POSTs to /emails/import-shared, and lands
 * the user in the same triage UI the email scan / HTML import flows
 * use — so a forwarded confirmation from any mobile app (Mail, Gmail,
 * Safari, …) ends up as parsed segments ready to be added to a trip.
 *
 * Steps:
 *   1. `idle` — read params, kick off the import mutation.
 *   2. `parsing` — spinner while Claude works.
 *   3. `review` — picker per parsed segment; trip selection.
 *   4. `done` — success state with a link back home / to the trip.
 *
 * Out of scope:
 *   - File shares (POST + multipart) — the manifest only declares
 *     text/title/url params; .eml file shares are a follow-up.
 *   - Inline trip editing — same as the email-scan sheet, the user
 *     adjusts the parsed values on the trip itself afterwards.
 */
type Step = "idle" | "parsing" | "review" | "done";

function MobileSharePageInner(): React.JSX.Element {
  const router = useRouter();
  const params = useSearchParams();

  // Read once at mount — we don't want a re-render to re-trigger the
  // parse (the share intent's params are immutable for the lifetime
  // of this page navigation).
  const sharedRef = useRef<{
    title?: string;
    text?: string;
    url?: string;
  } | null>(null);
  if (sharedRef.current === null) {
    sharedRef.current = {
      title: params?.get("title") || undefined,
      text: params?.get("text") || undefined,
      url: params?.get("url") || undefined,
    };
  }
  const shared = sharedRef.current;
  const hasContent = Boolean(shared.text || shared.url);

  const { data: trips = [] } = useTrips();
  const importShared = useImportSharedContent();
  const applySegments = useApplyParsedSegments();
  const createTrip = useCreateTrip();

  const [step, setStep] = useState<Step>("idle");
  const [result, setResult] = useState<EmailScanResult | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [proposals, setProposals] = useState<NewTripProposal[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [appliedCount, setAppliedCount] = useState(0);
  const [appliedTripId, setAppliedTripId] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const applyingRef = useRef(false);
  // Kick off the import exactly once per page mount.
  const startedRef = useRef(false);

  useEffect(() => {
    if (!hasContent || startedRef.current) return;
    startedRef.current = true;
    setStep("parsing");
    importShared
      .mutateAsync({
        title: shared.title,
        text: shared.text,
        url: shared.url,
      })
      .then((response) => {
        setResult(response.result);
        // Build the review state. The helper also returns `proposals`
        // for unmatched segments so the trip picker offers "Create
        // new trip" alongside existing ones.
        const built = buildReviewItems([response.result]);
        setItems(built.items);
        setProposals(built.proposals);
        if (response.result.parseStatus !== "success") {
          // The parser ran but didn't find anything actionable. Stay
          // on a "review" step with an empty list so the user sees a
          // clear explanation instead of being kicked back home.
          setStep("review");
          return;
        }
        setStep("review");
      })
      .catch((err) => {
        // Surface a typed message. /emails/import-shared maps the
        // common Anthropic outages (billing 402, overload 503, auth
        // 401) into `code` strings; describeError pulls the body's
        // `error` for everything else.
        if (err instanceof ApiError) {
          const code =
            typeof err.body === "object" && err.body
              ? (err.body as { code?: string }).code
              : undefined;
          if (code === "ANTHROPIC_BILLING") {
            setImportError(
              "Couldn't parse: AI service needs more credits. Check console.anthropic.com.",
            );
          } else if (code === "ANTHROPIC_OVERLOADED") {
            setImportError(
              "The AI service is overloaded right now. Try again in a few minutes.",
            );
          } else if (code === "ANTHROPIC_AUTH") {
            setImportError(
              "The AI service API key is invalid. The app owner needs to update it.",
            );
          } else {
            setImportError(describeError(err));
          }
        } else {
          setImportError(describeError(err));
        }
        setStep("review");
      });
    // Intentionally empty deps — we want a one-shot effect. The
    // mutation handles its own cleanup; `shared` is captured from
    // the ref and won't change for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedCount = items.filter((it) => it.selected).length;
  const applyableCount = items.filter(
    (it) => it.selected && it.action !== "skip" && it.tripId,
  ).length;

  const tripsForPicker = useMemo(
    () =>
      trips.map((t) => ({
        id: t.id,
        title: t.title,
        startDate: t.startDate,
        endDate: t.endDate,
      })),
    [trips],
  );

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
    if (applyingRef.current) return;
    applyingRef.current = true;
    setIsApplying(true);
    const toApply = items.filter(
      (it) => it.selected && it.action !== "skip" && it.tripId,
    );
    try {
      const sentinelToRealId = await resolveProposalSentinels(
        toApply.map((it) => ({
          tripId: it.tripId,
          startDate: it.segment.date,
          endDate: it.segment.endDate,
        })),
        proposals,
        createTrip.mutateAsync,
      );

      let added = 0;
      let firstTripId: string | null = null;
      if (toApply.length > 0) {
        const res = await applySegments.mutateAsync({
          segments: toApply.map((it) => {
            const action = it.action as "create" | "merge" | "replace";
            const tripIdResolved =
              sentinelToRealId.get(it.tripId) ?? it.tripId;
            if (!firstTripId) firstTripId = tripIdResolved;
            return {
              ...it.segment,
              tripId: tripIdResolved,
              emailId: it.emailId,
              action,
              existingSegmentId:
                action === "merge" || action === "replace"
                  ? it.segment.match?.existingSegmentId
                  : undefined,
            };
          }),
        });
        added = res.created.length + (res.updated?.length ?? 0);
      }
      setAppliedCount(added);
      setAppliedTripId(firstTripId);
      setStep("done");
    } catch (err) {
      toastMutationError("apply shared content")(err);
    } finally {
      applyingRef.current = false;
      setIsApplying(false);
    }
  };

  // ── Render ─────────────────────────────────────────────

  // No params at all — usually a direct visit to /m/share. Send the
  // user back to the hub with a hint about how the page is meant to
  // be reached.
  if (!hasContent) {
    return (
      <MobileFrame>
        <MobileHeader title="Send to itinly" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
          <Send className="h-7 w-7 text-muted-foreground" />
          <p className="text-base font-medium">Nothing shared yet</p>
          <p className="max-w-[280px] text-xs text-muted-foreground">
            From any app, tap the Share button and pick &quot;itinly&quot;
            to send a confirmation email or booking page here.
          </p>
          <button
            type="button"
            onClick={() => router.replace("/m")}
            className="mt-4 inline-flex h-10 items-center justify-center rounded-full border bg-background px-6 text-sm font-medium"
          >
            Back to my trips
          </button>
        </div>
      </MobileFrame>
    );
  }

  if (step === "parsing" || step === "idle") {
    return (
      <MobileFrame>
        <MobileHeader title="Send to itinly" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm font-medium">Reading the booking…</p>
          <p className="max-w-[280px] text-xs text-muted-foreground">
            We&apos;re asking Claude to pull out the trip details. This
            usually takes a few seconds.
          </p>
          {/* Show a chip describing what we received so the user
              knows the share actually landed — especially useful when
              parsing takes longer than expected. */}
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-3 py-1 text-[11px] text-muted-foreground">
            {shared.url ? (
              <>
                <Link2 className="h-3 w-3" />
                <span className="max-w-[220px] truncate">{shared.url}</span>
              </>
            ) : (
              <>
                <Sparkles className="h-3 w-3" />
                <span>
                  {shared.title ? `“${shared.title}”` : "Shared text"}
                </span>
              </>
            )}
          </div>
        </div>
      </MobileFrame>
    );
  }

  if (step === "done") {
    return (
      <MobileFrame>
        <MobileHeader title="Done" />
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
                badge on each one and tap to confirm.
              </p>
            </>
          ) : (
            <>
              <Inbox className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">Nothing added</p>
              <p className="max-w-[280px] text-xs text-muted-foreground">
                The shared content didn&apos;t produce any segments you
                wanted to keep.
              </p>
            </>
          )}
          <div className="mt-4 flex gap-2">
            {appliedTripId && (
              <button
                type="button"
                onClick={() => router.replace(`/m/trip?id=${appliedTripId}`)}
                className="inline-flex h-10 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground"
              >
                View trip
              </button>
            )}
            <button
              type="button"
              onClick={() => router.replace("/m")}
              className={cn(
                "inline-flex h-10 items-center justify-center rounded-full border bg-background px-5 text-sm font-medium",
                !appliedTripId && "bg-primary text-primary-foreground border-transparent",
              )}
            >
              {appliedTripId ? "Done" : "Back to trips"}
            </button>
          </div>
        </div>
      </MobileFrame>
    );
  }

  // step === "review"
  const status = result?.parseStatus;
  const showEmptyState =
    items.length === 0 &&
    (status === "no_travel_content" || status === "failed");

  return (
    <MobileFrame>
      <MobileHeader
        title="Send to itinly"
        subtitle={
          items.length > 0
            ? `${items.length} segment${items.length === 1 ? "" : "s"} · ${selectedCount} selected`
            : undefined
        }
      />
      <div className="flex flex-1 flex-col">
        {importError && (
          <div
            className="mx-3 mt-3 flex items-start gap-2 rounded-lg border p-2.5 text-xs"
            style={{
              backgroundColor: "var(--status-danger-bg)",
              color: "var(--status-danger-fg)",
              borderColor: "var(--status-danger-rail)",
            }}
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{importError}</p>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {showEmptyState ? (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <Inbox className="h-7 w-7 text-muted-foreground" />
              <p className="text-sm font-medium">
                {status === "failed"
                  ? "Couldn't make sense of this"
                  : "No booking found"}
              </p>
              <p className="max-w-[280px] text-xs text-muted-foreground">
                {status === "failed"
                  ? result?.error ??
                    "The parser couldn't extract a usable trip segment from this share."
                  : "The shared content didn't look like a travel confirmation. Try sharing the actual confirmation email instead."}
              </p>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <Inbox className="h-7 w-7 text-muted-foreground" />
              <p className="text-sm font-medium">No segments to review</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((item, idx) => (
                <ShareReviewCard
                  key={`${item.emailId}-${idx}`}
                  item={item}
                  trips={tripsForPicker}
                  proposals={proposals}
                  onToggleSelected={() => toggleSelected(idx)}
                  onCycleAction={() => cycleAction(idx)}
                  onChangeTrip={(next) => setTripId(idx, next)}
                />
              ))}
            </ul>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t bg-background px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          <button
            type="button"
            onClick={() => router.replace("/m")}
            className="h-11 flex-1 rounded-full border bg-background text-sm font-medium"
          >
            Cancel
          </button>
          {items.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                void handleApply().then(() => {
                  if (applyableCount > 0) {
                    toast.success(`Added ${applyableCount} to your itinerary`);
                  }
                });
              }}
              disabled={applyableCount === 0 || isApplying}
              className="inline-flex h-11 flex-[2] items-center justify-center gap-1.5 rounded-full bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {isApplying && <Loader2 className="h-4 w-4 animate-spin" />}
              Add {applyableCount > 0 ? applyableCount : ""}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => router.replace("/m")}
              className="inline-flex h-11 flex-[2] items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
            >
              Back to trips
            </button>
          )}
        </div>
      </div>
    </MobileFrame>
  );
}

// ─── Review card ───────────────────────────────────────────

function ShareReviewCard({
  item,
  trips,
  proposals,
  onToggleSelected,
  onCycleAction,
  onChangeTrip,
}: {
  item: ReviewItem;
  trips: { id: string; title: string; startDate: string; endDate: string }[];
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

// `useSearchParams()` requires a Suspense boundary in Next 15 — wrap
// the inner component so a static prerender doesn't blow up. The
// boundary's fallback never actually shows in production because
// the page is forced dynamic by the search-params read, but Next's
// type-checker insists.
export default function MobileSharePage(): React.JSX.Element {
  return (
    <RequireAuth>
      <Suspense
        fallback={
          <MobileFrame>
            <MobileHeader title="Send to itinly" />
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          </MobileFrame>
        }
      >
        <MobileSharePageInner />
      </Suspense>
    </RequireAuth>
  );
}
