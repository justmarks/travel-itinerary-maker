"use client";

import Link from "next/link";
import type { TripSummary } from "@travel-app/api-client";
import { useDeleteTrip } from "@travel-app/api-client";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Calendar, MapPin, MoreVertical, Trash2 } from "lucide-react";

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

  const handleDelete = () => {
    if (confirm(`Delete "${trip.title}"? This cannot be undone.`)) {
      deleteTrip.mutate(trip.id);
    }
  };

  return (
    <Card className="group relative transition-shadow hover:shadow-md">
      <Link href={`/trips/${trip.id}`} className="absolute inset-0 z-0" />
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-lg">{trip.title}</CardTitle>
          <CardDescription className="flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            {formatDateRange(trip.startDate, trip.endDate)}
          </CardDescription>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative z-10 h-8 w-8"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
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
      <CardContent>
        <div className="flex items-center gap-3">
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
