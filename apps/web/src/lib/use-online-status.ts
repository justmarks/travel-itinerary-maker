"use client";

import { useEffect, useState } from "react";

/**
 * Returns whether the browser currently believes it has a network
 * connection. Defaults to `true` on the server / first paint so SSR markup
 * doesn't flicker an offline banner; flips to the real value on mount.
 *
 * `navigator.onLine` is best-effort — a phone on captive-portal Wi-Fi will
 * read as online but still fail real requests. We use it for the banner
 * only; mutations rely on the existing optimistic-update + toast pattern
 * to surface real failures.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}
