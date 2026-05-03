"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export const DESKTOP_OVERRIDE_KEY = "travel-app-prefer-desktop";

/**
 * Anything strictly below Tailwind's `md` breakpoint (768px) gets the mobile
 * shell. Tablets — iPad mini portrait (768), iPad regular (820+), iPad Pro
 * (1024+) — and desktops all land on the desktop shell, which is tuned via
 * `md:` / `lg:` Tailwind classes for tablet sizes. Phones in landscape
 * (≥640px on most modern phones) also land on desktop; that's a deliberate
 * trade for not maintaining a third tablet shell.
 */
const MOBILE_BREAKPOINT_PX = 767;

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
 *   2. `localStorage["travel-app-prefer-desktop"] === "1"` — set by the
 *      mobile user menu's "Use desktop site" action.
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
