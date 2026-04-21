"use client";

import { useState } from "react";
import Link from "next/link";
import type { TripSummary } from "@travel-app/api-client";
import { useDemoHref } from "@/lib/demo";
import { useDeleteTrip, useUpdateTrip } from "@travel-app/api-client";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
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
  MapPin,
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
  archived: "bg-yellow-100 text-yellow-800",
};

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

export function TripCard({ trip }: { trip: TripSummary }) {
  const deleteTrip = useDeleteTrip();
  const updateTrip = useUpdateTrip(trip.id);
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState(trip.title);
  const tripHref = useDemoHref(`/trips/${trip.id}`);

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

  return (
    <Card className="group relative flex h-full flex-col transition-shadow hover:shadow-md">
      {!renaming && (
        <Link href={tripHref} className="absolute inset-0 z-0" />
      )}
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
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
            // Reserve space for up to 2 lines so dates always sit in the
            // same vertical position across cards regardless of title length.
            <CardTitle
              className="line-clamp-2 min-h-[3.5rem] text-lg leading-tight"
              title={trip.title}
            >
              {trip.title}
            </CardTitle>
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
      </CardHeader>
      <CardContent className="mt-auto space-y-3">
        <CardDescription className="flex items-center gap-1">
          <Calendar className="h-3.5 w-3.5" />
          {formatDateRange(trip.startDate, trip.endDate)}
        </CardDescription>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge variant="secondary" className={statusColors[trip.status]}>
            {trip.status}
          </Badge>
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" />
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
