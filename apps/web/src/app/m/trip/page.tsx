"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ApiError,
  useConfirmSegment,
  useDeleteShare,
  useDeleteTrip,
  useTrip,
} from "@itinly/api-client";
import type { Segment, Trip } from "@itinly/shared";
import { toast } from "sonner";
import { describeError, toastMutationError } from "@/lib/api-error";
import {
  AlertCircle,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  CheckSquare,
  CloudOff,
  DollarSign,
  History,
  LayoutGrid,
  LogOut,
  Mail,
  Loader2,
  MoreVertical,
  Pencil,
  Share2,
  Trash2,
  Users,
} from "lucide-react";
import { RequireAuth } from "@/components/require-auth";
import { useConfirm } from "@/lib/confirm-dialog";
import { useDemoHref } from "@/lib/demo";
import { useOnlineStatus } from "@/lib/use-online-status";
import { useTripPermission } from "@/lib/use-trip-permission";
import { MobileFrame, MobileHeader } from "@/components/mobile/mobile-shell";
import { MobileCarouselView } from "@/components/mobile/mobile-carousel-view";
import { MobileCostsSheet } from "@/components/mobile/mobile-costs-sheet";
import { MobileTodosSheet } from "@/components/mobile/mobile-todos-sheet";
import { MobileShareSheet } from "@/components/mobile/mobile-share-sheet";
import { MobileHistorySheet } from "@/components/mobile/mobile-history-sheet";
import { MobileEditTripSheet } from "@/components/mobile/mobile-edit-trip-sheet";
import { MobileEmailScanSheet } from "@/components/mobile/mobile-email-scan-sheet";
import { MobileCalendarSyncSheet } from "@/components/mobile/mobile-calendar-sync-sheet";
import { MobileReviewPendingSheet } from "@/components/mobile/mobile-review-pending-sheet";
import { MobileTimelineView } from "@/components/mobile/mobile-timeline-view";
import { MobileUserMenu } from "@/components/mobile/mobile-user-menu";

type MobileView = "carousel" | "timeline";

function parseView(v: string | null): MobileView {
  return v === "timeline" ? "timeline" : "carousel";
}
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Owner-only "..." overflow that exposes destructive trip actions
 * (currently just Delete trip — the rename / dates affordances live
 * inline elsewhere). Hidden for contributors. Tap → confirm() →
 * delete → bounce to /m so the user isn't stuck on a 404 detail.
 */
function MobileTripOverflowMenu({
  tripId,
  tripTitle,
  onOpenCosts,
  onOpenHistory,
  onOpenEdit,
  onOpenCalendarSync,
  onSwitchView,
  view,
  showDelete,
  showCosts,
  showEdit,
  showCalendarSync,
  calendarSynced,
  calendarSyncedCount,
  leaveTripShareId,
}: {
  tripId: string;
  tripTitle: string;
  onOpenCosts: () => void;
  onOpenHistory: () => void;
  onOpenEdit: () => void;
  onOpenCalendarSync: () => void;
  /** Flips the URL `?v=` between carousel + timeline. */
  onSwitchView: () => void;
  /** Current view, drives the switch label + icon. */
  view: MobileView;
  /** Owner-only — contributors see the menu (for History) but not Delete. */
  showDelete: boolean;
  /** Owner + share-with-costs only. Drives whether the Costs item is
   *  rendered (and the costs sheet is mounted at all). */
  showCosts: boolean;
  /** Owner + edit-contributor only. View-only contributors don't see Edit. */
  showEdit: boolean;
  /** Owner + edit-contributor only — pushing events to a viewer's
   *  Google Calendar mutates the trip (writes calendarEventId on each
   *  segment) so view-only collaborators can't sync. */
  showCalendarSync: boolean;
  /** Drives the menu-item label between "Sync to Calendar" and
   *  "Calendar synced (N)". */
  calendarSynced: boolean;
  calendarSyncedCount: number;
  /** When set, show "Leave trip" — recipient-only path that revokes the
   *  share row identified by this id. Mirrors the desktop `LeaveTripMenu`. */
  leaveTripShareId: string | null;
}): React.JSX.Element {
  const router = useRouter();
  const confirm = useConfirm();
  const homeHref = useDemoHref("/m");
  const deleteTrip = useDeleteTrip();
  const deleteShare = useDeleteShare(tripId);

  const handleDelete = async () => {
    const ok = await confirm({
      title: `Delete "${tripTitle}"?`,
      description: "This cannot be undone.",
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;
    deleteTrip.mutate(tripId, {
      onSuccess: () => {
        router.push(homeHref);
      },
      onError: toastMutationError("delete trip"),
    });
  };

  const handleLeave = async () => {
    if (!leaveTripShareId) return;
    const ok = await confirm({
      title: `Leave "${tripTitle}"?`,
      description:
        "You'll lose access to this trip — the owner will be notified.",
      confirmText: "Leave",
      destructive: true,
    });
    if (!ok) return;
    deleteShare.mutate(leaveTripShareId, {
      onSuccess: () => {
        router.push(homeHref);
      },
      onError: toastMutationError("leave trip"),
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
        <DropdownMenuItem onClick={onSwitchView}>
          {view === "timeline" ? (
            <LayoutGrid className="mr-2 h-4 w-4" />
          ) : (
            <CalendarDays className="mr-2 h-4 w-4" />
          )}
          {view === "timeline" ? "Switch to days" : "Switch to timeline"}
        </DropdownMenuItem>
        {showCosts && (
          <DropdownMenuItem onClick={onOpenCosts}>
            <DollarSign className="mr-2 h-4 w-4" />
            Costs
          </DropdownMenuItem>
        )}
        {showCalendarSync && (
          <DropdownMenuItem onClick={onOpenCalendarSync}>
            {calendarSynced ? (
              <CalendarCheck
                className="mr-2 h-4 w-4"
                style={{ color: "var(--status-ok-fg)" }}
              />
            ) : (
              <CalendarPlus className="mr-2 h-4 w-4" />
            )}
            {calendarSynced
              ? `Calendar synced (${calendarSyncedCount})`
              : "Sync to Calendar"}
          </DropdownMenuItem>
        )}
        {showEdit && (
          <DropdownMenuItem onClick={onOpenEdit}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit trip
          </DropdownMenuItem>
        )}
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
  todoRemaining,
  todoTotal,
  pendingCount,
  onOpenCosts,
  onOpenTodos,
  onOpenShare,
  onOpenHistory,
  onOpenEdit,
  onOpenReview,
  onOpenScan,
  onOpenCalendarSync,
  onSwitchView,
  view,
  showCosts,
  showTodos,
  showShare,
  showReview,
  showScan,
  showEditInOverflow,
  showCalendarSyncInOverflow,
  showDeleteInOverflow,
  calendarSynced,
  calendarSyncedCount,
  leaveTripShareId,
}: {
  tripId: string;
  tripTitle: string;
  todoRemaining: number;
  todoTotal: number;
  /** Count of `needsReview: true` segments — drives the review pill label. */
  pendingCount: number;
  onOpenCosts: () => void;
  onOpenTodos: () => void;
  onOpenShare: () => void;
  onOpenHistory: () => void;
  onOpenEdit: () => void;
  onOpenReview: () => void;
  onOpenScan: () => void;
  onOpenCalendarSync: () => void;
  onSwitchView: () => void;
  view: MobileView;
  /** When false (e.g. share with `showCosts: false`), hide the Costs item
   *  inside the overflow menu and skip mounting the costs sheet. */
  showCosts: boolean;
  /** Same idea for the to-do pill. */
  showTodos: boolean;
  /** Owner-only — contributors can't reshare. */
  showShare: boolean;
  /** Owner + shared-edit only — gates the review-pending pill (and
   *  the per-segment tap-to-confirm). View-only contributors and
   *  public viewers see segments' inert "Review" badge but no
   *  affordance to clear them. */
  showReview: boolean;
  /** Owner + shared-edit only — surfaces the email-scan launch as a
   *  visible icon button. Parses go to the trip's owner Drive, which
   *  contributors can write to but viewers can't. */
  showScan: boolean;
  /** Owner + shared-edit only — exposes the "Edit trip" affordance in
   *  the overflow menu. View-only contributors don't see it. */
  showEditInOverflow: boolean;
  /** Owner + shared-edit only — exposes "Sync to Calendar" in the
   *  overflow menu. Calendar push writes calendarEventId onto each
   *  segment, so view-only collaborators can't trigger it. */
  showCalendarSyncInOverflow: boolean;
  /** Owner-only — exposes the destructive "Delete trip" action inside the
   *  overflow menu. The menu itself is always shown so contributors can
   *  reach the History sheet. */
  showDeleteInOverflow: boolean;
  /** Drives the calendar-sync menu-item label between "Sync to Calendar"
   *  and "Calendar synced (N)". Sourced from segment `calendarEventId`s. */
  calendarSynced: boolean;
  calendarSyncedCount: number;
  /** Recipient-only — id of the share row that grants the current user
   *  access. When set, the overflow menu shows "Leave trip". */
  leaveTripShareId: string | null;
}): React.JSX.Element {
  // The avatar lives on /m only — the trip-detail header was getting
  // squeezed by Todos + Scan + Share + Avatar all crowding the title.
  // Tap back-arrow → home to reach the user menu.
  const todoLabel =
    todoTotal === 0 ? "To-do" : todoRemaining === 0 ? "✓" : todoRemaining;
  return (
    <div className="flex items-center gap-1">
      {showReview && pendingCount > 0 && (
        <button
          type="button"
          onClick={onOpenReview}
          className="inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-[11px] font-semibold active:opacity-80"
          style={{
            backgroundColor: "var(--status-warn-bg)",
            color: "var(--status-warn-fg)",
            borderColor: "var(--status-warn-rail)",
          }}
          aria-label={`${pendingCount} segment${pendingCount === 1 ? "" : "s"} pending review`}
        >
          <AlertCircle className="h-3.5 w-3.5" />
          <span className="tabular-nums">{pendingCount}</span>
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
      {showScan && (
        <button
          type="button"
          onClick={onOpenScan}
          aria-label="Scan emails"
          className="flex h-9 w-9 items-center justify-center rounded-full text-foreground/80 hover:bg-muted active:bg-muted/80"
        >
          <Mail className="h-4 w-4" />
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
        onOpenCosts={onOpenCosts}
        onOpenHistory={onOpenHistory}
        onOpenEdit={onOpenEdit}
        onOpenCalendarSync={onOpenCalendarSync}
        onSwitchView={onSwitchView}
        view={view}
        showDelete={showDeleteInOverflow}
        showCosts={showCosts}
        showEdit={showEditInOverflow}
        showCalendarSync={showCalendarSyncInOverflow}
        calendarSynced={calendarSynced}
        calendarSyncedCount={calendarSyncedCount}
        leaveTripShareId={leaveTripShareId}
      />
    </div>
  );
}

function useTripSummary(trip: Trip) {
  const todoSummary = useMemo(() => {
    const total = trip.todos.length;
    const remaining = trip.todos.filter((t) => !t.isCompleted).length;
    return { total, remaining };
  }, [trip.todos]);

  const pendingCount = useMemo(() => {
    let n = 0;
    for (const day of trip.days) {
      for (const seg of day.segments) {
        if (seg.needsReview) n += 1;
      }
    }
    return n;
  }, [trip.days]);

  return { todoSummary, pendingCount };
}

function MobileTripInner({
  tripId,
  view,
  onSwitchView,
}: {
  tripId: string;
  view: MobileView;
  onSwitchView: () => void;
}) {
  const { data: trip, isLoading, isError, error, refetch } = useTrip(tripId);
  const online = useOnlineStatus();
  const homeHref = useDemoHref("/m");
  const [costsOpen, setCostsOpen] = useState(false);
  const [todosOpen, setTodosOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [calendarSyncOpen, setCalendarSyncOpen] = useState(false);

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

  if (!trip) {
    // Distinguish a real 404 ("trip not found") from a transient fetch
    // failure so the user gets a Retry instead of being told the trip
    // doesn't exist. We only land in the error branch when there's
    // nothing cached to fall back on — a failed background refetch with
    // a previously-loaded `trip` keeps showing the cached content (this
    // is what fixes the "open the app on Android, see an error screen,
    // then content appears a few seconds later" flicker after the device
    // wakes from sleep with a stale auth token).
    const is404 = error instanceof ApiError && error.status === 404;
    if (isError && !is404) {
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
              <CloudOff className="h-8 w-8" style={{ color: "var(--status-warn-fg)" }} />
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

  return (
    <MobileFrame widenInLandscape={view === "timeline"}>
      <TripFrame
        trip={trip}
        homeHref={homeHref}
        view={view}
        onSwitchView={onSwitchView}
        costsOpen={costsOpen}
        todosOpen={todosOpen}
        shareOpen={shareOpen}
        historyOpen={historyOpen}
        editOpen={editOpen}
        reviewOpen={reviewOpen}
        scanOpen={scanOpen}
        onOpenCosts={() => setCostsOpen(true)}
        onCloseCosts={() => setCostsOpen(false)}
        onOpenTodos={() => setTodosOpen(true)}
        onCloseTodos={() => setTodosOpen(false)}
        onOpenShare={() => setShareOpen(true)}
        onCloseShare={() => setShareOpen(false)}
        onOpenHistory={() => setHistoryOpen(true)}
        onCloseHistory={() => setHistoryOpen(false)}
        onOpenEdit={() => setEditOpen(true)}
        onCloseEdit={() => setEditOpen(false)}
        onOpenReview={() => setReviewOpen(true)}
        onCloseReview={() => setReviewOpen(false)}
        onOpenScan={() => setScanOpen(true)}
        onCloseScan={() => setScanOpen(false)}
        onOpenCalendarSync={() => setCalendarSyncOpen(true)}
        onCloseCalendarSync={() => setCalendarSyncOpen(false)}
        calendarSyncOpen={calendarSyncOpen}
      />
    </MobileFrame>
  );
}

function TripFrame({
  trip,
  homeHref,
  view,
  onSwitchView,
  costsOpen,
  todosOpen,
  shareOpen,
  historyOpen,
  editOpen,
  reviewOpen,
  scanOpen,
  calendarSyncOpen,
  onOpenCosts,
  onCloseCosts,
  onOpenTodos,
  onCloseTodos,
  onOpenShare,
  onCloseShare,
  onOpenHistory,
  onCloseHistory,
  onOpenEdit,
  onCloseEdit,
  onOpenReview,
  onCloseReview,
  onOpenScan,
  onCloseScan,
  onOpenCalendarSync,
  onCloseCalendarSync,
}: {
  trip: Trip;
  homeHref: string;
  view: MobileView;
  onSwitchView: () => void;
  costsOpen: boolean;
  todosOpen: boolean;
  shareOpen: boolean;
  historyOpen: boolean;
  editOpen: boolean;
  reviewOpen: boolean;
  scanOpen: boolean;
  calendarSyncOpen: boolean;
  onOpenCosts: () => void;
  onCloseCosts: () => void;
  onOpenTodos: () => void;
  onCloseTodos: () => void;
  onOpenShare: () => void;
  onCloseShare: () => void;
  onOpenHistory: () => void;
  onCloseHistory: () => void;
  onOpenEdit: () => void;
  onCloseEdit: () => void;
  onOpenReview: () => void;
  onCloseReview: () => void;
  onOpenScan: () => void;
  onCloseScan: () => void;
  onOpenCalendarSync: () => void;
  onCloseCalendarSync: () => void;
}): React.JSX.Element {
  const { todoSummary, pendingCount } = useTripSummary(trip);
  const confirmSegment = useConfirmSegment(trip.id);
  // Wired into the carousel + detail sheet so the user can clear a
  // review flag in one tap, instead of going through Edit → Save.
  const handleConfirmSegment = (segment: Segment) => {
    confirmSegment.mutate(segment.id, {
      onError: (err) =>
        toast.error(`Couldn't confirm "${segment.title}"`, {
          description: describeError(err),
        }),
    });
  };
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

  // Mirrors the desktop `CalendarSyncButton` derivations — count any
  // segment carrying a `calendarEventId` so the menu label flips to
  // "Calendar synced (N)" once at least one event is on Google.
  const calendarSyncedCount = trip.days
    .flatMap((d) => d.segments)
    .filter((s) => s.calendarEventId).length;
  const calendarSynced = calendarSyncedCount > 0;

  return (
    <>
      {/* No title/subtitle on the trip-detail header — the carousel /
          timeline view renders its own larger title block immediately
          below, so duplicating it here just creates a double row. */}
      <MobileHeader
        backHref={homeHref}
        right={
          permission.isLoading ? null : (
            <HeaderActions
              tripId={trip.id}
              tripTitle={trip.title}
              todoRemaining={todoSummary.remaining}
              todoTotal={todoSummary.total}
              pendingCount={pendingCount}
              onOpenCosts={onOpenCosts}
              onOpenTodos={onOpenTodos}
              onOpenShare={onOpenShare}
              onOpenHistory={onOpenHistory}
              onOpenEdit={onOpenEdit}
              onOpenReview={onOpenReview}
              onOpenScan={onOpenScan}
              onOpenCalendarSync={onOpenCalendarSync}
              onSwitchView={onSwitchView}
              view={view}
              showCosts={permission.showCosts}
              showTodos={permission.showTodos}
              showShare={permission.isOwner}
              showReview={permission.canEdit}
              showScan={permission.canEdit}
              showEditInOverflow={permission.canEdit}
              showCalendarSyncInOverflow={permission.canEdit}
              showDeleteInOverflow={permission.isOwner}
              calendarSynced={calendarSynced}
              calendarSyncedCount={calendarSyncedCount}
              leaveTripShareId={leaveTripShareId}
            />
          )
        }
      />
      {!permission.isLoading && permission.sharedFromEmail && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
          <Users className="h-3 w-3 shrink-0" />
          <span className="truncate">
            Shared by {permission.sharedFromEmail}
          </span>
          <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wider opacity-70">
            {permission.isReadOnly ? "view" : "edit"}
          </span>
        </div>
      )}
      {view === "timeline" ? (
        <MobileTimelineView trip={trip} />
      ) : (
        <MobileCarouselView
          trip={trip}
          showCosts={!permission.isLoading && permission.showCosts}
          canEdit={!permission.isLoading && permission.canEdit}
          onConfirmSegment={
            !permission.isLoading && permission.canEdit
              ? handleConfirmSegment
              : undefined
          }
        />
      )}
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
          days={trip.days}
          canEdit={permission.canEdit}
          open={todosOpen}
          onClose={onCloseTodos}
        />
      )}
      <MobileHistorySheet
        entries={trip.history}
        open={historyOpen}
        onClose={onCloseHistory}
      />
      {permission.canEdit && (
        <MobileEditTripSheet
          trip={trip}
          open={editOpen}
          onClose={onCloseEdit}
        />
      )}
      {permission.canEdit && (
        <MobileReviewPendingSheet
          trip={trip}
          open={reviewOpen}
          onClose={onCloseReview}
        />
      )}
      {permission.canEdit && (
        <MobileEmailScanSheet
          tripId={trip.id}
          open={scanOpen}
          onClose={onCloseScan}
        />
      )}
      {permission.canEdit && (
        <MobileCalendarSyncSheet
          trip={trip}
          open={calendarSyncOpen}
          onClose={onCloseCalendarSync}
        />
      )}
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
  const router = useRouter();
  const tripId = searchParams.get("id");
  const view = parseView(searchParams.get("v"));
  const homeHref = useDemoHref("/m");

  // Flips `?v=` between carousel + timeline. Uses `replace` so the swap
  // doesn't add a back-nav step — feels more like a tab toggle than a
  // separate page.
  const onSwitchView = () => {
    const next = view === "timeline" ? "carousel" : "timeline";
    const params = new URLSearchParams(searchParams.toString());
    params.set("v", next);
    router.replace(`/m/trip?${params.toString()}`);
  };

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

  return (
    <MobileTripInner tripId={tripId} view={view} onSwitchView={onSwitchView} />
  );
}

export default function MobileTripPage(): React.JSX.Element {
  return (
    <RequireAuth>
      <Suspense
        fallback={
          <MobileFrame>
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          </MobileFrame>
        }
      >
        <MobileTripPageInner />
      </Suspense>
    </RequireAuth>
  );
}
