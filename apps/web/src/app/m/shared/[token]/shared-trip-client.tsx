"use client";

import { useMemo, useState } from "react";
import { useSharedTrip } from "@travel-app/api-client";
import type { Segment, Todo } from "@travel-app/shared";
import { AlertCircle, Lock, MapPin, Pencil } from "lucide-react";
import { MobileFrame, MobileHeader } from "@/components/mobile/mobile-shell";
import { MobileDaysList } from "@/components/mobile/mobile-feed-view";
import { MobileSegmentDetailSheet } from "@/components/mobile/mobile-segment-detail-sheet";
import { MobileShareButton } from "@/components/mobile/mobile-share-button";

function fmtRange(start: string, end: string) {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const fmt = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-US", opts);
  return `${fmt(start)} – ${fmt(end)}`;
}

function ReadOnlyTodos({ todos }: { todos: readonly Todo[] }): React.JSX.Element | null {
  const sorted = useMemo(
    () =>
      [...todos].sort(
        (a, b) =>
          Number(a.isCompleted) - Number(b.isCompleted) ||
          a.sortOrder - b.sortOrder,
      ),
    [todos],
  );
  if (todos.length === 0) return null;
  const completed = todos.filter((t) => t.isCompleted).length;
  return (
    <section className="border-t bg-background px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        To-do · {completed}/{todos.length}
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {sorted.map((todo) => (
          <li key={todo.id} className="flex items-start gap-2 text-sm">
            <span
              className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 border-muted-foreground/40"
              aria-hidden
            >
              {todo.isCompleted && (
                <span className="block h-2 w-2 rounded-sm bg-foreground" />
              )}
            </span>
            <span
              className={
                todo.isCompleted
                  ? "text-muted-foreground line-through"
                  : "text-foreground"
              }
            >
              {todo.text}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function SharedTripClient({
  token,
}: {
  token: string;
}): React.JSX.Element {
  const { data: trip, isLoading, isError, refetch } = useSharedTrip(token);
  const [selectedSegment, setSelectedSegment] = useState<Segment | null>(null);

  const segmentDate = useMemo(() => {
    if (!trip || !selectedSegment) return undefined;
    return trip.days.find((d) =>
      d.segments.some((s) => s.id === selectedSegment.id),
    )?.date;
  }, [trip, selectedSegment]);

  const tripStats = useMemo(() => {
    if (!trip) return { cities: [] as string[] };
    const cities = new Set<string>();
    for (const day of trip.days) if (day.city) cities.add(day.city);
    return { cities: Array.from(cities) };
  }, [trip]);

  if (isLoading) {
    return (
      <MobileFrame>
        <MobileHeader title="Loading shared trip…" backHref="/" />
        <div className="flex-1 animate-pulse space-y-3 p-4">
          <div className="h-24 rounded-2xl bg-muted" />
          <div className="h-24 rounded-2xl bg-muted" />
        </div>
      </MobileFrame>
    );
  }

  if (isError || !trip) {
    return (
      <MobileFrame>
        <MobileHeader title="Shared trip" backHref="/" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm text-muted-foreground">
            This share link may have expired or been revoked.
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background"
          >
            Try again
          </button>
        </div>
      </MobileFrame>
    );
  }

  const dateRange = fmtRange(trip.startDate, trip.endDate);
  const isEditShare = trip.permission === "edit";

  return (
    <MobileFrame>
      <MobileHeader
        title={trip.title}
        subtitle={`Shared · ${dateRange}`}
        backHref="/"
        right={
          <MobileShareButton
            title={trip.title}
            text={`${trip.title} · ${dateRange}`}
          />
        }
      />

      <div className="flex-1 overflow-y-auto">
        {/* Cover: communicates the read-only nature up front. */}
        <div className="flex flex-col gap-1 border-b bg-gradient-to-br from-zinc-900 to-zinc-700 px-5 pb-5 pt-4 text-zinc-50">
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
            <Lock className="h-3 w-3" />
            Shared with you
          </span>
          <h1 className="mt-1 text-2xl font-bold leading-tight">
            {trip.title}
          </h1>
          <p className="text-sm text-zinc-200">{dateRange}</p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-200">
            <span>
              <span className="font-semibold text-zinc-50">{trip.days.length}</span>{" "}
              {trip.days.length === 1 ? "day" : "days"}
            </span>
            {tripStats.cities.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {tripStats.cities.join(" · ")}
              </span>
            )}
          </div>
        </div>

        {/* Edit-permission interstitial. The viewer can still read the trip,
            but writes go through a contributor flow that's not built yet —
            be honest about it instead of pretending the link is broken. */}
        {isEditShare && (
          <div className="flex items-start gap-2 border-b bg-amber-50 px-5 py-3 text-xs text-amber-800">
            <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <strong>Edit access</strong> — editing shared trips ships in the
              next release. For now you can view everything; once contributor
              edit lands you&apos;ll be able to make changes here.
            </span>
          </div>
        )}

        <MobileDaysList
          days={trip.days}
          onSelectSegment={setSelectedSegment}
        />

        <ReadOnlyTodos todos={trip.todos} />
      </div>

      <MobileSegmentDetailSheet
        segment={selectedSegment}
        date={segmentDate}
        onClose={() => setSelectedSegment(null)}
      />
    </MobileFrame>
  );
}

