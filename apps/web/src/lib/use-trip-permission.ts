/**
 * Derives the current user's permission level on a trip by matching the
 * trip ID against the cached `GET /trips` summary list. Owned trips
 * return `accessLevel: "owner"`; trips with `sharedFromEmail` return the
 * matching share permission (`"shared-edit"` or `"shared-view"`).
 *
 * Why client-side derivation: the server already enforces permissions
 * via `accessTrip`; this hook just lets the UI hide affordances the
 * user can't successfully use, sparing them a round-trip + 403 toast
 * for every blocked action. A view-only contributor sees the trip in
 * read-only mode; an edit contributor sees most affordances but not
 * owner-only ones (delete, share roster).
 *
 * Falls back to "owner" when the trip isn't in the list — covers the
 * race where a deep-linked trip detail page renders before the trip
 * list has loaded. `enabled: isAuthenticated` keeps the list fetch
 * gated so unauthenticated demo viewers don't 401.
 */

import { useTrips } from "@travel-app/api-client";
import { useAuth } from "@/lib/auth";
import { useDemoMode } from "@/lib/demo";

export type TripAccessLevel = "owner" | "shared-edit" | "shared-view";

export interface TripPermission {
  accessLevel: TripAccessLevel;
  /** True for owners and edit contributors. */
  canEdit: boolean;
  /** True only for owners — gates delete, share roster, calendar sync. */
  isOwner: boolean;
  /** Convenience: opposite of `canEdit`. */
  isReadOnly: boolean;
  /** Owner's email when known — useful for "shared by …" affordances. */
  sharedFromEmail?: string;
  /**
   * Id of the share row that grants the current user access. Surfaced on
   * the summary by the server (or the mock for demo). Drives the "Leave
   * trip" affordance — when set, the recipient can revoke their own
   * access via `DELETE /trips/:id/shares/:shareId`. Absent on owned trips
   * and on anonymous link shares.
   */
  sharedShareId?: string;
  /**
   * Whether the share allows costs to be visible to the recipient.
   * Always true for owners. For shared trips, mirrors the per-share
   * `showCosts` flag the owner picked at share creation.
   */
  showCosts: boolean;
  /** Same idea for the to-do list. Always true for owners. */
  showTodos: boolean;
  /**
   * True while the trip-list query that backs the permission lookup
   * is still in flight. Consumers should hide owner-only chrome
   * (Share, status pill, etc.) while loading so a contributor doesn't
   * see the chrome flash in and then disappear once the real
   * permission resolves.
   */
  isLoading: boolean;
}

export function useTripPermission(tripId: string): TripPermission {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const isDemo = useDemoMode();
  // Fetch trips when authenticated OR in demo mode (the mock client
  // serves the list without needing auth, and demo trips can be
  // "shared with me" via the override map). Genuine unauthenticated
  // public viewers (no demo flag) skip the fetch and fall through to
  // the owner-default below.
  const { data: trips, isPending: tripsLoading } = useTrips({
    enabled: isAuthenticated || isDemo,
  });
  const isLoading =
    authLoading ||
    ((isAuthenticated || isDemo) && tripsLoading && trips === undefined);

  const summary = trips?.find((t) => t.id === tripId);
  // Owner / unknown-after-load: full chrome. The `isLoading` flag lets
  // callers hide the chrome until we know — the previous version
  // flashed it in and then disappeared once the real permission
  // resolved, which read as "buttons vanishing on hover".
  if (!summary || !summary.sharedFromEmail) {
    return {
      accessLevel: "owner",
      canEdit: true,
      isOwner: true,
      isReadOnly: false,
      showCosts: true,
      showTodos: true,
      isLoading,
    };
  }
  // Per-share visibility flags default to true for backwards compat
  // with shares created before the contributor flow surfaced them.
  const showCosts = summary.sharedShowCosts ?? true;
  const showTodos = summary.sharedShowTodos ?? true;
  if (summary.sharedPermission === "edit") {
    return {
      accessLevel: "shared-edit",
      canEdit: true,
      isOwner: false,
      isReadOnly: false,
      sharedFromEmail: summary.sharedFromEmail,
      sharedShareId: summary.sharedShareId,
      showCosts,
      showTodos,
      isLoading,
    };
  }
  return {
    accessLevel: "shared-view",
    canEdit: false,
    isOwner: false,
    isReadOnly: true,
    sharedFromEmail: summary.sharedFromEmail,
    sharedShareId: summary.sharedShareId,
    showCosts,
    showTodos,
    isLoading,
  };
}
