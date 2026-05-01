/**
 * Detects whether the current viewer of a /shared/<token> page owns the
 * trip — or holds an edit-permission share for it — and redirects them
 * to their normal trip view. View-share recipients and unauthenticated
 * viewers fall through and see the public read-only viewer.
 *
 * Why: a logged-in trip owner who clicks their own share link doesn't
 * want to see the stripped-down public viewer — they want their full
 * authoring page. Same goes for an edit-share contributor; the
 * contributor flow (PR #107) already exposes the trip in their
 * `GET /trips` list, so we can short-circuit straight to it.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTrips } from "@travel-app/api-client";
import { useAuth } from "@/lib/auth";

export function useShareLinkOwnerRedirect({
  tripId,
  targetPath,
}: {
  /** Trip ID resolved from the share token — undefined while the public share endpoint is still loading. */
  tripId: string | undefined;
  /** Path to redirect to when the viewer is eligible (e.g. `/trips?id=…` on desktop, `/m/trip?id=…` on mobile). */
  targetPath: string;
}): { shouldRedirect: boolean } {
  const { isAuthenticated } = useAuth();
  // Only fetch the user's trip list when authenticated — `/api/v1/trips`
  // 401s otherwise, which would put React Query into an error state and
  // pollute the console.
  const { data: ownTrips } = useTrips({ enabled: isAuthenticated });
  const router = useRouter();

  const matched =
    tripId && ownTrips ? ownTrips.find((t) => t.id === tripId) : undefined;
  // Owner: in our trip list with no `sharedFromEmail` set.
  // Edit contributor: in our trip list with `sharedPermission === "edit"`.
  // View contributor: stays on the public viewer.
  const shouldRedirect =
    !!matched &&
    (!matched.sharedFromEmail || matched.sharedPermission === "edit");

  useEffect(() => {
    if (shouldRedirect) {
      router.replace(targetPath);
    }
  }, [shouldRedirect, targetPath, router]);

  return { shouldRedirect };
}
