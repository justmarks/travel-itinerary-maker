"use client";

import { QueryClient } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import {
  persistQueryClient,
  type Persister,
} from "@tanstack/react-query-persist-client";

const STORAGE_KEY = "itinly-rq-cache-v1";
// One week. Trip dates rarely shift week-to-week and stale data is still
// useful at the airport — fresher data wins as soon as the device is back
// online.
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;

/**
 * Builds the QueryClient used by the web app, wired up with localStorage
 * persistence so a previously-loaded trip is available offline (e.g. on a
 * plane). Returns the client and a teardown function for tests.
 *
 * Persistence is opt-in: when `enabled` is false (demo mode, SSR) the
 * client is returned without a persister so the in-memory mock data
 * doesn't leak between sessions.
 *
 * Only trip-shaped query keys are persisted. Email scan results and
 * calendar listings are explicitly excluded — they're large, online-only,
 * and offer no offline value.
 */
export function createWebQueryClient(opts: { enabled: boolean }): {
  queryClient: QueryClient;
  teardown: () => void;
} {
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
    return { queryClient, teardown: () => {} };
  }

  let persister: Persister | undefined;
  try {
    persister = createSyncStoragePersister({
      storage: window.localStorage,
      key: STORAGE_KEY,
      throttleTime: 1_000,
    });
  } catch {
    // Safari private mode etc. — fall back to in-memory only.
    return { queryClient, teardown: () => {} };
  }

  const [unsubscribe] = persistQueryClient({
    queryClient,
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
  });

  return { queryClient, teardown: unsubscribe };
}
