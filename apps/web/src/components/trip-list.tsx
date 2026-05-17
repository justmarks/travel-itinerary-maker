"use client";

import { useMemo, useState } from "react";
import { useTrips } from "@itinly/api-client";
import type { TripSummary } from "@itinly/api-client";
import { ChevronDown, ChevronUp } from "lucide-react";
import { TripCard } from "./trip-card";
import {
  StillLoadingHint,
  TripCardSkeleton,
  useDelayedLoadingHint,
} from "./trip-card-skeleton";
import { AppLogo } from "./app-logo";
import { describeError } from "@/lib/api-error";
import {
  BUCKET_LABEL,
  groupTripsByBucket,
  todayLocalISO,
  type TripBucket,
} from "@/lib/trip-buckets";

export function TripList(): React.JSX.Element {
  const { data: trips, isLoading, error, refetch } = useTrips();

  const today = useMemo(() => todayLocalISO(), []);

  // Mirror the mobile trip list grouping: Now / Upcoming / Past, with the
  // "Past" section collapsible. Sourced from `lib/trip-buckets.ts` so the
  // two surfaces share one bucketing rule. No status-based filter here —
  // mobile shows every trip in its date bucket regardless of status, and
  // the Past collapse is enough to hide finished trips by default.
  const buckets = useMemo(
    () => groupTripsByBucket(trips ?? [], today),
    [trips, today],
  );

  const visibleCount =
    buckets.current.length + buckets.upcoming.length + buckets.past.length;

  if (isLoading) {
    return <TripListLoading />;
  }

  if (error) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        <div className="min-w-0 flex-1">
          <p className="font-medium">Failed to load trips</p>
          <p className="mt-1 text-xs opacity-75">{describeError(error)}</p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="shrink-0 rounded-md border border-current px-3 py-1 text-xs font-medium hover:bg-destructive/10"
        >
          Retry
        </button>
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
    <div className="space-y-6">
      {visibleCount === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <AppLogo className="mb-4 h-12 w-12 opacity-60" />
          <h3 className="text-lg font-medium">No upcoming trips</h3>
        </div>
      ) : (
        <>
          <TripBucketSection bucket="current" trips={buckets.current} />
          <TripBucketSection bucket="upcoming" trips={buckets.upcoming} />
          <TripBucketSection bucket="past" trips={buckets.past} collapsible />
        </>
      )}
    </div>
  );
}

function TripBucketSection({
  bucket,
  trips,
  collapsible = false,
}: {
  bucket: TripBucket;
  trips: TripSummary[];
  collapsible?: boolean;
}): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(!collapsible);

  if (trips.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-kicker font-semibold text-muted-foreground">
          {BUCKET_LABEL[bucket]}
          <span className="ml-1.5 text-muted-foreground/60">{trips.length}</span>
        </h2>
        {collapsible && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Hide" : "Show"} ${BUCKET_LABEL[bucket].toLowerCase()} trips`}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3 w-3" />
                Hide
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" />
                Show
              </>
            )}
          </button>
        )}
      </div>
      {expanded && (
        <div className="grid items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {trips.map((trip) => (
            <TripCard key={trip.id} trip={trip} />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Loading state for the desktop trip list — three card-shaped
 * skeletons in the same grid the real cards land in, plus a delayed
 * "Still loading..." caption so a slow first-login fetch doesn't
 * feel broken. Splits out from `TripList` so the hook only runs
 * during the loading branch (fewer effects on the happy path).
 */
function TripListLoading(): React.JSX.Element {
  const showHint = useDelayedLoadingHint();
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <TripCardSkeleton />
        <TripCardSkeleton />
        <TripCardSkeleton />
      </div>
      <StillLoadingHint show={showHint} />
    </div>
  );
}
