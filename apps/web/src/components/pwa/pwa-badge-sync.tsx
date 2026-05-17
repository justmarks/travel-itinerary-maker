"use client";

import { useEffect } from "react";

/**
 * Clears the PWA app-icon badge whenever the app is in the foreground.
 *
 * The service worker increments a badge counter on every incoming push
 * (see `apps/web/public/sw.js` — `bumpBadge` inside the `push` handler)
 * so the installed PWA icon shows a number when notifications about
 * new shared trips / trip updates arrive while the app is closed.
 *
 * Once the user actually has the app open the badge has done its job,
 * so we tear it down on:
 *   - initial mount (fresh page load after a cold launch)
 *   - `visibilitychange` → `visible` (user tabs back from another tab
 *     or returns from the home screen on Android / iOS)
 *   - `focus` (browser-window focus on desktop; also fires on iOS
 *     Safari after a notification tap)
 *
 * The clear runs in two places because some platforms only support
 * one or the other:
 *   - `navigator.clearAppBadge()` from the page side: works on iOS
 *     16.4+ Safari (the page calls into the OS directly).
 *   - `postMessage({ type: "BADGE_CLEAR" })` to the SW: required on
 *     Chromium where the IDB-backed counter lives in the SW. Without
 *     this, the next push would resume from the old (high) count.
 *
 * Both calls are no-ops on platforms that don't support the Badging
 * API (Firefox, Safari < 16.4) — `'setAppBadge' in navigator` is the
 * feature check inside `clearPwaBadge`.
 */
function clearPwaBadge(): void {
  if (typeof navigator === "undefined") return;
  // Direct OS clear when the page has the privilege (iOS 16.4+ Safari
  // running as an installed PWA). Chromium's installed PWAs also let
  // the page call this — `setAppBadge` from the page side works on
  // Chrome desktop / Edge / Android Chrome.
  if ("clearAppBadge" in navigator) {
    void (navigator as Navigator & {
      clearAppBadge: () => Promise<void>;
    })
      .clearAppBadge()
      .catch(() => {
        // Silent: badge clear is best-effort. A failed clear leaves
        // the previous count on screen — annoying but not broken.
      });
  }
  // Tell the SW to reset its IDB-backed counter regardless of whether
  // the page-side clear succeeded. The counter is the source of truth
  // for the *next* push, so leaving it high would mean a single new
  // notification would render as "previous_count + 1" rather than 1.
  if (
    "serviceWorker" in navigator &&
    navigator.serviceWorker.controller
  ) {
    navigator.serviceWorker.controller.postMessage({ type: "BADGE_CLEAR" });
  }
}

export function PwaBadgeSync(): null {
  useEffect(() => {
    // Fire once on mount (cold launch / SPA nav into a fresh page).
    clearPwaBadge();

    const onVisibility = () => {
      if (document.visibilityState === "visible") clearPwaBadge();
    };
    const onFocus = () => clearPwaBadge();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  return null;
}
