"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@travel-app/api-client";

/**
 * Returns the set of trip IDs that currently have data in the React Query
 * cache (and therefore in localStorage, via persistQueryClient). When the
 * device is offline these are the only trips that can be opened from the
 * mobile list — trips the user has never viewed on this device aren't in
 * the cache and would just spin.
 *
 * Uses `useSyncExternalStore` rather than `useState` + `useEffect` because
 * the React Query cache subscribe callback can fire synchronously during
 * a child component's render (e.g. when a child triggers a query). With
 * useState that would tear down with "setState during render" warnings;
 * useSyncExternalStore is built for exactly this case and only re-renders
 * subscribers when our snapshot reference changes — so the ref-stable
 * snapshot below quietly absorbs cache events that don't change the set.
 */
export function useCachedTripIds(): Set<string> {
  const queryClient = useQueryClient();
  const snapshotRef = useRef<Set<string> | null>(null);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      // The React Query cache fires subscribers synchronously when a child
      // component (e.g. a TripCard hero) registers a useQuery during its
      // render. Notifying React mid-render trips the "update a component
      // while rendering a different component" warning even though
      // useSyncExternalStore would bail on an unchanged snapshot. Deferring
      // to a microtask lets the in-flight render complete first.
      return queryClient.getQueryCache().subscribe(() => {
        queueMicrotask(onStoreChange);
      });
    },
    [queryClient],
  );

  const getSnapshot = useCallback(() => {
    const next = collect(queryClient);
    if (snapshotRef.current && sameSet(snapshotRef.current, next)) {
      return snapshotRef.current;
    }
    snapshotRef.current = next;
    return next;
  }, [queryClient]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function collect(queryClient: ReturnType<typeof useQueryClient>): Set<string> {
  const out = new Set<string>();
  const all = queryClient.getQueryCache().findAll({ queryKey: queryKeys.trips });
  for (const query of all) {
    // queryKeys.trip(id) is `["trips", id]`. Skip the bare `["trips"]`
    // list query and any sub-keys (e.g. `["trips", id, "todos"]`).
    const key = query.queryKey;
    if (key.length !== 2) continue;
    if (typeof key[1] !== "string") continue;
    if (query.state.status !== "success") continue;
    if (query.state.data === undefined) continue;
    out.add(key[1]);
  }
  return out;
}

function sameSet<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
