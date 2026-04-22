"use client";

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";

/**
 * Runtime demo mode detection via `?demo=true` querystring.
 *
 * Replaces the old build-time `NEXT_PUBLIC_DEMO_MODE` env var so that
 * GitHub Pages can serve both the real login flow AND demo content
 * from the same build — the user just toggles the URL param.
 */

function getSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("demo") === "true";
}

function getServerSnapshot(): boolean {
  return false;
}

function subscribe(callback: () => void): () => void {
  // Re-check on popstate (back/forward navigation)
  window.addEventListener("popstate", callback);

  // Next.js client-side navigation uses pushState/replaceState which don't
  // fire popstate. Patch them so we detect ?demo=true changes immediately.
  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);

  history.pushState = (...args) => {
    origPush(...args);
    callback();
  };
  history.replaceState = (...args) => {
    origReplace(...args);
    callback();
  };

  return () => {
    window.removeEventListener("popstate", callback);
    history.pushState = origPush;
    history.replaceState = origReplace;
  };
}

const DemoContext = createContext(false);

export function DemoProvider({ children }: { children: React.ReactNode }) {
  const isDemo = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <DemoContext.Provider value={isDemo}>
      {children}
    </DemoContext.Provider>
  );
}

/**
 * Returns true when `?demo=true` is in the current URL.
 * Must be used within `<DemoProvider>`.
 */
export function useDemoMode(): boolean {
  return useContext(DemoContext);
}

/**
 * Returns the current URL path with `?demo=true` appended (for links
 * that should preserve demo mode when navigating).
 */
export function useDemoHref(path: string): string {
  const isDemo = useDemoMode();
  if (!isDemo) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}demo=true`;
}
