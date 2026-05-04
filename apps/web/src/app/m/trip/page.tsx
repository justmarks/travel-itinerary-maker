"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useDeleteShare, useDeleteTrip, useTrip } from "@travel-app/api-client";
import type { Trip } from "@travel-app/shared";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckSquare,
  CloudOff,
  DollarSign,
  History,
  LogOut,
  MoreVertical,
  Share2,
  Trash2,
} from "lucide-react";
import { RequireAuth } from "@/components/require-auth";
import { useDemoHref } from "@/lib/demo";
import { useOnlineStatus } from "@/lib/use-online-status";
import { useTripPermission } from "@/lib/use-trip-permission";
import { MobileFrame, MobileHeader } from "@/components/mobile/mobile-shell";
import { MobileCarouselView } from "@/components/mobile/mobile-carousel-view";
import { MobileCostsSheet } from "@/components/mobile/mobile-costs-sheet";
import { MobileTodosSheet } from "@/components/mobile/mobile-todos-sheet";
import { MobileShareSheet } from "@/components/mobile/mobile-share-sheet";
import { MobileHistorySheet } from "@/components/mobile/mobile-history-sheet";
import { MobileUserMenu } from "@/components/mobile/mobile-user-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function fmtRange(start: string, end: string) {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const fmt = (d: string) =>
    new Date(d + "T00:00:00").toLocaleDateString("en-US", opts);
  return `${fmt(start)} – ${fmt(end)}`;
}

function fmtUsdCompact(n: number): string {
  if (n >= 10000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

/**
 * Owner-only "..." overflow that exposes destructive trip actions
 * (currently just Delete trip — the rename / dates affordances live
 * inline elsewhere). Hidden for contributors. Tap → confirm() →
 * delete → bounce to /m so the user isn't stuck on a 404 detail.
 */
function MobileTripOverflowMenu({
  tripId,
  tripTitle,
  onOpenHistory,
  showDelete,
  leaveTripShareId,
}: {
  tripId: string;
  tripTitle: string;
  onOpenHistory: () => void;
  /** Owner-only — contributors see the menu (for History) but not Delete. */
  showDelete: boolean;
  /** When set, show "Leave trip" — recipient-only path that revokes the
   *  share row identified by this id. Mirrors the desktop `LeaveTripMenu`. */
  leaveTripShareId: string | null;
}): React.JSX.Element {
  const router = useRouter();
  const homeHref = useDemoHref("/m");
  const deleteTrip = useDeleteTrip();
  const deleteShare = useDeleteShare(tripId);

  const handleDelete = () => {
    if (
      typeof window === "undefined" ||
      !window.confirm(`Delete "${tripTitle}"? This cannot be undone.`)
    ) {
      return;
    }
    deleteTrip.mutate(tripId, {
      onSuccess: () => {
        router.push(homeHref);
      },
      onError: (err) => {
        toast.error(
          `Couldn't delete trip${err instanceof Error ? `: ${err.message}` : ""}`,
        );
      },
    });
  };

  const handleLeave = () => {
    if (!leaveTripShareId) return;
    if (
      typeof window === "undefined" ||
      !window.confirm(
        `Leave "${tripTitle}"? You'll lose access to this trip — the owner will be notified.`,
      )
    ) {
      return;
    }
    deleteShare.mutate(leaveTripShareId, {
      onSuccess: () => {
        router.push(homeHref);
      },
      onError: (err) => {
        toast.error(
          `Couldn't leave trip${err instanceof Error ? `: ${err.message}` : ""}`,
        );
      },
    });
  };

  const busy = deleteTrip.isPending || deleteShare.isPending;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="More trip actions"
          disabled={busy}
          className="flex h-9 w-9 items-center justify-center rounded-full text-foreground/80 hover:bg-muted active:bg-muted/80 disabled:opacity-50"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onOpenHistory}>
          <History className="mr-2 h-4 w-4" />
          View history
        </DropdownMenuItem>
        {leaveTripShareId && (
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={handleLeave}
            disabled={deleteShare.isPending}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Leave trip
          </DropdownMenuItem>
        )}
        {showDelete && (
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={handleDelete}
            disabled={deleteTrip.isPending}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete trip
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HeaderActions({
  tripId,
  tripTitle,
  usdTotal,
  todoRemaining,
  todoTotal,
  onOpenCosts,
  onOpenTodos,
  onOpenShare,
  onOpenHistory,
  showCosts,
  showTodos,
  showShare,
  showDeleteInOverflow,
  leaveTripShareId,
}: {
  tripId: string;
  tripTitle: string;
  usdTotal: number | null;
  todoRemaining: number;
  todoTotal: number;
  onOpenCosts: () => void;
  onOpenTodos: () => void;
  onOpenShare: () => void;
  onOpenHistory: () => void;
  /** When false (e.g. share with `showCosts: false`), hide the Costs pill. */
  showCosts: boolean;
  /** Same idea for the to-do pill. */
  showTodos: boolean;
  /** Owner-only — contributors can't reshare. */
  showShare: boolean;
  /** Owner-only — exposes the destructive "Delete trip" action inside the
   *  overflow menu. The menu itself is always shown so contributors can
   *  reach the History sheet. */
  showDeleteInOverflow: boolean;
  /** Recipient-only — id of the share row that grants the current user
   *  access. When set, the overflow menu shows "Leave trip". */
  leaveTripShareId: string | null;
}): React.JSX.Element {
  // The avatar lives on /m only — the trip-detail header was getting
  // squeezed by Costs + Todos + Share + Avatar all crowding the title.
  // Tap back-arrow → home to reach the user menu.
  const todoLabel =
    todoTotal === 0 ? "To-do" : todoRemaining === 0 ? "✓" : todoRemaining;
  return (
    <div className="flex items-center gap-1">
      {showCosts && (
        <button
          type="button"
          onClick={onOpenCosts}
          className="inline-flex h-8 items-center gap-1 rounded-full bg-muted px-2.5 text-[11px] font-semibold text-foreground active:bg-muted/70"
          aria-label="Open costs"
        >
          <DollarSign className="h-3.5 w-3.5" />
          <span className="tabular-nums">
            {usdTotal !== null ? fmtUsdCompact(usdTotal) : "Costs"}
          </span>
        </button>
      )}
      {showTodos && (
        <button
          type="button"
          onClick={onOpenTodos}
          className="inline-flex h-8 items-center gap-1 rounded-full bg-muted px-2.5 text-[11px] font-semibold text-foreground active:bg-muted/70"
          aria-label={`Open to-dos${todoTotal ? ` (${todoRemaining} remaining)` : ""}`}
        >
          <CheckSquare className="h-3.5 w-3.5" />
          <span className="tabular-nums">{todoLabel}</span>
        </button>
      )}
      {showShare && (
        <button
          type="button"
          onClick={onOpenShare}
          aria-label="Share trip"
          className="flex h-9 w-9 items-center justify-center rounded-full text-foreground/80 hover:bg-muted active:bg-muted/80"
        >
          <Share2 className="h-4 w-4" />
        </button>
      )}
      <MobileTripOverflowMenu
        tripId={tripId}
        tripTitle={tripTitle}
        onOpenHistory={onOpenHistory}
        showDelete={showDeleteInOverflow}
        leaveTripShareId={leaveTripShareId}
      />
    </div>
  );
}

function useTripSummary(trip: Trip) {
  const usdTotal = useMemo(() => {
    let sum = 0;
    let any = false;
    for (const day of trip.days) {
      for (const seg of day.segments) {
        if (seg.cost?.currency === "USD" && typeof seg.cost.amount === "number") {
          sum += seg.cost.amount;
          any = true;
        }
      }
    }
    return any ? sum : null;
  }, [trip.days]);

  const todoSummary = useMemo(() => {
    const total = trip.todos.length;
    const remaining = trip.todos.filter((t) => !t.isCompleted).length;
    return { total, remaining };
  }, [trip.todos]);

  return { usdTotal, todoSummary };
}

function MobileTripInner({ tripId }: { tripId: string }) {
  const { data: trip, isLoading, isError, refetch } = useTrip(tripId);
  const online = useOnlineStatus();
  const homeHref = useDemoHref("/m");
  const [costsOpen, setCostsOpen] = useState(false);
  const [todosOpen, setTodosOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

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
    // Distinguish "device offline + this trip was never cached" from a
    // generic fetch failure so the message matches the actual problem.
    // Retry stays available either way — coming back online turns the
    // offline branch into a real load.
    const offline = !online;
    return (
      <MobileFrame>
        <MobileHeader
          title={offline ? "Not available offline" : "Couldn't load trip"}
          backHref={homeHref}
          right={<MobileUserMenu />}
        />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          {offline ? (
            <CloudOff className="h-8 w-8 text-amber-600 dark:text-amber-400" />
          ) : (
            <AlertCircle className="h-8 w-8 text-destructive" />
          )}
          <p className="text-sm text-muted-foreground">
            {offline
              ? "This trip hasn't been loaded on this device yet. Open it once while online and it'll be available offline next time."
              : "Something went wrong. Check your connection and try again."}
          </p>
          <div className="flex gap-2">
            <Link
              href={homeHref}
              className="rounded-full border bg-background px-4 py-2 text-sm font-medium"
            >
              Back to trips
            </Link>
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background"
            >
              Retry
            </button>
          </div>
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
      <TripFrame
        trip={trip}
        dateRange={dateRange}
        homeHref={homeHref}
        costsOpen={costsOpen}
        todosOpen={todosOpen}
        shareOpen={shareOpen}
        historyOpen={historyOpen}
        onOpenCosts={() => setCostsOpen(true)}
        onCloseCosts={() => setCostsOpen(false)}
        onOpenTodos={() => setTodosOpen(true)}
        onCloseTodos={() => setTodosOpen(false)}
        onOpenShare={() => setShareOpen(true)}
        onCloseShare={() => setShareOpen(false)}
        onOpenHistory={() => setHistoryOpen(true)}
        onCloseHistory={() => setHistoryOpen(false)}
      />
    </MobileFrame>
  );
}

function TripFrame({
  trip,
  dateRange,
  homeHref,
  costsOpen,
  todosOpen,
  shareOpen,
  historyOpen,
  onOpenCosts,
  onCloseCosts,
  onOpenTodos,
  onCloseTodos,
  onOpenShare,
  onCloseShare,
  onOpenHistory,
  onCloseHistory,
}: {
  trip: Trip;
  dateRange: string;
  homeHref: string;
  costsOpen: boolean;
  todosOpen: boolean;
  shareOpen: boolean;
  historyOpen: boolean;
  onOpenCosts: () => void;
  onCloseCosts: () => void;
  onOpenTodos: () => void;
  onCloseTodos: () => void;
  onOpenShare: () => void;
  onCloseShare: () => void;
  onOpenHistory: () => void;
  onCloseHistory: () => void;
}): React.JSX.Element {
  const { usdTotal, todoSummary } = useTripSummary(trip);
  // For owned trips this is always all-true. For shared trips it
  // mirrors the per-share `showCosts` / `showTodos` flags + gates
  // resharing to owner-only.
  const permission = useTripPermission(trip.id);
  // The id of the share row that grants this user access — surfaced on
  // the trip summary so the recipient can self-leave. Absent on owned
  // trips and anonymous link shares.
  const leaveTripShareId = permission.isOwner
    ? null
    : permission.sharedShareId ?? null;

  return (
    <>
      <MobileHeader
        title={trip.title}
        subtitle={`${dateRange} · ${trip.days.length} days`}
        backHref={homeHref}
        right={
          permission.isLoading ? null : (
            <HeaderActions
              tripId={trip.id}
              tripTitle={trip.title}
              usdTotal={usdTotal}
              todoRemaining={todoSummary.remaining}
              todoTotal={todoSummary.total}
              onOpenCosts={onOpenCosts}
              onOpenTodos={onOpenTodos}
              onOpenShare={onOpenShare}
              onOpenHistory={onOpenHistory}
              showCosts={permission.showCosts}
              showTodos={permission.showTodos}
              showShare={permission.isOwner}
              showDeleteInOverflow={permission.isOwner}
              leaveTripShareId={leaveTripShareId}
            />
          )
        }
      />
      <MobileCarouselView
        trip={trip}
        showCosts={!permission.isLoading && permission.showCosts}
      />
      {/* Sheets are only mounted when the corresponding pill is allowed
          to open them — keeps the data off the page entirely for shares
          that asked to hide costs / todos. */}
      {permission.showCosts && (
        <MobileCostsSheet
          tripId={trip.id}
          open={costsOpen}
          onClose={onCloseCosts}
        />
      )}
      {permission.showTodos && (
        <MobileTodosSheet
          tripId={trip.id}
          todos={trip.todos}
          open={todosOpen}
          onClose={onCloseTodos}
        />
      )}
      <MobileHistorySheet
        entries={trip.history}
        open={historyOpen}
        onClose={onCloseHistory}
      />
      {permission.isOwner && (
        <MobileShareSheet
          tripId={trip.id}
          tripTitle={trip.title}
          tripStartDate={trip.startDate}
          tripEndDate={trip.endDate}
          open={shareOpen}
          onClose={onCloseShare}
        />
      )}
    </>
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
