"use client";

import { useCallback, useMemo, useState } from "react";
import { useTrips } from "@travel-app/api-client";
import { TripCard } from "./trip-card";
import { AppLogo } from "./app-logo";
import { Button } from "@/components/ui/button";

export function TripList(): React.JSX.Element {
  const { data: trips, isLoading, error } = useTrips();
  const [showCompleted, setShowCompleted] = useState(false);

  // A trip is "completed" for the purposes of this toggle when its status
  // is explicitly completed or cancelled. End-date is NOT part of the
  // rule — an upcoming trip with status=planning stays visible even if
  // the user never gets around to closing it out, and a trip marked
  // completed a day early is still hidden.
  const isCompleted = useCallback(
    (t: { status: string }) =>
      t.status === "completed" || t.status === "cancelled",
    [],
  );

  const completedCount = useMemo(
    () => trips?.filter(isCompleted).length ?? 0,
    [trips, isCompleted],
  );

  const visibleTrips = useMemo(() => {
    if (!trips) return [];
    const filtered = showCompleted
      ? trips
      : trips.filter((t) => !isCompleted(t));
    // Ascending by startDate (ISO YYYY-MM-DD sorts lexicographically)
    return [...filtered].sort((a, b) => a.startDate.localeCompare(b.startDate));
  }, [trips, showCompleted, isCompleted]);

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-36 animate-pulse rounded-xl border bg-muted"
          />
        ))}
      </div>
    );
  }

  if (error) {
    const detail =
      error instanceof Error ? error.message : "Unknown error";
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        <p className="font-medium">Failed to load trips</p>
        <p className="mt-1 text-xs opacity-75">{detail}</p>
      </div>
    );
  }

  if (!trips?.length) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
        <AppLogo className="mb-4 h-12 w-12 opacity-60" />
        <h3 className="text-lg font-medium">No trips yet</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Create your first trip to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {visibleTrips.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <AppLogo className="mb-4 h-12 w-12 opacity-60" />
          <h3 className="text-lg font-medium">No upcoming trips</h3>
          {completedCount > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">
              You have {completedCount} completed{" "}
              {completedCount === 1 ? "trip" : "trips"} hidden.
            </p>
          )}
        </div>
      ) : (
        <div className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleTrips.map((trip) => (
            <TripCard key={trip.id} trip={trip} />
          ))}
        </div>
      )}

      {completedCount > 0 && (
        <div className="flex justify-center pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowCompleted((v) => !v)}
          >
            {showCompleted
              ? `Hide completed trips (${completedCount})`
              : `Show completed trips (${completedCount})`}
          </Button>
        </div>
      )}
    </div>
  );
}
