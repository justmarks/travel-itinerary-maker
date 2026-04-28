"use client";

import Link from "next/link";
import { useTrips } from "@travel-app/api-client";
import {
  AlertCircle,
  CalendarDays,
  ChevronRight,
  MapPin,
} from "lucide-react";
import { RequireAuth } from "@/components/require-auth";
import { useDemoMode } from "@/lib/demo";
import { MobileFrame } from "@/components/mobile/mobile-shell";
import { MobileUserMenu } from "@/components/mobile/mobile-user-menu";
import { AppLogo } from "@/components/app-logo";

function fmtRange(start: string, end: string) {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const fmt = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-US", opts);
  const yr = new Date(end + "T00:00:00").getFullYear();
  return `${fmt(start)} – ${fmt(end)}, ${yr}`;
}

function MobileTripList() {
  const { data: trips, isLoading, isError, refetch } = useTrips();
  const isDemo = useDemoMode();

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
      <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <AppLogo className="h-10 w-10 opacity-60" />
        <p className="text-sm font-medium">No trips yet</p>
        <p className="text-xs text-muted-foreground">
          Create one on the desktop site to see it here.
        </p>
      </div>
    );
  }

  const sorted = [...trips].sort((a, b) =>
    a.startDate.localeCompare(b.startDate),
  );

  return (
    <div className="flex flex-col gap-2.5 p-4">
      {sorted.map((trip) => {
        const href = `/m/trip?id=${trip.id}&v=carousel${isDemo ? "&demo=true" : ""}`;
        return (
          <Link
            key={trip.id}
            href={href}
            className="group flex items-center gap-3 rounded-2xl border bg-card p-4 transition-transform active:scale-[0.99] active:bg-muted/40"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-zinc-800 to-zinc-600 text-white">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{trip.title}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {fmtRange(trip.startDate, trip.endDate)}
              </p>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="capitalize">{trip.status}</span>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-0.5">
                  <MapPin className="h-3 w-3" />
                  {trip.dayCount} {trip.dayCount === 1 ? "day" : "days"}
                </span>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        );
      })}
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
