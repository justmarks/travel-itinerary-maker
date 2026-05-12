"use client";

import { useEffect } from "react";

/**
 * Registers `/sw.js` on first client mount. Mounted once at the root of the
 * provider tree; idempotent because the browser deduplicates registrations
 * at the same scope.
 *
 * Disabled in development (Next dev server emits unhashed HMR chunks that
 * the SW would happily serve stale). The SW only ships in production
 * builds, so it can't accidentally trap a developer in a stale `pnpm dev`
 * shell.
 *
 * In development we go further: actively unregister any SW left over from
 * a prior `pnpm start` / production-mode session on the same origin and
 * wipe the `itinly-*` cache buckets. Without this, the cache-first
 * `/_next/static/*` strategy in `sw.js` keeps serving chunks from the
 * previous build's `node_modules/.pnpm/next@..._<hash>/...` paths after
 * the pnpm hash changes, producing `React is undefined` /
 * `Class extends value undefined` crashes that only clear with a manual
 * DevTools → Application → Clear site data.
 */
export function ServiceWorkerRegister(): null {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void (async () => {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((r) => r.unregister()));
        } catch (err) {
          console.warn("[sw] dev unregister failed", err);
        }
        try {
          const keys = await caches.keys();
          await Promise.all(
            keys.filter((k) => k.startsWith("itinly-")).map((k) => caches.delete(k)),
          );
        } catch (err) {
          console.warn("[sw] dev cache clear failed", err);
        }
      })();
      return;
    }

    let cancelled = false;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });
        if (cancelled) return;

        // If a new SW is already waiting (user came back to a tab after a
        // deploy), tell it to take over immediately.
        if (registration.waiting) {
          registration.waiting.postMessage("SKIP_WAITING");
        }
        registration.addEventListener("updatefound", () => {
          const next = registration.installing;
          if (!next) return;
          next.addEventListener("statechange", () => {
            if (next.state === "installed" && navigator.serviceWorker.controller) {
              // A new version installed alongside an active controller —
              // activate it on the next nav rather than waiting for all
              // tabs to close.
              next.postMessage("SKIP_WAITING");
            }
          });
        });
      } catch (err) {
        console.warn("[sw] registration failed", err);
      }
    };

    void register();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
