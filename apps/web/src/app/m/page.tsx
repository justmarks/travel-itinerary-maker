"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useDeleteShare, useTrips } from "@travel-app/api-client";
import type { TripSummary } from "@travel-app/api-client";
import {
  AlertCircle,
  Calendar,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  CloudOff,
  LogOut,
  MoreVertical,
  Plus,
  Users,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RequireAuth } from "@/components/require-auth";
import { toastMutationError } from "@/lib/api-error";
import { useConfirm } from "@/lib/confirm-dialog";
import { useDemoMode } from "@/lib/demo";
import { useOnlineStatus } from "@/lib/use-online-status";
import { useCachedTripIds } from "@/lib/use-cached-trips";
import { MobileFrame } from "@/components/mobile/mobile-shell";
import { MobileUserMenu } from "@/components/mobile/mobile-user-menu";
import { MobileCreateTripSheet } from "@/components/mobile/mobile-create-trip-sheet";
import { MobileEmailScanSheet } from "@/components/mobile/mobile-email-scan-sheet";
import { MobileAutoShareSheet } from "@/components/mobile/mobile-auto-share-sheet";
import {
  MobileTripRowSkeleton,
  StillLoadingHint,
  useDelayedLoadingHint,
} from "@/components/trip-card-skeleton";
import { AppLogo } from "@/components/app-logo";
import { DriveScopeBanner } from "@/components/drive-scope-banner";
import {
  daysUntil,
  flagEmoji,
  gradientFor,
  useCityImage,
} from "@/lib/trip-card-visuals";
import {
  BUCKET_LABEL,
  groupTripsByBucket,
  todayLocalISO,
  type TripBucket,
} from "@/lib/trip-buckets";

function fmtRange(start: string, end: string) {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const fmt = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-US", opts);
  const yr = new Date(end + "T00:00:00").getFullYear();
  return `${fmt(start)} – ${fmt(end)}, ${yr}`;
}


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
        // <img> instead of next/image, and why `crossOrigin="anonymous"`
        // is required by our COEP `credentialless` header.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image.url}
          alt={trip.title}
          loading="lazy"
          crossOrigin="anonymous"
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
        <span className="absolute left-2 top-2 z-10 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-zinc-900 shadow-sm backdrop-blur-sm">
          {countdownLabel}
        </span>
      )}
      {trip.sharedFromEmail && (
        // Shared-with-you marker. Stacks below the countdown when both
        // are present so the top-left corner doesn't get crowded — and
        // the top-right corner stays clear for the leave menu.
        <span
          className="absolute left-2 z-10 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-zinc-900 shadow-sm backdrop-blur-sm"
          style={{ top: countdownLabel ? "2.25rem" : "0.5rem" }}
        >
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

/**
 * Tiny corner menu on a shared trip row that lets the recipient remove
 * themselves from the trip. Stops click propagation so tapping the menu
 * doesn't also follow the parent <Link>. Only renders when the server
 * surfaced this row's `sharedShareId`.
 */
function MobileTripCardLeaveMenu({
  trip,
}: {
  trip: TripSummary;
}): React.JSX.Element | null {
  const router = useRouter();
  const confirm = useConfirm();
  const deleteShare = useDeleteShare(trip.id);

  if (!trip.sharedShareId) return null;

  const handleLeave = async () => {
    if (!trip.sharedShareId) return;
    const ok = await confirm({
      title: `Leave "${trip.title}"?`,
      description:
        "You'll lose access to this trip — the owner will be notified.",
      confirmText: "Leave",
      destructive: true,
    });
    if (!ok) return;
    deleteShare.mutate(trip.sharedShareId, {
      onSuccess: () => {
        router.push("/m");
      },
      onError: toastMutationError("leave trip"),
    });
  };

  return (
    <div
      className="absolute right-1.5 top-1.5 z-20"
      // The card itself is a single tap target. Absorb pointer events on
      // the menu so they don't bubble up and navigate into the trip.
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More trip actions"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/85 text-zinc-900 shadow-sm backdrop-blur-sm hover:bg-white"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={handleLeave}
            disabled={deleteShare.isPending}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Leave trip
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
              <span className="inline-flex items-center gap-0.5" style={{ color: "var(--status-warn-fg)" }}>
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
    <div className="relative">
      <Link
        href={href}
        className="group flex flex-col overflow-hidden rounded-2xl border bg-card transition-transform active:scale-[0.99] active:bg-muted/40"
      >
        {meta}
      </Link>
      <MobileTripCardLeaveMenu trip={trip} />
    </div>
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
      <h2 className="text-kicker font-semibold text-muted-foreground">
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

function MobileTripList({
  onCreateTrip,
}: {
  onCreateTrip: () => void;
}) {
  const { data: trips, isLoading, isError, refetch } = useTrips();
  const isDemo = useDemoMode();
  const online = useOnlineStatus();
  const cachedIds = useCachedTripIds();
  const today = useMemo(() => todayLocalISO(), []);
  const hrefSuffix = isDemo ? "&demo=true" : "";

  const buckets = useMemo(
    () => groupTripsByBucket(trips ?? [], today),
    [trips, today],
  );

  if (isLoading) {
    return <MobileTripListLoading />;
  }

  // Only surface the error UI when we have nothing cached to show. A
  // failed background refetch (e.g. the device just woke from sleep with
  // a stale auth token) shouldn't blow away the trips list — RQ keeps
  // the previous successful `data`, and the next retry will silently
  // refresh it.
  if (isError && !trips) {
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
          Plan a trip from your phone — pick a name and dates and you&apos;re off.
        </p>
        <button
          type="button"
          onClick={onCreateTrip}
          className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background active:scale-[0.98]"
        >
          <Plus className="h-4 w-4" />
          Create your first trip
        </button>
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

/**
 * Loading state for the mobile trip list — three card-shaped row
 * skeletons in the same layout the real rows land in, plus a delayed
 * "Still loading..." caption. Replaces the old plain-bg-muted blocks
 * that read as "blank page" on first login when there's no React
 * Query cache to fall back to.
 */
function MobileTripListLoading(): React.JSX.Element {
  const showHint = useDelayedLoadingHint();
  return (
    <div className="flex flex-col gap-3 px-3 py-3">
      <MobileTripRowSkeleton />
      <MobileTripRowSkeleton />
      <MobileTripRowSkeleton />
      <StillLoadingHint show={showHint} className="pt-2" />
    </div>
  );
}

function MobileHomeContent(): React.JSX.Element {
  const [createOpen, setCreateOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [autoShareOpen, setAutoShareOpen] = useState(false);
  return (
    <MobileFrame>
      <header className="sticky top-0 z-30 flex shrink-0 items-center gap-2 border-b border-border/60 bg-background/85 px-4 py-3 backdrop-blur">
        <AppLogo className="h-7 w-7" />
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-bold leading-tight">My Trips</h1>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          aria-label="Create trip"
          className="flex h-9 w-9 items-center justify-center rounded-full text-foreground/80 hover:bg-muted active:bg-muted/80"
        >
          <Plus className="h-5 w-5" />
        </button>
        <MobileUserMenu
          onScanEmails={() => setScanOpen(true)}
          onAutoShare={() => setAutoShareOpen(true)}
        />
      </header>
      <div className="flex-1 overflow-y-auto pb-6">
        <div className="pt-3">
          <DriveScopeBanner variant="mobile" />
        </div>
        <MobileTripList onCreateTrip={() => setCreateOpen(true)} />
      </div>
      <MobileCreateTripSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
      <MobileEmailScanSheet
        open={scanOpen}
        onClose={() => setScanOpen(false)}
      />
      <MobileAutoShareSheet
        open={autoShareOpen}
        onClose={() => setAutoShareOpen(false)}
      />
    </MobileFrame>
  );
}

export default function MobileHomePage(): React.JSX.Element {
  return (
    <RequireAuth>
      <MobileHomeContent />
    </RequireAuth>
  );
}
