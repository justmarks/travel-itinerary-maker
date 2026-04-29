"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTrip } from "@travel-app/api-client";
import { AlertCircle, Share2 } from "lucide-react";
import { RequireAuth } from "@/components/require-auth";
import { useDemoHref } from "@/lib/demo";
import { MobileFrame, MobileHeader } from "@/components/mobile/mobile-shell";
import { MobileCarouselView } from "@/components/mobile/mobile-carousel-view";
import { MobileShareSheet } from "@/components/mobile/mobile-share-sheet";
import { MobileUserMenu } from "@/components/mobile/mobile-user-menu";

function fmtRange(start: string, end: string) {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const fmt = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-US", opts);
  return `${fmt(start)} – ${fmt(end)}`;
}

function MobileTripInner({ tripId }: { tripId: string }) {
  const { data: trip, isLoading, isError, refetch } = useTrip(tripId);
  const homeHref = useDemoHref("/m");
  const [shareOpen, setShareOpen] = useState(false);

  if (isLoading) {
    return (
      <MobileFrame>
        <MobileHeader
          title="Loading…"
          backHref={homeHref}
          right={<MobileUserMenu />}
        />
        <div className="flex-1 animate-pulse space-y-3 p-4">
          <div className="h-24 rounded-2xl bg-muted" />
          <div className="h-24 rounded-2xl bg-muted" />
          <div className="h-24 rounded-2xl bg-muted" />
        </div>
      </MobileFrame>
    );
  }

  if (isError) {
    return (
      <MobileFrame>
        <MobileHeader
          title="Couldn't load trip"
          backHref={homeHref}
          right={<MobileUserMenu />}
        />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm text-muted-foreground">
            Something went wrong. Check your connection and try again.
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background"
          >
            Retry
          </button>
        </div>
      </MobileFrame>
    );
  }

  if (!trip) {
    return (
      <MobileFrame>
        <MobileHeader
          title="Trip not found"
          backHref={homeHref}
          right={<MobileUserMenu />}
        />
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

  const dateRange = fmtRange(trip.startDate, trip.endDate);

  return (
    <MobileFrame>
      <MobileHeader
        title={trip.title}
        subtitle={`${dateRange} · ${trip.days.length} days`}
        backHref={homeHref}
        right={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              aria-label="Share trip"
              className="flex h-9 w-9 items-center justify-center rounded-full text-foreground/80 hover:bg-muted active:bg-muted/80"
            >
              <Share2 className="h-4 w-4" />
            </button>
            <MobileUserMenu />
          </div>
        }
      />
      <MobileCarouselView trip={trip} />
      <MobileShareSheet
        tripId={trip.id}
        tripTitle={trip.title}
        open={shareOpen}
        onClose={() => setShareOpen(false)}
      />
    </MobileFrame>
  );
}

function MobileTripPageInner() {
  const searchParams = useSearchParams();
  const tripId = searchParams.get("id");
  const homeHref = useDemoHref("/m");

  if (!tripId) {
    return (
      <MobileFrame>
        <MobileHeader
          title="No trip"
          backHref={homeHref}
          right={<MobileUserMenu />}
        />
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
          No trip selected.
        </div>
      </MobileFrame>
    );
  }

  return <MobileTripInner tripId={tripId} />;
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
