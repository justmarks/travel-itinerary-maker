"use client";

import { use } from "react";
import Link from "next/link";
import { useTrip } from "@travel-app/api-client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Calendar, MapPin } from "lucide-react";
import { ItineraryDay } from "@/components/itinerary-day";
import { TripTodos } from "@/components/trip-todos";
import { TripCosts } from "@/components/trip-costs";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  planning:  "bg-blue-100  text-blue-700",
  active:    "bg-green-100 text-green-700",
  completed: "bg-gray-100  text-gray-600",
  archived:  "bg-yellow-100 text-yellow-700",
};

function formatDateRange(start: string, end: string) {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
  const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", opts);
  return `${fmt(start)} – ${fmt(end)}`;
}

export default function TripDetailClient({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = use(params);
  const { data: trip, isLoading, error } = useTrip(tripId);

  if (isLoading) {
    return (
      <main className="min-h-screen p-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="h-64 animate-pulse rounded-xl border bg-muted" />
        </div>
      </main>
    );
  }

  if (error || !trip) {
    return (
      <main className="min-h-screen p-8">
        <div className="mx-auto max-w-7xl">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
          <p className="mt-4 text-destructive">Trip not found.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-7xl">

        {/* Header */}
        <Link href="/">
          <Button variant="ghost" size="sm" className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            All trips
          </Button>
        </Link>

        <div className="mb-8">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold">{trip.title}</h1>
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
                STATUS_STYLES[trip.status] ?? "bg-gray-100 text-gray-600",
              )}
            >
              {trip.status}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              {formatDateRange(trip.startDate, trip.endDate)}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              {trip.days.length} {trip.days.length === 1 ? "day" : "days"}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_280px]">

          {/* Day-by-day itinerary */}
          <div className="flex flex-col gap-8">
            {trip.days.map((day) => (
              <ItineraryDay key={day.date} day={day} tripId={trip.id} />
            ))}
          </div>

          {/* Sidebar */}
          <div className="flex flex-col gap-6">
            <div className="rounded-xl border p-5">
              <TripTodos tripId={trip.id} todos={trip.todos} />
            </div>
            <div className="rounded-xl border p-5">
              <TripCosts tripId={trip.id} />
            </div>
          </div>

        </div>
      </div>
    </main>
  );
}
