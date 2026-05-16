"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RequireAuth } from "@/components/require-auth";
import { useDemoHref } from "@/lib/demo";
import TripDetailClient from "./trip-detail-client";

function TripPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tripId = searchParams.get("id");
  const homeHref = useDemoHref("/");

  // No id → bounce to the trip list. The route used to render a red
  // "No trip selected." placeholder, which looked like a hard error
  // for a state that's just "URL is malformed / user followed a stale
  // link". /m/trip is treated the same way below.
  useEffect(() => {
    if (!tripId) router.replace(homeHref);
  }, [tripId, homeHref, router]);

  if (!tripId) return null;

  return <TripDetailClient tripId={tripId} />;
}

export default function TripPage(): React.JSX.Element {
  return (
    <RequireAuth>
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
    </RequireAuth>
  );
}
