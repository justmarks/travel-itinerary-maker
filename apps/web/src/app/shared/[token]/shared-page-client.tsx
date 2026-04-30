"use client";

import { Suspense } from "react";
import SharedTripClient from "./shared-trip-client";
import { useMobileRedirectTo } from "@/lib/mobile-redirect";

function MobileSharedRedirect({ token }: { token: string }): null {
  // Mirror the home-page redirect: phone-sized viewports get the mobile
  // shared viewer at /m/shared/<token>. The hook preserves any extra
  // query params (e.g. ?demo=true).
  useMobileRedirectTo(`/m/shared/${token}`);
  return null;
}

export default function SharedPageClient({
  token,
}: {
  token: string;
}): React.JSX.Element {
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
      <MobileSharedRedirect token={token} />
      <SharedTripClient token={token} />
    </Suspense>
  );
}
