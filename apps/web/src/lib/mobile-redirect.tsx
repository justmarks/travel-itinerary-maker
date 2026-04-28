"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const DESKTOP_OVERRIDE_KEY = "travel-app-prefer-desktop";
const MOBILE_BREAKPOINT_PX = 768;

/**
 * Redirects mobile-sized viewports from the desktop home (/) to /m once on
 * mount. Honors three escape hatches so the redirect never traps a user:
 *
 *   1. `?desktop=1` in the URL — also persists the preference so the next
 *      visit goes straight to desktop without flashing /m first.
 *   2. `localStorage["travel-app-prefer-desktop"] === "1"` — set by the
 *      mobile user menu's "Use desktop site" action.
 *   3. `?demo=true` — keeps the demo flag intact when redirecting.
 *
 * Static export means we can't use Next middleware in production, so this
 * runs client-side. The brief flash of the desktop page is acceptable for
 * a one-time redirect; subsequent navigations within /m don't re-trigger.
 */
export function useMobileHomeRedirect(): void {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (typeof window === "undefined") return;

    // URL override — record the preference and stay on desktop.
    if (searchParams.get("desktop") === "1") {
      try {
        localStorage.setItem(DESKTOP_OVERRIDE_KEY, "1");
      } catch {
        // Private mode / storage disabled: respect the URL flag for this
        // session only.
      }
      return;
    }

    // Persisted preference — stay on desktop.
    let preferDesktop = false;
    try {
      preferDesktop = localStorage.getItem(DESKTOP_OVERRIDE_KEY) === "1";
    } catch {
      preferDesktop = false;
    }
    if (preferDesktop) return;

    const isMobileViewport =
      window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches;
    if (!isMobileViewport) return;

    // Preserve the demo flag (and any other params) when redirecting.
    const qs = searchParams.toString();
    const target = qs ? `/m?${qs}` : "/m";
    router.replace(target);
  }, [router, searchParams]);
}
