"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { TripSummary } from "@itinly/api-client";
import type { TripStatus } from "@itinly/shared";
import { useDemoHref } from "@/lib/demo";
import { useConfirm } from "@/lib/confirm-dialog";
import { toastMutationError } from "@/lib/api-error";
import { useDeleteShare, useDeleteTrip, useUpdateTrip } from "@itinly/api-client";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { formatTripDateRange } from "@/lib/format-date";
import {
  daysUntil,
  flagEmoji,
  gradientFor,
  useCityImage,
} from "@/lib/trip-card-visuals";
import {
  Card,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Calendar,
  CalendarDays,
  LogOut,
  MoreVertical,
  Share2,
  Trash2,
  Pencil,
  Check,
  Users,
  X,
} from "lucide-react";
import { ShareTripDialog } from "@/components/share-trip-dialog";

/**
 * Map each trip status to a `--status-*` token. Pulled out so the
 * design-system status palette is the source-of-truth — the chip
 * inherits dark-mode lifts automatically because the underlying
 * status tokens already do.
 */
const STATUS_TOKEN: Record<string, "info" | "ok" | "muted" | "danger"> = {
  planning:  "info",
  active:    "ok",
  completed: "muted",
  cancelled: "danger",
};

function statusChipStyle(status: string): React.CSSProperties {
  const t = STATUS_TOKEN[status] ?? "muted";
  return {
    backgroundColor: `var(--status-${t}-bg)`,
    color: `var(--status-${t}-fg)`,
  };
}

/** Order the status chip cycles through on click. */
const STATUS_CYCLE: TripStatus[] = [
  "planning",
  "active",
  "completed",
  "cancelled",
];

function nextStatus(current: string): TripStatus {
  const idx = STATUS_CYCLE.indexOf(current as TripStatus);
  return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
}

/**
 * Hero band rendered at the top of every TripCard. Shows a Wikipedia
 * thumbnail of the primary city when available, with a deterministic
 * gradient fallback. The trip title + country flag are overlaid
 * bottom-left, and an upcoming-trip countdown sits top-left (the
 * top-right corner is reserved for the card's overflow menu).
 */
function TripCardHero({ trip }: { trip: TripSummary }): React.JSX.Element {
  const image = useCityImage(trip.primaryCity, trip.primaryCountry);
  const flag = flagEmoji(trip.primaryCountryCode);
  const seed = trip.primaryCity ?? trip.title;
  const gradient = gradientFor(seed);
  const delta = daysUntil(trip.startDate);
  // Show countdown only for trips that haven't started yet — but skip
  // cancelled trips, where "in 12 days" reads as misleading optimism.
  const showCountdown = delta > 0 && trip.status !== "cancelled";
  const countdownLabel =
    delta === 1 ? "Tomorrow" : delta <= 60 ? `In ${delta} days` : null;

  return (
    <div
      className="relative h-32 w-full overflow-hidden"
      style={
        image
          ? undefined
          : {
              backgroundImage: `linear-gradient(135deg, ${gradient.from}, ${gradient.to})`,
            }
      }
    >
      {image ? (
        // Wikipedia thumbnails come from upload.wikimedia.org and don't
        // benefit from Next/Image optimisation (this app is static-exported
        // with images.unoptimized=true). Plain <img> keeps the layout
        // predictable and avoids the cases where next/image's remote-URL
        // handling silently drops the element.
        //
        // `crossOrigin="anonymous"` is required by our
        // `Cross-Origin-Embedder-Policy: credentialless` header — without
        // it the browser fetches the image as `no-cors` opaque and the
        // service worker's cached response then fails the COEP gate
        // ("Cross-Origin-Resource-Policy prevented from serving the
        // response to the client"). Wikimedia replies with
        // `Access-Control-Allow-Origin: *` on CORS requests, so the
        // anonymous mode works without credentials.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image.url}
          alt={trip.title}
          loading="lazy"
          crossOrigin="anonymous"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        // No city → no Wikipedia image to fetch. Render a calendar
        // glyph on top of the gradient so the hero doesn't look
        // empty. Mirrors the mobile trip card's fallback.
        !trip.primaryCity && (
          <div className="absolute inset-0 flex items-center justify-center text-white/70">
            <CalendarDays className="h-7 w-7" />
          </div>
        )
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
      {showCountdown && countdownLabel && (
        <Badge
          variant="secondary"
          className="absolute left-2 top-2 z-10 bg-white/90 text-zinc-900 shadow-sm backdrop-blur-sm"
        >
          {countdownLabel}
        </Badge>
      )}
      {trip.sharedFromEmail && (
        // Shared-with-you marker. Sits below the countdown when both
        // are present so the corner doesn't get crowded.
        <Badge
          variant="secondary"
          className="absolute left-2 z-10 bg-white/90 text-zinc-900 shadow-sm backdrop-blur-sm"
          style={{ top: showCountdown && countdownLabel ? "2.25rem" : "0.5rem" }}
        >
          <Users className="mr-1 h-3 w-3" />
          {trip.sharedPermission === "edit" ? "Shared · Editor" : "Shared · Viewer"}
        </Badge>
      )}
      <div className="absolute bottom-2 left-3 right-3 flex items-end gap-2 text-white">
        {flag && (
          <span className="flag-font text-2xl leading-none drop-shadow-sm" aria-hidden>
            {flag}
          </span>
        )}
        <span className="line-clamp-2 text-lg font-semibold leading-tight drop-shadow-sm">
          {trip.title}
        </span>
      </div>
    </div>
  );
}

export function TripCard({ trip }: { trip: TripSummary }): React.JSX.Element {
  const router = useRouter();
  const confirm = useConfirm();
  const deleteTrip = useDeleteTrip();
  const deleteShare = useDeleteShare(trip.id);
  const updateTrip = useUpdateTrip(trip.id);
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(trip.title);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const tripHref = useDemoHref(`/trips/?id=${trip.id}`);
  const homeHref = useDemoHref("/");

  // Capabilities — owner does everything, edit-share contributors can
  // rename + cycle status but not delete, view-share recipients can
  // only open the trip. Recipients of any share kind can self-leave
  // when the server surfaced their share id.
  const isShared = !!trip.sharedFromEmail;
  const canEdit = !isShared || trip.sharedPermission === "edit";
  const canDelete = !isShared;
  // Share creation is owner-only on the server, so the menu item only
  // shows for trips the user owns. Recipients can already see who
  // else has access from inside the trip detail page.
  const canShare = !isShared;
  const canLeave = isShared && !!trip.sharedShareId;
  const showMenu = canEdit || canDelete || canShare || canLeave;

  const [shareOpen, setShareOpen] = useState(false);

  const handleDelete = async () => {
    const ok = await confirm({
      title: `Delete "${trip.title}"?`,
      description: "This cannot be undone.",
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;
    deleteTrip.mutate(trip.id, {
      onError: toastMutationError("delete trip"),
    });
  };

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
        // The list will drop this trip on its next refresh; this also
        // ensures any open detail page bounces away.
        router.push(homeHref);
      },
      onError: toastMutationError("leave trip"),
    });
  };

  // Radix's DropdownMenu restores focus to the trigger on close, which
  // races with the input's `autoFocus` and wins. Re-focus on the next
  // frame so the rename field is actually editable, and select the
  // existing title so the user can replace it in one keystroke.
  useEffect(() => {
    if (!renaming) return;
    // setTimeout(0) (not rAF) so this still runs when the tab is in the
    // background — rAF is paused in hidden tabs. The 0ms delay defers
    // past Radix's focus restoration on the dropdown trigger.
    const id = window.setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, [renaming]);

  const handleRename = () => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    setRenaming(false);
    if (trimmed !== trip.title) {
      updateTrip.mutate(
        { title: trimmed },
        { onError: toastMutationError("rename trip") },
      );
    }
  };

  const cycleStatus = (e: React.MouseEvent) => {
    // The card is wrapped in a <Link> overlay; stop propagation so clicking
    // the chip doesn't also navigate into the trip.
    e.preventDefault();
    e.stopPropagation();
    if (!canEdit) return;
    updateTrip.mutate(
      { status: nextStatus(trip.status) },
      { onError: toastMutationError("update status") },
    );
  };

  return (
    <Card className="group relative flex h-full flex-col gap-4 overflow-hidden pt-0 transition-shadow hover:shadow-md">
      {!renaming && (
        <Link
          href={tripHref}
          className="absolute inset-0 z-10"
          aria-label={trip.title}
        />
      )}
      <div className="relative">
        <TripCardHero trip={trip} />
        {showMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Trip actions"
                className="absolute right-1.5 top-1.5 z-10 h-8 w-8 bg-white/85 text-zinc-900 shadow-sm backdrop-blur-sm hover:bg-white"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              // Radix returns focus to the trigger button after the menu
              // closes. For Rename that races with — and beats — our
              // imperative focus on the input. Share and Delete both
              // open dialogs that own their own focus, so suppressing
              // restoration here is safe for every menu item.
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              {canShare && (
                <DropdownMenuItem onClick={() => setShareOpen(true)}>
                  <Share2 className="mr-2 h-4 w-4" />
                  Share
                </DropdownMenuItem>
              )}
              {canEdit && (
                <DropdownMenuItem
                  onClick={() => {
                    setNewTitle(trip.title);
                    setRenaming(true);
                  }}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Rename
                </DropdownMenuItem>
              )}
              {canDelete && (
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={handleDelete}
                  disabled={deleteTrip.isPending}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              )}
              {canLeave && (
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={handleLeave}
                  disabled={deleteShare.isPending}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Leave trip
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {renaming && (
        <form
          className="relative z-10 flex items-center gap-1.5 px-6"
          onSubmit={(e) => {
            e.preventDefault();
            handleRename();
          }}
        >
          <Input
            ref={renameInputRef}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="h-7 text-base font-semibold"
            autoFocus
            // Select the current title on focus so the user can
            // start typing immediately to replace it. autoFocus
            // alone just lands the cursor at the end of the text,
            // which forces them to manually select-all before
            // overwriting.
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setNewTitle(trip.title);
                setRenaming(false);
              }
            }}
          />
          <Button
            type="submit"
            variant="ghost"
            size="icon"
            aria-label="Save trip name"
            className="h-7 w-7 shrink-0"
            disabled={!newTitle.trim() || updateTrip.isPending}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Cancel rename"
            className="h-7 w-7 shrink-0"
            onClick={() => {
              setNewTitle(trip.title);
              setRenaming(false);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </form>
      )}
      <CardContent className="mt-auto space-y-2">
        <CardDescription className="flex items-center gap-1">
          <Calendar className="h-3.5 w-3.5" />
          {formatTripDateRange(trip.startDate, trip.endDate)}
        </CardDescription>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge asChild variant="secondary" className="relative z-10 p-0">
            <button
              type="button"
              onClick={cycleStatus}
              disabled={updateTrip.isPending || !canEdit}
              title={
                canEdit
                  ? `Status: ${trip.status}. Click to advance.`
                  : `Status: ${trip.status}`
              }
              style={statusChipStyle(trip.status)}
              className={cn(
                "px-2 py-0.5 capitalize",
                canEdit
                  ? "cursor-pointer hover:opacity-80 disabled:cursor-wait"
                  : "cursor-default",
              )}
            >
              {trip.status}
            </button>
          </Badge>
          <span className="text-sm text-muted-foreground">
            {trip.dayCount} {trip.dayCount === 1 ? "day" : "days"}
          </span>
          {trip.todoCount > 0 && (
            <span className="text-sm text-muted-foreground">
              {trip.todoCount} {trip.todoCount === 1 ? "todo" : "todos"}
            </span>
          )}
        </div>
      </CardContent>
      {canShare && (
        // Mounted at the card level (not inside the menu) so the dialog
        // outlives the dropdown's auto-close on selection. Rendered
        // unconditionally with `open` driving visibility — Radix
        // Dialog skips DOM cost when closed.
        <ShareTripDialog
          tripId={trip.id}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}
    </Card>
  );
}
