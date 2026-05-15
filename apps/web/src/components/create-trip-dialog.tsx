"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCreateTrip } from "@itinly/api-client";
import { ApiError } from "@itinly/api-client";
import { useDemoMode } from "@/lib/demo";
import { toastMutationError } from "@/lib/api-error";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, AlertCircle, Loader2 } from "lucide-react";

interface OverlapInfo {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
}

export function CreateTripDialog({
  defaultOpen = false,
}: { defaultOpen?: boolean } = {}): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [overlapError, setOverlapError] = useState<OverlapInfo[] | null>(null);
  const createTrip = useCreateTrip();
  const isDemo = useDemoMode();
  const endDateRef = useRef<HTMLInputElement>(null);

  /**
   * Hand off from the start picker to the end picker the moment a start
   * date is chosen, so the user gets a single fluid "click start → pick
   * date → pick date → done" flow instead of having to manually open the
   * end input. `showPicker` is supported in every browser we target
   * (Chrome 99+, Firefox 101+, Safari 16+) and is a no-op anywhere it
   * isn't — the user falls back to clicking the end input themselves.
   *
   * Wrapped in a microtask so React has flushed the state update and the
   * end input has rendered with its new `min` attribute before the
   * picker opens; calling synchronously inside onChange occasionally
   * showed the picker against stale DOM.
   */
  const openEndPicker = () => {
    queueMicrotask(() => {
      const el = endDateRef.current;
      if (!el || typeof el.showPicker !== "function") return;
      try {
        el.showPicker();
      } catch {
        // showPicker throws if the input isn't visible / focusable yet
        // (e.g. dialog still animating). The user can click the end
        // field themselves; not worth surfacing.
      }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setOverlapError(null);
    createTrip.mutate(
      { title, startDate, endDate },
      {
        onSuccess: (trip) => {
          setOpen(false);
          setTitle("");
          setStartDate("");
          setEndDate("");
          setOverlapError(null);
          router.push(
            isDemo
              ? `/trips/?id=${trip.id}&demo=true`
              : `/trips/?id=${trip.id}`,
          );
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) {
            const body = error.body as { overlappingTrips?: OverlapInfo[] };
            if (body.overlappingTrips) {
              setOverlapError(body.overlappingTrips);
              return;
            }
          }
          toastMutationError("create trip")(error);
        },
      },
    );
  };

  const isValid = title.trim() && startDate && endDate && startDate <= endDate;

  const formatDate = (iso: string) => {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setOverlapError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">New Trip</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a new trip</DialogTitle>
          <DialogDescription>
            Give your trip a name and pick the dates you&apos;ll be away.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Trip name</Label>
            <Input
              id="title"
              placeholder="e.g. Italy Summer 2026"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="startDate">Start date</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => {
                  const next = e.target.value;
                  setStartDate(next);
                  setOverlapError(null);
                  // Default the end date to the start so a one-day trip
                  // can be created from a single picker if the user
                  // dismisses the end picker without picking again.
                  if (next && (!endDate || endDate < next)) {
                    setEndDate(next);
                  }
                  if (next) openEndPicker();
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">End date</Label>
              <Input
                ref={endDateRef}
                id="endDate"
                type="date"
                value={endDate}
                min={startDate || undefined}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setOverlapError(null);
                }}
              />
            </div>
          </div>
          {startDate && endDate && startDate > endDate && (
            <p className="text-sm text-destructive">
              End date must be on or after start date.
            </p>
          )}
          {overlapError && (
            <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-left text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">
                  These dates overlap with an existing trip:
                </p>
                <ul className="mt-1 space-y-1">
                  {overlapError.map((trip) => (
                    <li key={trip.id}>
                      <span className="font-medium">{trip.title}</span>{" "}
                      <span className="text-xs opacity-75">
                        ({formatDate(trip.startDate)} &ndash;{" "}
                        {formatDate(trip.endDate)})
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs opacity-75">
                  Check the dates or consider extending the existing trip
                  instead.
                </p>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!isValid || createTrip.isPending}
            >
              {createTrip.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Creating…
                </>
              ) : (
                "Create trip"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
