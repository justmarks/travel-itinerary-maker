"use client";

import { useEffect, useState } from "react";

/**
 * One-time onboarding hints — small UI nudges that should fire once
 * per device and never again. Each hint key maps to a localStorage
 * flag (`itinly:hint:{key}`); writing the flag is permanent unless the
 * user clears site data.
 *
 * Three hints exist today:
 *   - `pwa-install`         — banner on the mobile shell that pushes
 *                              "Add to Home Screen" / install-as-app
 *                              the first time a user lands on /m.
 *   - `share-notifications` — Sonner toast on the first share creation
 *                              that offers to turn on push so the
 *                              owner gets pinged when recipients open
 *                              the trip.
 *   - `intro-tour`          — multi-step welcome dialog shown the first
 *                              time an authenticated user lands on the
 *                              app on a given device. Walks through the
 *                              core features (manage trips, build from
 *                              email, share, install).
 *
 * Hints write the dismissal flag eagerly (once shown / acted on) — the
 * UX is "we surface this exactly once, regardless of what the user
 * does about it" rather than "we keep nagging until acted on."
 */

const STORAGE_PREFIX = "itinly:hint:";

export type OnboardingHintKey =
  | "pwa-install"
  | "share-notifications"
  | "intro-tour";

function storageKey(key: OnboardingHintKey): string {
  return `${STORAGE_PREFIX}${key}`;
}

export function isHintDismissed(key: OnboardingHintKey): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(storageKey(key)) === "1";
  } catch {
    // localStorage can throw in private-mode Safari and when the
    // origin's quota is exhausted — treat both as "never seen" so the
    // hint can still be tried.
    return false;
  }
}

export function dismissHint(key: OnboardingHintKey): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(key), "1");
  } catch {
    // Same private-mode / quota concerns — the worst case is that the
    // hint shows again next visit, which is still strictly better than
    // throwing.
  }
}

/**
 * Reactive accessor for a hint's dismissal flag, for components that
 * render conditionally based on it. Defaults to "dismissed" during SSR
 * / first paint so the hint UI stays out of the static HTML and only
 * pops in after hydration — that avoids both a hydration mismatch
 * warning AND a flash of a hint that the user has already dismissed.
 */
export function useHintActive(key: OnboardingHintKey): {
  active: boolean;
  dismiss: () => void;
} {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(isHintDismissed(key));
  }, [key]);

  return {
    active: !dismissed,
    dismiss: () => {
      dismissHint(key);
      setDismissed(true);
    },
  };
}
