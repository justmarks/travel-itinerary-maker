"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, useCreateTrip } from "@travel-app/api-client";
import { AlertCircle, Loader2, X } from "lucide-react";
import { useDemoMode } from "@/lib/demo";
import { MobileBottomSheet } from "./mobile-bottom-sheet";

interface OverlapInfo {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
}

function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Bottom-sheet form for creating a new trip on `/m`. Mirrors the field
 * set of the desktop `CreateTripDialog` (title, startDate, endDate)
 * including the 409 overlap response handling. On success, navigates
 * to the new trip's mobile detail page.
 *
 * The form lives in a child component that is keyed on `open` so each
 * fresh open starts from a clean state — same pattern as the segment
 * form sheet.
 */
export function MobileCreateTripSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <MobileBottomSheet open={open} onClose={onClose} ariaLabel="Create trip">
      {open && <CreateTripBody onClose={onClose} />}
    </MobileBottomSheet>
  );
}

function CreateTripBody({ onClose }: { onClose: () => void }): React.JSX.Element {
  const router = useRouter();
  const createTrip = useCreateTrip();
  const isDemo = useDemoMode();

  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [overlap, setOverlap] = useState<OverlapInfo[] | null>(null);
  const endDateRef = useRef<HTMLInputElement>(null);

  // If the user picks a startDate before any endDate, default endDate
  // to the same day so a quick one-day trip can be created without
  // tapping the second picker. Only fills when endDate is empty.
  useEffect(() => {
    if (startDate && !endDate) setEndDate(startDate);
  }, [startDate, endDate]);

  /**
   * After a start date is chosen, hand off to the end picker
   * automatically so the user gets a single fluid "tap start → pick →
   * pick end → done" flow. `showPicker` is supported on every browser
   * we target and is a no-op anywhere it isn't.
   */
  const openEndPicker = () => {
    queueMicrotask(() => {
      const el = endDateRef.current;
      if (!el || typeof el.showPicker !== "function") return;
      try {
        el.showPicker();
      } catch {
        // showPicker can throw if the input isn't visible / focusable
        // yet (e.g. sheet still animating). Silent fallback — the user
        // can tap the end field themselves.
      }
    });
  };

  const datesInOrder = !startDate || !endDate || startDate <= endDate;
  const canSubmit =
    title.trim().length > 0 && !!startDate && !!endDate && datesInOrder;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setOverlap(null);
    createTrip.mutate(
      { title: title.trim(), startDate, endDate },
      {
        onSuccess: (trip) => {
          onClose();
          const suffix = isDemo ? "&demo=true" : "";
          router.push(`/m/trip?id=${trip.id}&v=carousel${suffix}`);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) {
            const body = err.body as { overlappingTrips?: OverlapInfo[] };
            if (body?.overlappingTrips) {
              setOverlap(body.overlappingTrips);
            }
          }
        },
      },
    );
  };

  return (
    <>
      <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-1">
        <div className="min-w-0 flex-1">
          <p className="text-kicker font-semibold text-muted-foreground">
            Trip
          </p>
          <h2 className="mt-0.5 text-lg font-semibold leading-snug">
            New trip
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
        onSubmit={handleSubmit}
        className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 pb-3"
      >
        <div className="space-y-1.5">
          <label
            htmlFor="m-create-title"
            className="text-kicker font-medium text-muted-foreground"
          >
            Trip name
          </label>
          <input
            id="m-create-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Italy Summer 2026"
            autoFocus
            className="h-11 w-full rounded-xl border bg-background px-3 text-base text-foreground outline-none focus:border-foreground"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label
              htmlFor="m-create-start"
              className="text-kicker font-medium text-muted-foreground"
            >
              Start
            </label>
            <input
              id="m-create-start"
              type="date"
              value={startDate}
              onChange={(e) => {
                const next = e.target.value;
                setStartDate(next);
                setOverlap(null);
                if (next) openEndPicker();
              }}
              className="h-11 w-full rounded-xl border bg-background px-3 text-base text-foreground outline-none focus:border-foreground"
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="m-create-end"
              className="text-kicker font-medium text-muted-foreground"
            >
              End
            </label>
            <input
              ref={endDateRef}
              id="m-create-end"
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
          onClick={handleSubmit}
          disabled={!canSubmit || createTrip.isPending}
          className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {createTrip.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Create
        </button>
      </div>
    </>
  );
}
