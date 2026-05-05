"use client";

import { useMemo } from "react";
import { useTheme } from "next-themes";

/**
 * Map-pin category — the four-bucket collapse used by both the desktop
 * Map view and the mobile per-day mini-map. Mirrors the `Category`
 * union in those components but lives here so the pin-color hook is
 * the single source of truth.
 */
export type PinCategory = "hotel" | "dining" | "activity" | "transport";

/**
 * Maps each pin category to the matching `--cat-{name}-fg` design-system
 * token name plus a light-mode hex fallback. The fallback only fires on
 * SSR / first paint before the effect that reads `getComputedStyle`
 * runs; it MUST track the corresponding token so first-paint pins don't
 * flash a stale hue.
 */
const CATEGORY_TOKEN: Record<PinCategory, { token: string; fallback: string }> = {
  // Fallbacks track the bundle's `--cat-*-fg` light-mode values (which
  // alias to the matching `--seg-*-fg` token):
  //   transport → flight   (sky)    → --seg-flight-fg   = #0284C7
  //   lodging   → hotel    (violet) → --seg-hotel-fg    = #6D28D9
  //   activity  → activity (green)  → --seg-activity-fg = #15803D
  //   dining    → dinner   (red)    → --seg-dinner-fg   = #B91C1C
  hotel:     { token: "lodging",   fallback: "#6D28D9" },
  dining:    { token: "dining",    fallback: "#B91C1C" },
  activity:  { token: "activity",  fallback: "#15803D" },
  transport: { token: "transport", fallback: "#0284C7" },
};

/**
 * Resolves the four `--cat-*-fg` tokens off `:root` so SVG components
 * (Google Maps `<Pin>`, …) — which don't pick up CSS variables — can
 * render with the design-system colors. Re-runs when next-themes flips
 * `resolvedTheme` so dark-mode lifts apply.
 *
 * Used by both `components/map-view.tsx` and
 * `components/mobile/mobile-day-map.tsx` so the desktop and mobile pin
 * palettes never drift.
 */
export function useCategoryPinColors(): Record<PinCategory, string> {
  const { resolvedTheme } = useTheme();
  return useMemo(() => {
    if (typeof window === "undefined") {
      return {
        hotel:     CATEGORY_TOKEN.hotel.fallback,
        dining:    CATEGORY_TOKEN.dining.fallback,
        activity:  CATEGORY_TOKEN.activity.fallback,
        transport: CATEGORY_TOKEN.transport.fallback,
      };
    }
    const cs = getComputedStyle(document.documentElement);
    const read = (cat: PinCategory) =>
      cs.getPropertyValue(`--cat-${CATEGORY_TOKEN[cat].token}-fg`).trim() ||
      CATEGORY_TOKEN[cat].fallback;
    return {
      hotel:     read("hotel"),
      dining:    read("dining"),
      activity:  read("activity"),
      transport: read("transport"),
    };
    // resolvedTheme is the trigger; we read the live computed style on
    // every theme flip so dark-mode lifts apply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme]);
}

/**
 * Token name for a category. Useful when a consumer wants to render the
 * legend swatch via CSS (where vars resolve normally) instead of the
 * runtime hook.
 */
export function categoryTokenName(category: PinCategory): string {
  return CATEGORY_TOKEN[category].token;
}
