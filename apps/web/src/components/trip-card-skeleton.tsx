"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Loading-state placeholders for the trip list.
 *
 * Replacing the old plain `bg-muted` rectangles — those read as
 * "blank page with white tiles" on first login when the API is slow
 * (no React Query cache to fall back to). The skeletons below mirror
 * the actual `TripCard` (desktop) and `MobileTripHero` + `TripRow`
 * (mobile) shapes so the page never looks empty: hero band with a
 * subtle multi-stop gradient (echoing the deterministic gradients
 * real cards generate from the city seed), then content lines for
 * the title / date / status row. Same `animate-pulse` opacity loop
 * the rest of the codebase uses.
 *
 * `useDelayedLoadingHint` returns true after a short grace period so
 * we can fade in a "Still loading..." caption underneath the
 * skeletons — keeps the flicker-free fast-path quiet, but reassures
 * users on a slow connection that work is in progress.
 */

const HERO_GRADIENT =
  "linear-gradient(135deg, color-mix(in oklab, var(--seg-flight-bg) 70%, transparent), color-mix(in oklab, var(--seg-activity-bg) 70%, transparent))";

/** Desktop card skeleton — drops into the same grid cell `TripCard` does. */
export function TripCardSkeleton(): React.JSX.Element {
  return (
    <div
      className="flex h-full flex-col gap-4 overflow-hidden rounded-xl border bg-card pt-0 shadow-xs"
      aria-hidden
    >
      {/* Hero band — matches TripCardHero's h-32 */}
      <div
        className="relative h-32 w-full animate-pulse"
        style={{ background: HERO_GRADIENT }}
      >
        {/* Faint dark gradient overlay matches the real hero's bottom
            scrim so the silhouette reads as a card, not a flat block. */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-black/10 to-transparent" />
        {/* Title placeholder pinned bottom-left, where the real title sits. */}
        <div className="absolute inset-x-3 bottom-3 space-y-1.5">
          <div className="h-4 w-3/5 rounded bg-white/45" />
          <div className="h-3 w-2/5 rounded bg-white/30" />
        </div>
      </div>
      {/* Content area — date row + status pill row */}
      <div className="mt-auto space-y-2 px-6 pb-6">
        <div className="h-3 w-32 animate-pulse rounded bg-muted" />
        <div className="flex items-center gap-2">
          <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
          <div className="h-3 w-10 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}

/** Mobile row skeleton — matches the `TripRow` shape on `/m`. */
export function MobileTripRowSkeleton(): React.JSX.Element {
  return (
    <div
      className="flex flex-col overflow-hidden rounded-2xl border bg-card"
      aria-hidden
    >
      <div
        className="relative h-32 w-full animate-pulse"
        style={{ background: HERO_GRADIENT }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-black/10 to-transparent" />
        <div className="absolute inset-x-3 bottom-3 space-y-1.5">
          <div className="h-3.5 w-3/5 rounded bg-white/45" />
          <div className="h-3 w-2/5 rounded bg-white/30" />
        </div>
      </div>
      <div className="flex flex-col gap-1.5 p-3">
        <div className="h-3 w-28 animate-pulse rounded bg-muted" />
        <div className="h-2.5 w-20 animate-pulse rounded bg-muted/70" />
      </div>
    </div>
  );
}

/**
 * Returns true after `delayMs` of mount-time has elapsed. Used to
 * delay the "Still loading..." hint so quick API responses don't
 * flash unnecessary copy.
 */
export function useDelayedLoadingHint(delayMs = 2000): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShow(true), delayMs);
    return () => window.clearTimeout(t);
  }, [delayMs]);
  return show;
}

/**
 * The "Still loading..." caption — fades in once `show` flips. Keep
 * the wording soft ("Still" implies progress, not failure). Caller
 * controls when it appears via `useDelayedLoadingHint`.
 */
export function StillLoadingHint({
  show,
  className,
}: {
  show: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <p
      className={cn(
        "text-center text-xs text-muted-foreground transition-opacity duration-500",
        show ? "opacity-100" : "opacity-0",
        className,
      )}
      aria-live="polite"
    >
      Still loading your trips&hellip;
    </p>
  );
}
