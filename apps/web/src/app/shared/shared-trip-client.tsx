"use client";

import { useSharedTrip } from "@travel-app/api-client";
import { ItineraryDay } from "@/components/itinerary-day";
import { Calendar, MapPin, Pencil, Plane } from "lucide-react";

function formatDateRange(start: string, end: string) {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
  const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", opts);
  return `${fmt(start)} – ${fmt(end)}`;
}

export default function SharedTripClient({ token }: { token: string }): React.JSX.Element {
  const { data: trip, isLoading } = useSharedTrip(token);

  if (isLoading) {
    return (
      <main className="min-h-screen p-8">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="h-64 animate-pulse rounded-xl border bg-muted" />
        </div>
      </main>
    );
  }

  if (!trip) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Plane className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
          <h1 className="text-xl font-semibold">Trip not found</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This share link may have expired or been removed.
          </p>
        </div>
      </main>
    );
  }

  const isEditShare = trip.permission === "edit";

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Shared itinerary
          </p>
          <h1 className="text-2xl font-bold">{trip.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              {formatDateRange(trip.startDate, trip.endDate)}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              {trip.days.length} {trip.days.length === 1 ? "day" : "days"}
            </span>
          </div>
        </div>

        {isEditShare && (
          <div className="mb-6 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <Pencil className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>Edit access</strong> — editing shared trips ships in the
              next release. For now you can view everything; once contributor
              edit lands you&apos;ll be able to make changes here.
            </span>
          </div>
        )}

        <div className="flex flex-col gap-8">
          {trip.days.map((day) => (
            <ItineraryDay key={day.date} day={day} readOnly />
          ))}
        </div>

        {trip.todos.length > 0 && (
          <div className="mt-8 rounded-xl border p-5">
            <h2 className="mb-3 font-semibold">To-do</h2>
            <ul className="flex flex-col gap-1 text-sm">
              {[...trip.todos]
                .sort(
                  (a, b) =>
                    Number(a.isCompleted) - Number(b.isCompleted) ||
                    a.sortOrder - b.sortOrder,
                )
                .map((todo) => (
                  <li key={todo.id} className="flex items-center gap-2">
                    <span className={todo.isCompleted ? "text-muted-foreground line-through" : ""}>
                      {todo.isCompleted ? "✓" : "○"} {todo.text}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
}
