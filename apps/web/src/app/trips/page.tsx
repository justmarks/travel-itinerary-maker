"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useDemoHref } from "@/lib/demo";
import TripDetailClient from "./trip-detail-client";

function TripPageInner() {
  const searchParams = useSearchParams();
  const tripId = searchParams.get("id");
  const homeHref = useDemoHref("/");

  if (!tripId) {
    return (
      <main className="min-h-screen p-8">
        <div className="mx-auto max-w-7xl">
          <Link href={homeHref}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
          <p className="mt-4 text-destructive">No trip selected.</p>
        </div>
      </main>
    );
  }

  return <TripDetailClient tripId={tripId} />;
}

export default function TripPage(): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen p-8">
          <div className="mx-auto max-w-7xl space-y-6">
            <div className="h-8 w-48 animate-pulse rounded bg-muted" />
            <div className="h-64 animate-pulse rounded-xl border bg-muted" />
          </div>
        </main>
      }
    >
      <TripPageInner />
    </Suspense>
  );
}
