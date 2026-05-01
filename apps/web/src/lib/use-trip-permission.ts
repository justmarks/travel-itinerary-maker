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
}

export function useTripPermission(tripId: string): TripPermission {
  const { isAuthenticated } = useAuth();
  const { data: trips } = useTrips({ enabled: isAuthenticated });

  const summary = trips?.find((t) => t.id === tripId);
  // Fallback: assume owner when we can't determine. Avoids flashing a
  // read-only UI for a frame while the trip list is still loading.
  if (!summary) {
    return {
      accessLevel: "owner",
      canEdit: true,
      isOwner: true,
      isReadOnly: false,
    };
  }
  if (!summary.sharedFromEmail) {
    return {
      accessLevel: "owner",
      canEdit: true,
      isOwner: true,
      isReadOnly: false,
    };
  }
  if (summary.sharedPermission === "edit") {
    return {
      accessLevel: "shared-edit",
      canEdit: true,
      isOwner: false,
      isReadOnly: false,
      sharedFromEmail: summary.sharedFromEmail,
    };
  }
  return {
    accessLevel: "shared-view",
    canEdit: false,
    isOwner: false,
    isReadOnly: true,
    sharedFromEmail: summary.sharedFromEmail,
  };
}
