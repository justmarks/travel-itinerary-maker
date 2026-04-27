"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTrip } from "@travel-app/api-client";
import { RequireAuth } from "@/components/require-auth";
import { useDemoHref } from "@/lib/demo";
import {
  MobileFrame,
  MobileHeader,
  ViewSwitcher,
} from "@/components/mobile/mobile-shell";
import { MobileFeedView } from "@/components/mobile/mobile-feed-view";
import { MobileCarouselView } from "@/components/mobile/mobile-carousel-view";

function fmtRange(start: string, end: string) {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const fmt = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-US", opts);
  return `${fmt(start)} – ${fmt(end)}`;
}

function MobileTripInner({ tripId, view }: { tripId: string; view: "feed" | "carousel" }) {
  const { data: trip, isLoading } = useTrip(tripId);
  const homeHref = useDemoHref("/m");
  const feedHref = useDemoHref(`/m/trip?id=${tripId}&v=feed`);
  const carouselHref = useDemoHref(`/m/trip?id=${tripId}&v=carousel`);

  if (isLoading) {
    return (
      <MobileFrame>
        <MobileHeader title="Loading…" backHref={homeHref} />
        <div className="flex-1 animate-pulse space-y-3 p-4">
          <div className="h-24 rounded-2xl bg-muted" />
          <div className="h-24 rounded-2xl bg-muted" />
          <div className="h-24 rounded-2xl bg-muted" />
        </div>
        <ViewSwitcher active={view} feedHref={feedHref} carouselHref={carouselHref} />
      </MobileFrame>
    );
  }

  if (!trip) {
    return (
      <MobileFrame>
        <MobileHeader title="Trip not found" backHref={homeHref} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t find that trip.
          </p>
          <Link
            href={homeHref}
            className="rounded-full border bg-background px-4 py-2 text-sm font-medium"
          >
            Back to trips
          </Link>
        </div>
      </MobileFrame>
    );
  }

  return (
    <MobileFrame>
      <MobileHeader
        title={trip.title}
        subtitle={`${fmtRange(trip.startDate, trip.endDate)} · ${trip.days.length} days`}
        backHref={homeHref}
      />
      {view === "feed" ? (
        <MobileFeedView trip={trip} />
      ) : (
        <MobileCarouselView trip={trip} />
      )}
      <ViewSwitcher active={view} feedHref={feedHref} carouselHref={carouselHref} />
    </MobileFrame>
  );
}

function MobileTripPageInner() {
  const searchParams = useSearchParams();
  const tripId = searchParams.get("id");
  const homeHref = useDemoHref("/m");
  const viewParam = searchParams.get("v");
  const view: "feed" | "carousel" = viewParam === "carousel" ? "carousel" : "feed";

  if (!tripId) {
    return (
      <MobileFrame>
        <MobileHeader title="No trip" backHref={homeHref} />
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          No trip selected.
        </div>
      </MobileFrame>
    );
  }

  return <MobileTripInner tripId={tripId} view={view} />;
}

export default function MobileTripPage(): React.JSX.Element {
  return (
    <RequireAuth>
      <Suspense
        fallback={
          <MobileFrame>
            <div className="flex flex-1 items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            </div>
          </MobileFrame>
        }
      >
        <MobileTripPageInner />
      </Suspense>
    </RequireAuth>
  );
}
