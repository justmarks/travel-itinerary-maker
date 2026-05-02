"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useTrips } from "@travel-app/api-client";
import type { TripSummary } from "@travel-app/api-client";
import {
  AlertCircle,
  Calendar,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  CloudOff,
  Plus,
  Users,
} from "lucide-react";
import { RequireAuth } from "@/components/require-auth";
import { useDemoMode } from "@/lib/demo";
import { useOnlineStatus } from "@/lib/use-online-status";
import { useCachedTripIds } from "@/lib/use-cached-trips";
import { MobileFrame } from "@/components/mobile/mobile-shell";
import { MobileUserMenu } from "@/components/mobile/mobile-user-menu";
import { AppLogo } from "@/components/app-logo";
import {
  daysUntil,
  flagEmoji,
  gradientFor,
  useCityImage,
} from "@/lib/trip-card-visuals";

type TripBucket = "current" | "upcoming" | "past";

function fmtRange(start: string, end: string) {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const fmt = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-US", opts);
  const yr = new Date(end + "T00:00:00").getFullYear();
  return `${fmt(start)} – ${fmt(end)}, ${yr}`;
}

/**
 * Returns the local-date YYYY-MM-DD string. Compared against the trip's
 * `startDate` / `endDate` (also YYYY-MM-DD) to bucket into now / upcoming /
 * past. Avoids timezone surprises by using the user's local calendar day
 * rather than UTC.
 */
function todayLocalISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function bucketTrip(trip: TripSummary, today: string): TripBucket {
  if (trip.endDate < today) return "past";
  if (trip.startDate > today) return "upcoming";
  return "current";
}

const BUCKET_LABEL: Record<TripBucket, string> = {
  current: "Now",
  upcoming: "Upcoming",
  past: "Past",
};

/**
 * Hero band rendered above every mobile TripRow. Mirrors the desktop
 * TripCard hero: city photo from Wikipedia, deterministic gradient
 * fallback, country flag + trip title overlaid bottom-left, and an
 * upcoming-trip countdown top-right.
 */
function MobileTripHero({ trip }: { trip: TripSummary }) {
  const image = useCityImage(trip.primaryCity, trip.primaryCountry);
  const flag = flagEmoji(trip.primaryCountryCode);
  const seed = trip.primaryCity ?? trip.title;
  const gradient = gradientFor(seed);
  const delta = daysUntil(trip.startDate);
  const showCountdown = delta > 0 && delta <= 60 && trip.status !== "cancelled";
  const countdownLabel =
    delta === 1 ? "Tomorrow" : showCountdown ? `In ${delta} days` : null;

  return (
    <div
      className="relative h-32 w-full overflow-hidden"
      style={{
        backgroundImage: `linear-gradient(135deg, ${gradient.from}, ${gradient.to})`,
      }}
    >
      {image ? (
        // Wikipedia thumbnails — see trip-card.tsx for why we use a plain
        // <img> instead of next/image.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image.url}
          alt={trip.title}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        !trip.primaryCity && (
          <div className="absolute inset-0 flex items-center justify-center text-white/70">
            <CalendarDays className="h-7 w-7" />
          </div>
        )
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
      {countdownLabel && (
        <span className="absolute right-2 top-2 z-10 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-zinc-900 shadow-sm backdrop-blur-sm">
          {countdownLabel}
        </span>
      )}
      {trip.sharedFromEmail && (
        <span className="absolute left-2 top-2 z-10 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-zinc-900 shadow-sm backdrop-blur-sm">
          <Users className="h-3 w-3" />
          {trip.sharedPermission === "edit" ? "Editor" : "Shared"}
        </span>
      )}
      <div className="absolute bottom-2 left-3 right-3 flex items-end gap-2 text-white">
        {flag && (
          <span className="flag-font text-2xl leading-none drop-shadow-sm" aria-hidden>
            {flag}
          </span>
        )}
        <span className="line-clamp-2 text-base font-semibold leading-tight drop-shadow-sm">
          {trip.title}
        </span>
      </div>
    </div>
  );
}

function TripRow({
  trip,
  hrefSuffix,
  unavailable,
}: {
  trip: TripSummary;
  hrefSuffix: string;
  /**
   * True when the device is offline AND this trip's data isn't in the
   * React Query cache. Renders the row dimmed with an "Offline" badge
   * and intercepts clicks to toast instead of navigating to a page that
   * would just spin (and, if the SW falls back to the /m shell, would
   * effectively reload the list and collapse the Past section).
   */
  unavailable: boolean;
}) {
  const href = `/m/trip?id=${trip.id}&v=carousel${hrefSuffix}`;
  const meta = (
    <>
      <MobileTripHero trip={trip} />
      <div className="flex flex-col gap-1 p-3">
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          {fmtRange(trip.startDate, trip.endDate)}
        </p>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="capitalize">{trip.status}</span>
          <span aria-hidden>·</span>
          <span>
            {trip.dayCount} {trip.dayCount === 1 ? "day" : "days"}
          </span>
          {unavailable && (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-0.5 text-amber-700 dark:text-amber-400">
                <CloudOff className="h-3 w-3" />
                Offline — not loaded
              </span>
            </>
          )}
        </div>
      </div>
    </>
  );

  if (unavailable) {
    return (
      <button
        type="button"
        onClick={() =>
          toast.error("Not available offline", {
            description:
              "Open this trip while online once and it'll be available next time you're offline.",
          })
        }
        className="group flex flex-col overflow-hidden rounded-2xl border bg-card text-left opacity-60 transition-transform active:scale-[0.99]"
        aria-disabled="true"
      >
        {meta}
      </button>
    );
  }

  return (
    <Link
      href={href}
      className="group flex flex-col overflow-hidden rounded-2xl border bg-card transition-transform active:scale-[0.99] active:bg-muted/40"
    >
      {meta}
    </Link>
  );
}

function Section({
  bucket,
  trips,
  hrefSuffix,
  collapsible = false,
  cachedIds,
  online,
}: {
  bucket: TripBucket;
  trips: TripSummary[];
  hrefSuffix: string;
  collapsible?: boolean;
  cachedIds: Set<string>;
  online: boolean;
}) {
  const [expanded, setExpanded] = useState(!collapsible);

  if (trips.length === 0) return null;

  const heading = (
    <div className="flex items-center justify-between px-1 pb-1.5 pt-1">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {BUCKET_LABEL[bucket]}
        <span className="ml-1.5 text-muted-foreground/60">{trips.length}</span>
      </h2>
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
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
  );

  return (
    <section className="flex flex-col gap-2 px-3">
      {heading}
      {expanded && (
        <div className="flex flex-col gap-2.5">
          {trips.map((trip) => (
            <TripRow
              key={trip.id}
              trip={trip}
              hrefSuffix={hrefSuffix}
              unavailable={!online && !cachedIds.has(trip.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function MobileTripList() {
  const { data: trips, isLoading, isError, refetch } = useTrips();
  const isDemo = useDemoMode();
  const online = useOnlineStatus();
  const cachedIds = useCachedTripIds();
  const today = useMemo(() => todayLocalISO(), []);
  const hrefSuffix = isDemo ? "&demo=true" : "";

  const buckets = useMemo(() => {
    const empty = { current: [] as TripSummary[], upcoming: [] as TripSummary[], past: [] as TripSummary[] };
    if (!trips) return empty;
    const grouped: Record<TripBucket, TripSummary[]> = {
      current: [],
      upcoming: [],
      past: [],
    };
    for (const trip of trips) {
      grouped[bucketTrip(trip, today)].push(trip);
    }
    // Now: by start ascending. Upcoming: by start ascending (next first).
    // Past: by start descending (most recent first).
    grouped.current.sort((a, b) => a.startDate.localeCompare(b.startDate));
    grouped.upcoming.sort((a, b) => a.startDate.localeCompare(b.startDate));
    grouped.past.sort((a, b) => b.startDate.localeCompare(a.startDate));
    return grouped;
  }, [trips, today]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl border bg-muted" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-sm font-medium">Couldn&apos;t load trips</p>
        <p className="text-xs text-muted-foreground">
          Check your connection and try again.
        </p>
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-1 rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!trips || trips.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <AppLogo className="h-10 w-10 opacity-60" />
        <p className="text-sm font-medium">No trips yet</p>
        <p className="max-w-[260px] text-xs text-muted-foreground">
          Trip creation lives on the desktop site for now. Tap below to
          jump over and set one up.
        </p>
        <Link
          href="/?desktop=1&new=1"
          className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          Create your first trip
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 py-3">
      <Section
        bucket="current"
        trips={buckets.current}
        hrefSuffix={hrefSuffix}
        cachedIds={cachedIds}
        online={online}
      />
      <Section
        bucket="upcoming"
        trips={buckets.upcoming}
        hrefSuffix={hrefSuffix}
        cachedIds={cachedIds}
        online={online}
      />
      <Section
        bucket="past"
        trips={buckets.past}
        hrefSuffix={hrefSuffix}
        collapsible
        cachedIds={cachedIds}
        online={online}
      />
    </div>
  );
}

export default function MobileHomePage(): React.JSX.Element {
  return (
    <RequireAuth>
      <MobileFrame>
        <header className="sticky top-0 z-30 flex shrink-0 items-center gap-2 border-b border-border/60 bg-background/85 px-4 py-3 backdrop-blur">
          <AppLogo className="h-7 w-7" />
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-bold leading-tight">My Trips</h1>
          </div>
          <MobileUserMenu />
        </header>
        <div className="flex-1 overflow-y-auto pb-6">
          <MobileTripList />
        </div>
      </MobileFrame>
    </RequireAuth>
  );
}
