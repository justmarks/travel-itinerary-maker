"use client";

export function generateStaticParams() {
  return [];
}

import { use } from "react";
import Link from "next/link";
import { useTrip } from "@travel-app/api-client";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function TripDetailPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = use(params);
  const { data: trip, isLoading, error } = useTrip(tripId);

  if (isLoading) {
    return (
      <main className="min-h-screen p-8">
        <div className="mx-auto max-w-7xl">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="mt-6 h-64 animate-pulse rounded-xl border bg-muted" />
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
        <div className="mb-6 flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">{trip.title}</h1>
        </div>
        <p className="text-muted-foreground">
          {trip.startDate} to {trip.endDate} &middot; {trip.days.length} days
        </p>
        <div className="mt-8 rounded-xl border border-dashed p-12 text-center text-muted-foreground">
          Itinerary table coming soon.
        </div>
      </div>
    </main>
  );
}
