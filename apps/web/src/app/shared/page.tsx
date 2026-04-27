"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import SharedTripClient from "./shared-trip-client";

function SharedPageInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  if (!token) {
    return (
      <main className="min-h-screen p-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-destructive">Missing share token.</p>
        </div>
      </main>
    );
  }

  return <SharedTripClient token={token} />;
}

export default function SharedPage(): React.JSX.Element {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen p-8">
          <div className="mx-auto max-w-5xl space-y-6">
            <div className="h-8 w-48 animate-pulse rounded bg-muted" />
            <div className="h-64 animate-pulse rounded-xl border bg-muted" />
          </div>
        </main>
      }
    >
      <SharedPageInner />
    </Suspense>
  );
}
