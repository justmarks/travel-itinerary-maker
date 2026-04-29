"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import SharedTripClient from "./shared-trip-client";
import { useMobileRedirectTo } from "@/lib/mobile-redirect";

function MobileSharedRedirect(): null {
  // Mirror the home-page redirect: phone-sized viewports get the mobile
  // shared viewer at /m/shared (preserving the share token in the query).
  useMobileRedirectTo("/m/shared");
  return null;
}

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
      <MobileSharedRedirect />
      <SharedPageInner />
    </Suspense>
  );
}
