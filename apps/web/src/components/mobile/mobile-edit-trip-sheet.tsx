"use client";

import { useState } from "react";
import { ApiError, useUpdateTrip } from "@itinly/api-client";
import type { Trip, TripStatus } from "@itinly/shared";
import { TRIP_STATUSES } from "@itinly/shared";
import { AlertCircle, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toastMutationError } from "@/lib/api-error";
import { useConfirm } from "@/lib/confirm-dialog";
import { MobileBottomSheet } from "./mobile-bottom-sheet";

interface OverlapInfo {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
}

const STATUS_TOKEN: Record<string, string> = {
  planning: "info",
  active: "ok",
  completed: "muted",
  cancelled: "danger",
};

function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Bottom-sheet form for editing a trip's metadata on `/m`. Mirrors
 * the desktop affordances (`EditableTitle`, `EditableDates`, status
 * chip cycle in trip-detail-client.tsx) consolidated into one form.
 *
 * Like the segment / create-trip sheets, the form lives in a child
 * component that's only mounted while the sheet is open and is keyed
 * on the trip id so each open initializes fresh state from the
 * latest cached trip.
 */
export function MobileEditTripSheet({
  trip,
  open,
  onClose,
}: {
  trip: Trip;
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <MobileBottomSheet open={open} onClose={onClose} ariaLabel="Edit trip">
      {open && <EditTripBody key={trip.id} trip={trip} onClose={onClose} />}
    </MobileBottomSheet>
  );
}

function EditTripBody({
  trip,
  onClose,
}: {
  trip: Trip;
  onClose: () => void;
}): React.JSX.Element {
  const updateTrip = useUpdateTrip(trip.id);

  const [title, setTitle] = useState(trip.title);
  const [startDate, setStartDate] = useState(trip.startDate);
  const [endDate, setEndDate] = useState(trip.endDate);
  const [status, setStatus] = useState<TripStatus>(trip.status);
  const [overlap, setOverlap] = useState<OverlapInfo[] | null>(null);

  const datesInOrder = startDate <= endDate;
  const titleValid = title.trim().length > 0;
  const canSave = titleValid && datesInOrder;

  const trimmedTitle = title.trim();
  const hasChanges =
    trimmedTitle !== trip.title ||
    startDate !== trip.startDate ||
    endDate !== trip.endDate ||
    status !== trip.status;

  const confirm = useConfirm();

  const handleSave = async () => {
    if (!canSave || !hasChanges) return;
    setOverlap(null);

    // Mirror the desktop EditableDates orphaned-segment guard — shrinking
    // the trip's date range silently destroys any segments whose date now
    // falls outside the range, so we prompt up-front.
    const datesChanged =
      startDate !== trip.startDate || endDate !== trip.endDate;
    if (datesChanged) {
      const orphaned = trip.days
        .filter((d) => d.date < startDate || d.date > endDate)
        .flatMap((d) => d.segments);
      if (orphaned.length > 0) {
        const preview = orphaned
          .slice(0, 3)
          .map((s) => `• ${s.title}`)
          .join("\n");
        const more =
          orphaned.length > 3 ? `\n…and ${orphaned.length - 3} more` : "";
        const ok = await confirm({
          title: `Remove ${orphaned.length} segment${orphaned.length === 1 ? "" : "s"} outside the new dates?`,
          description: `${preview}${more}\n\nThese segments fall outside ${startDate} – ${endDate} and will be deleted. This cannot be undone.`,
          confirmText:
            orphaned.length === 1
              ? "Remove segment"
              : `Remove ${orphaned.length} segments`,
          destructive: true,
        });
        if (!ok) return;
      }
    }

    const updates: Record<string, string> = {};
    if (trimmedTitle !== trip.title) updates.title = trimmedTitle;
    if (startDate !== trip.startDate) updates.startDate = startDate;
    if (endDate !== trip.endDate) updates.endDate = endDate;
    if (status !== trip.status) updates.status = status;

    updateTrip.mutate(updates, {
      onSuccess: onClose,
      onError: (err) => {
        if (err instanceof ApiError && err.status === 409) {
          const body = err.body as { overlappingTrips?: OverlapInfo[] };
          if (body?.overlappingTrips) {
            setOverlap(body.overlappingTrips);
            return;
          }
        }
        toastMutationError("save trip")(err);
      },
    });
  };

  return (
    <>
      <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-1">
        <div className="min-w-0 flex-1">
          <p className="text-kicker font-semibold text-muted-foreground">
            Trip
          </p>
          <h2 className="mt-0.5 text-lg font-semibold leading-snug">
            Edit trip
          </h2>
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

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
        className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 pb-3"
      >
        <div className="space-y-1.5">
          <label
            htmlFor="m-edit-trip-title"
            className="text-kicker font-medium text-muted-foreground"
          >
            Trip name
          </label>
          <input
            id="m-edit-trip-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-11 w-full rounded-xl border bg-background px-3 text-base text-foreground outline-none focus:border-foreground"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label
              htmlFor="m-edit-trip-start"
              className="text-kicker font-medium text-muted-foreground"
            >
              Start
            </label>
            <input
              id="m-edit-trip-start"
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setOverlap(null);
              }}
              className="h-11 w-full rounded-xl border bg-background px-3 text-base text-foreground outline-none focus:border-foreground"
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="m-edit-trip-end"
              className="text-kicker font-medium text-muted-foreground"
            >
              End
            </label>
            <input
              id="m-edit-trip-end"
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => {
                setEndDate(e.target.value);
                setOverlap(null);
              }}
              className="h-11 w-full rounded-xl border bg-background px-3 text-base text-foreground outline-none focus:border-foreground"
            />
          </div>
        </div>

        {!datesInOrder && (
          <p className="text-sm" style={{ color: "var(--status-danger-fg)" }}>
            End date must be on or after start date.
          </p>
        )}

        <div className="space-y-1.5" role="group" aria-labelledby="m-edit-trip-status-label">
          <p
            id="m-edit-trip-status-label"
            className="text-kicker font-medium text-muted-foreground"
          >
            Status
          </p>
          <div className="flex flex-wrap gap-2">
            {TRIP_STATUSES.map((s) => {
              const active = status === s;
              const token = STATUS_TOKEN[s] ?? "muted";
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  aria-pressed={active}
                  className={cn(
                    "inline-flex h-9 items-center rounded-full border px-3 text-sm font-medium capitalize transition-colors",
                    active
                      ? "border-transparent"
                      : "border-border bg-background text-foreground",
                  )}
                  style={
                    active
                      ? {
                          backgroundColor: `var(--status-${token}-bg)`,
                          color: `var(--status-${token}-fg)`,
                          borderColor: `var(--status-${token}-rail)`,
                        }
                      : undefined
                  }
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>

        {overlap && (
          <div
            className="flex items-start gap-2 rounded-xl border p-3 text-sm"
            style={{
              backgroundColor: "var(--status-danger-bg)",
              color: "var(--status-danger-fg)",
              borderColor: "var(--status-danger-rail)",
            }}
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-medium">
                These dates overlap with an existing trip:
              </p>
              <ul className="mt-1 space-y-0.5">
                {overlap.map((t) => (
                  <li key={t.id}>
                    <span className="font-medium">{t.title}</span>{" "}
                    <span className="text-xs opacity-80">
                      ({fmtDate(t.startDate)} – {fmtDate(t.endDate)})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </form>

      <div className="flex shrink-0 items-center gap-2 border-t bg-background px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        <button
          type="button"
          onClick={onClose}
          className="h-11 flex-1 rounded-full border bg-background text-sm font-medium text-foreground active:bg-muted/40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!canSave || !hasChanges || updateTrip.isPending}
          className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {updateTrip.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Save
        </button>
      </div>
    </>
  );
}
