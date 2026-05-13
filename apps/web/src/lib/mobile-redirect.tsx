"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export const DESKTOP_OVERRIDE_KEY = "itinly-prefer-desktop";
/** Predecessor key from before the `@travel-app/*` → `@itinly/*` rename.
 *  Migrated forward on read so users who set "Use desktop site" before
 *  the rename don't lose that preference. */
const LEGACY_DESKTOP_OVERRIDE_KEY = "travel-app-prefer-desktop";

/**
 * Anything strictly below Tailwind's `lg` breakpoint (1024px) gets the
 * mobile shell. That includes iPad mini portrait (768), iPad regular
 * portrait (820), iPad Pro 11" portrait (834), and large phones in
 * landscape — all of them render the desktop shell as a single thin
 * column because the trip list (`sm:grid-cols-2 lg:grid-cols-3`) and
 * the trip-detail itinerary (`grid-cols-1 lg:grid-cols-[1fr_280px]`)
 * only unlock their dense layouts at `lg`. iPad landscape (≥1024) and
 * iPad Pro 12.9" portrait (1024) stay on desktop where the layouts
 * have room to breathe. We tried sending tablets to desktop in
 * 580fd2a (May 2026) on the theory that `md:` classes would carry
 * the experience; in practice the chrome (max-w-5xl + p-8) felt
 * empty and the body-content columns stayed at 1.
 */
const MOBILE_BREAKPOINT_PX = 1023;

/** Persist "prefer the desktop site" so future visits to / skip the redirect. */
export function setDesktopOverride(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DESKTOP_OVERRIDE_KEY, "1");
  } catch {
    // Private mode / storage disabled — caller should still navigate.
  }
}

/** Clear the desktop preference so mobile-sized viewports auto-redirect again. */
export function clearDesktopOverride(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(DESKTOP_OVERRIDE_KEY);
  } catch {
    // Same as setDesktopOverride — silent fallback is fine.
  }
}

/**
 * Redirects mobile-sized viewports from the desktop home (/) to /m once on
 * mount. Honors three escape hatches so the redirect never traps a user:
 *
 *   1. `?desktop=1` in the URL — also persists the preference so the next
 *      visit goes straight to desktop without flashing /m first.
 *   2. `localStorage["itinly-prefer-desktop"] === "1"` — set by the
 *      mobile user menu's "Use desktop site" action. (The legacy key
 *      `travel-app-prefer-desktop` is migrated forward on first read.)
 *   3. `?demo=true` — keeps the demo flag intact when redirecting.
 *
 * Runs client-side rather than as middleware so the redirect honors the
 * three escape hatches above (which all live on the client). The brief
 * flash of the desktop page is acceptable for a one-time redirect;
 * subsequent navigations within /m don't re-trigger.
 */
export function useMobileHomeRedirect(): void {
  useMobileRedirectTo("/m");
}

/**
 * Same redirect logic as `useMobileHomeRedirect`, parameterised by the
 * mobile-equivalent path. Used so a recipient who opens a desktop share
 * URL on their phone bumps to the mobile shared viewer instead of the
 * desktop layout.
 */
export function useMobileRedirectTo(targetPath: string): void {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (typeof window === "undefined") return;

    // URL override — record the preference and stay on desktop.
    if (searchParams.get("desktop") === "1") {
      setDesktopOverride();
      return;
    }

    // Persisted preference — stay on desktop.
    let preferDesktop = false;
    try {
      // One-shot migration: forward the legacy value to the new key
      // on first read, then drop the legacy entry. Same pattern
      // `auth.tsx` uses for the auth-state key.
      const legacy = localStorage.getItem(LEGACY_DESKTOP_OVERRIDE_KEY);
      if (legacy !== null) {
        if (localStorage.getItem(DESKTOP_OVERRIDE_KEY) === null) {
          localStorage.setItem(DESKTOP_OVERRIDE_KEY, legacy);
        }
        localStorage.removeItem(LEGACY_DESKTOP_OVERRIDE_KEY);
      }
      preferDesktop = localStorage.getItem(DESKTOP_OVERRIDE_KEY) === "1";
    } catch {
      preferDesktop = false;
    }
    if (preferDesktop) return;

    const isMobileViewport =
      window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches;
    if (!isMobileViewport) return;

    // Preserve the existing query (token, demo, etc.) when redirecting.
    const qs = searchParams.toString();
    const target = qs ? `${targetPath}?${qs}` : targetPath;
    router.replace(target);
  }, [router, searchParams, targetPath]);
}
