"use client";

import { Suspense, useEffect, useState } from "react";
import SharedTripClient from "./shared-trip-client";
import { useMobileRedirectTo } from "@/lib/mobile-redirect";

function MobileSharedRedirect({ token }: { token: string }): null {
  // Mirror the home-page redirect: phone-sized viewports get the mobile
  // shared viewer at /m/shared/<token>. The hook preserves any extra
  // query params (e.g. ?demo=true).
  useMobileRedirectTo(`/m/shared/${token}`);
  return null;
}

function SharedLoadingFallback() {
  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-64 animate-pulse rounded-xl border bg-muted" />
      </div>
    </main>
  );
}

export default function SharedPageClient({
  token,
}: {
  token: string;
}): React.JSX.Element {
  // The shared trip view is pure client-side — there's no useful SSR
  // for it (the trip data is fetched at runtime via React Query, and
  // unauthed visitors can't be SSR-personalised). Holding off on
  // rendering the real tree until after mount kills a recurring
  // React #418 hydration error (QA bug #25 / prior session) without
  // changing what the user sees: they always get the loading
  // skeleton first regardless of where the render came from.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <SharedLoadingFallback />;
  }

  return (
    <Suspense fallback={<SharedLoadingFallback />}>
      <MobileSharedRedirect token={token} />
      <SharedTripClient token={token} />
    </Suspense>
  );
}
