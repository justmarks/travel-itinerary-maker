"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
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
 * gradient fallback. The city + country flag are overlaid bottom-left, and
 * an upcoming-trip countdown sits top-right.
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
        <Image
          src={image.url}
          alt={trip.primaryCity ?? trip.title}
          fill
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          className="object-cover"
          unoptimized
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
      {showCountdown && countdownLabel && (
        <Badge
          variant="secondary"
          className="absolute right-2 top-2 z-10 bg-white/90 text-foreground shadow-sm backdrop-blur-sm"
        >
          {countdownLabel}
        </Badge>
      )}
      {trip.primaryCity && (
        <div className="absolute bottom-2 left-3 right-3 flex items-end gap-2 text-white">
          {flag && (
            <span className="text-2xl leading-none drop-shadow-sm" aria-hidden>
              {flag}
            </span>
          )}
          <span className="truncate text-lg font-semibold leading-tight drop-shadow-sm">
            {trip.primaryCity}
          </span>
        </div>
      )}
    </div>
  );
}

export function TripCard({ trip }: { trip: TripSummary }): React.JSX.Element {
  const deleteTrip = useDeleteTrip();
  const updateTrip = useUpdateTrip(trip.id);
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(trip.title);
  const tripHref = useDemoHref(`/trips/?id=${trip.id}`);

  const handleDelete = () => {
    if (confirm(`Delete "${trip.title}"? This cannot be undone.`)) {
      deleteTrip.mutate(trip.id);
    }
  };

  const handleRename = () => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    setRenaming(false);
    if (trimmed !== trip.title) {
      updateTrip.mutate({ title: trimmed });
    }
  };

  const cycleStatus = (e: React.MouseEvent) => {
    // The card is wrapped in a <Link> overlay; stop propagation so clicking
    // the chip doesn't also navigate into the trip.
    e.preventDefault();
    e.stopPropagation();
    updateTrip.mutate({ status: nextStatus(trip.status) });
  };

  return (
    <Card className="group relative flex h-full flex-col gap-4 overflow-hidden pt-0 transition-shadow hover:shadow-md">
      {!renaming && (
        <Link
          href={tripHref}
          className="absolute inset-0 z-0"
          aria-label={trip.title}
        />
      )}
      <TripCardHero trip={trip} />
      <div className="flex flex-row items-start justify-between gap-2 px-6">
        <div className="min-w-0 flex-1 space-y-1">
          {renaming ? (
            <form
              className="relative z-10 flex items-center gap-1.5"
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
          ) : (
            <h3
              className="line-clamp-2 text-base font-semibold leading-tight"
              title={trip.title}
            >
              {trip.title}
            </h3>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative z-10 -mt-1 h-8 w-8"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => {
                setNewTitle(trip.title);
                setRenaming(true);
              }}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onClick={handleDelete}
              disabled={deleteTrip.isPending}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
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
              disabled={updateTrip.isPending}
              title={`Status: ${trip.status}. Click to advance.`}
              className="cursor-pointer px-2 py-0.5 capitalize hover:opacity-80 disabled:cursor-wait"
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
