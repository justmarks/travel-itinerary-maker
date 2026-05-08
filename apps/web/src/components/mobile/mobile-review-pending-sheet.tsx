"use client";

import { useMemo } from "react";
import {
  useConfirmAllSegments,
  useConfirmSegment,
} from "@travel-app/api-client";
import type { Segment, Trip } from "@travel-app/shared";
import { AlertCircle, Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { describeError } from "@/lib/api-error";
import { fmt12h, SEGMENT_CONFIG } from "./mobile-segment-config";
import { MobileBottomSheet } from "./mobile-bottom-sheet";

interface PendingRow {
  segment: Segment;
  date: string;
}



function fmtDateShort(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function collectPending(trip: Trip): PendingRow[] {
  const rows: PendingRow[] = [];
  for (const day of trip.days) {
    for (const segment of day.segments) {
      if (segment.needsReview) {
        rows.push({ segment, date: day.date });
      }
    }
  }
  return rows;
}

/**
 * Bottom sheet that lists every `needsReview: true` segment on a trip
 * and lets the user clear the flag — per-row tap-to-confirm via the
 * green check, or a "Confirm all" footer button (this is the first UI
 * surface for `useConfirmAllSegments`; the hook existed but had no
 * desktop call site).
 */
export function MobileReviewPendingSheet({
  trip,
  open,
  onClose,
}: {
  trip: Trip;
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const confirmSegment = useConfirmSegment(trip.id);
  const confirmAll = useConfirmAllSegments(trip.id);

  const rows = useMemo(() => collectPending(trip), [trip]);
  const total = rows.length;

  const handleConfirmOne = (segmentId: string, title: string) => {
    confirmSegment.mutate(segmentId, {
      onError: (err) =>
        toast.error(`Couldn't confirm "${title}"`, {
          description: describeError(err),
        }),
    });
  };

  const handleConfirmAll = () => {
    confirmAll.mutate(undefined, {
      onSuccess: onClose,
      onError: (err) =>
        toast.error("Couldn't confirm all", {
          description: describeError(err),
        }),
    });
  };

  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      ariaLabel="Pending review segments"
    >
      <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-1">
        <div className="min-w-0 flex-1">
          <p className="text-kicker font-semibold text-muted-foreground">
            Review
          </p>
          <h2 className="mt-0.5 text-lg font-semibold leading-snug">
            {total === 0
              ? "All caught up"
              : `${total} pending segment${total === 1 ? "" : "s"}`}
          </h2>
          {total > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              These were auto-parsed from email. Tap{" "}
              <Check className="inline h-3 w-3" /> to confirm or open one to
              edit.
            </p>
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

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {total === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
            <Check
              className="h-8 w-8"
              style={{ color: "var(--status-ok-fg)" }}
            />
            <p className="text-sm text-muted-foreground">
              No segments need review.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {rows.map(({ segment, date }) => {
              const cfg =
                SEGMENT_CONFIG[segment.type] ?? SEGMENT_CONFIG.activity;
              const Icon = cfg.icon;
              const startTime = fmt12h(segment.startTime);
              return (
                <li
                  key={segment.id}
                  className="flex items-center gap-2 rounded-xl border bg-card px-2 py-2"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                      style={{ background: cfg.bg, color: cfg.fg }}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium leading-tight">
                        {segment.title}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {fmtDateShort(date)}
                        {startTime && ` · ${startTime}`}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      handleConfirmOne(segment.id, segment.title)
                    }
                    aria-label={`Confirm "${segment.title}"`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border active:opacity-70"
                    style={{
                      backgroundColor: "var(--status-ok-bg)",
                      color: "var(--status-ok-fg)",
                      borderColor: "var(--status-ok-rail)",
                    }}
                  >
                    <Check className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {total > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-t bg-background px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          <div
            className="inline-flex h-9 items-center gap-1 rounded-full border px-3 text-[11px] font-medium"
            style={{
              backgroundColor: "var(--status-warn-bg)",
              color: "var(--status-warn-fg)",
              borderColor: "var(--status-warn-rail)",
            }}
          >
            <AlertCircle className="h-3 w-3" />
            {total} pending
          </div>
          <button
            type="button"
            onClick={handleConfirmAll}
            disabled={confirmAll.isPending}
            className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {confirmAll.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Confirm all
          </button>
        </div>
      )}
    </MobileBottomSheet>
  );
}
