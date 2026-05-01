"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { TripSummary } from "@travel-app/api-client";
import type { TripStatus } from "@travel-app/shared";
import { useDemoHref } from "@/lib/demo";
import { useDeleteTrip, useUpdateTrip } from "@travel-app/api-client";
import { cn } from "@/lib/utils";
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
  MoreVertical,
  Trash2,
  Pencil,
  Check,
  Users,
  X,
} from "lucide-react";

const statusColors: Record<string, string> = {
  planning: "bg-blue-100 text-blue-800",
  active: "bg-green-100 text-green-800",
  completed: "bg-gray-100 text-gray-800",
  cancelled: "bg-red-100 text-red-700",
};

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

function formatDateRange(start: string, end: string): string {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
  };
  const startStr = s.toLocaleDateString("en-US", opts);
  const endStr = e.toLocaleDateString("en-US", {
    ...opts,
    year: "numeric",
  });
  return `${startStr} – ${endStr}`;
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
      {image && (
        // Wikipedia thumbnails come from upload.wikimedia.org and don't
        // benefit from Next/Image optimisation (this app is static-exported
        // with images.unoptimized=true). Plain <img> keeps the layout
        // predictable and avoids the cases where next/image's remote-URL
        // handling silently drops the element.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image.url}
          alt={trip.title}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
      {showCountdown && countdownLabel && (
        <Badge
          variant="secondary"
          className="absolute left-2 top-2 z-10 bg-white/90 text-foreground shadow-sm backdrop-blur-sm"
        >
          {countdownLabel}
        </Badge>
      )}
      {trip.sharedFromEmail && (
        // Shared-with-you marker. Sits below the countdown when both
        // are present so the corner doesn't get crowded.
        <Badge
          variant="secondary"
          className="absolute left-2 z-10 bg-white/90 text-foreground shadow-sm backdrop-blur-sm"
          style={{ top: showCountdown && countdownLabel ? "2.25rem" : "0.5rem" }}
        >
          <Users className="mr-1 h-3 w-3" />
          {trip.sharedPermission === "edit" ? "Shared · Editor" : "Shared · Viewer"}
        </Badge>
      )}
      <div className="absolute bottom-2 left-3 right-3 flex items-end gap-2 text-white">
        {flag && (
          <span className="text-2xl leading-none drop-shadow-sm" aria-hidden>
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
  const deleteTrip = useDeleteTrip();
  const updateTrip = useUpdateTrip(trip.id);
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(trip.title);
  const tripHref = useDemoHref(`/trips/?id=${trip.id}`);

  // Capabilities — owner does everything, edit-share contributors can
  // rename + cycle status but not delete, view-share recipients can
  // only open the trip.
  const isShared = !!trip.sharedFromEmail;
  const canEdit = !isShared || trip.sharedPermission === "edit";
  const canDelete = !isShared;
  const showMenu = canEdit || canDelete;

  const handleDelete = () => {
    if (confirm(`Delete "${trip.title}"? This cannot be undone.`)) {
      deleteTrip.mutate(trip.id, {
        onError: (err) => {
          toast.error(
            `Couldn't delete trip${err instanceof Error ? `: ${err.message}` : ""}`,
          );
        },
      });
    }
  };

  const handleRename = () => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    setRenaming(false);
    if (trimmed !== trip.title) {
      updateTrip.mutate(
        { title: trimmed },
        {
          onError: (err) => {
            toast.error(
              `Couldn't rename trip${err instanceof Error ? `: ${err.message}` : ""}`,
            );
          },
        },
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
      {
        onError: (err) => {
          toast.error(
            `Couldn't update status${err instanceof Error ? `: ${err.message}` : ""}`,
          );
        },
      },
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
                className="absolute right-1.5 top-1.5 z-10 h-8 w-8 bg-white/85 text-foreground shadow-sm backdrop-blur-sm hover:bg-white"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
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
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="h-7 text-base font-semibold"
            autoFocus
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
            className="h-7 w-7 shrink-0"
            disabled={!newTitle.trim() || updateTrip.isPending}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
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
          {formatDateRange(trip.startDate, trip.endDate)}
        </CardDescription>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge asChild variant="secondary" className={cn(statusColors[trip.status], "relative z-10 p-0")}>
            <button
              type="button"
              onClick={cycleStatus}
              disabled={updateTrip.isPending || !canEdit}
              title={
                canEdit
                  ? `Status: ${trip.status}. Click to advance.`
                  : `Status: ${trip.status}`
              }
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
    </Card>
  );
}
