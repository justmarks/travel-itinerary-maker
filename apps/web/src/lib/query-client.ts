"use client";

import { QueryClient } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import type { PersistQueryClientOptions } from "@tanstack/react-query-persist-client";

const STORAGE_KEY = "itinly-rq-cache-v1";
// One week. Trip dates rarely shift week-to-week and stale data is still
// useful at the airport — fresher data wins as soon as the device is back
// online.
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

export interface WebQueryClient {
  queryClient: QueryClient;
  /**
   * Options to pass to `<PersistQueryClientProvider>`. Null when persistence
   * is disabled (demo mode, SSR, Safari private mode) so the caller can fall
   * back to a plain `<QueryClientProvider>`.
   */
  persistOptions: Omit<PersistQueryClientOptions, "queryClient"> | null;
}

/**
 * Builds the QueryClient used by the web app, plus the
 * `PersistQueryClientProvider` options that wire up `localStorage`
 * persistence so a previously-loaded trip is available offline (e.g. on a
 * plane).
 *
 * Persistence is opt-in: when `enabled` is false (demo mode, SSR) the
 * caller renders a plain `<QueryClientProvider>` instead — sample data
 * shouldn't leak between visits or collide with real-account data.
 *
 * Only trip-shaped query keys are persisted. Email scan results and
 * calendar listings are explicitly excluded — they're large, online-only,
 * and offer no offline value.
 */
export function createWebQueryClient(opts: { enabled: boolean }): WebQueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Long enough that React Query treats hydrated cache entries as
        // "fresh" instead of immediately refetching them on cold boot —
        // the offline use case relies on this.
        staleTime: 30_000,
        // Quietly fall back to the cache when offline; one retry is enough
        // to absorb a flaky single request without blocking the UI.
        retry: 1,
        gcTime: MAX_AGE_MS,
      },
    },
  });

  if (!opts.enabled || typeof window === "undefined") {
    return { queryClient, persistOptions: null };
  }

  let persister;
  try {
    persister = createSyncStoragePersister({
      storage: window.localStorage,
      key: STORAGE_KEY,
      throttleTime: 1_000,
    });
  } catch {
    // Safari private mode etc. — fall back to in-memory only.
    return { queryClient, persistOptions: null };
  }

  return {
    queryClient,
    persistOptions: {
      persister,
      maxAge: MAX_AGE_MS,
      dehydrateOptions: {
        shouldDehydrateQuery: (query) => {
          if (query.state.status !== "success") return false;
          const [root] = query.queryKey as [string, ...unknown[]];
          // Allow trips, shared trips, and todos/costs/segments under a trip.
          // Skip gmail/email/calendar queries — online-only data.
          return root === "trips" || root === "shared";
        },
      },
    },
  };
}
