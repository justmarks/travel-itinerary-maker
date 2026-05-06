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
 * Light-mode hex fallback per category. The fallback only fires on
 * SSR / first paint before the effect that reads `getComputedStyle`
 * runs; it MUST track the corresponding `--pin-*` token so first-paint
 * pins don't flash a stale hue.
 *
 * Each `--pin-{name}` aliases to the matching `--cat-*-fg`:
 *   transport → --cat-transport-fg = --seg-flight-fg   = #0284C7 (sky)
 *   hotel     → --cat-lodging-fg   = --seg-hotel-fg    = #6D28D9 (violet)
 *   activity  → --cat-activity-fg  = --seg-activity-fg = #15803D (green)
 *   dining    → --cat-dining-fg    = --seg-dinner-fg   = #B91C1C (red)
 */
const PIN_FALLBACK: Record<PinCategory, string> = {
  hotel:     "#6D28D9",
  dining:    "#B91C1C",
  activity:  "#15803D",
  transport: "#0284C7",
};

/**
 * Resolves the four `--pin-*` tokens off `:root` so SVG components
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
      return { ...PIN_FALLBACK };
    }
    const cs = getComputedStyle(document.documentElement);
    const read = (cat: PinCategory) =>
      cs.getPropertyValue(`--pin-${cat}`).trim() || PIN_FALLBACK[cat];
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
