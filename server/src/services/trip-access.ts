/**
 * Authorisation helper for trip routes. Encapsulates the "is this user
 * allowed to read / write this trip?" decision so route handlers don't
 * have to re-implement the owner-vs-contributor branching every time.
 *
 * Two access paths:
 *
 *   1. Owner — the trip lives in the requester's own Drive. The route
 *      handler hits the request-scoped storage and gets the trip back.
 *   2. Shared contributor — the trip lives in some other user's Drive,
 *      but the share registry has an entry tying the requester's email
 *      to the trip with a known permission. We mint the *owner's*
 *      access token via `resolveOwnerStorage`, fetch from their Drive,
 *      and (when the requested permission ≤ granted permission) return
 *      that storage so subsequent saves write back into the owner's
 *      Drive — not a forked copy on the contributor's account.
 *
 * Memory-mode dev / tests don't use the shared path: they share a
 * single InMemoryStorage so the owner branch always matches.
 */

import type { Request } from "express";
import type { SharePermission, Trip } from "@travel-app/shared";
import type { ShareRegistry } from "./share-registry";
import type { StorageProvider, StorageResolver } from "./storage";

export type AccessLevel = "owner" | "shared-view" | "shared-edit";

/** Mints owner-side storage. Returns null when the owner's auth expired. */
export type ResolveOwnerStorage = (
  ownerUserId: string,
) => Promise<StorageProvider | null>;

export interface AccessGranted {
  ok: true;
  trip: Trip;
  /** Storage to operate on for further reads / writes. Always the owner's. */
  storage: StorageProvider;
  accessLevel: AccessLevel;
  /** Owner's email, when known — surfaced as `sharedFromEmail` in summaries. */
  ownerEmail?: string;
}

export interface AccessDenied {
  ok: false;
  status: 404 | 403 | 503;
  reason:
    | "trip-not-found"
    | "shared-view-only"
    | "owner-auth-expired"
    | "trip-deleted-by-owner";
}

export type AccessResult = AccessGranted | AccessDenied;

export interface ResolveTripAccessOptions {
  req: Request;
  tripId: string;
  /** "view" allows owners + view/edit shares; "edit" requires owner or edit share. */
  requiredPermission: SharePermission;
  getStorage: StorageResolver;
  shareRegistry?: ShareRegistry;
  resolveOwnerStorage?: ResolveOwnerStorage;
}

/**
 * Resolve a trip the requester is trying to access. Always tries the
 * owner path first (cheap — one Drive read). Falls through to the share
 * registry only if the trip isn't in the requester's own storage.
 */
export async function resolveTripAccess(
  opts: ResolveTripAccessOptions,
): Promise<AccessResult> {
  // 1) Owner path. A successful read here means the requester literally
  //    owns the trip — no permission check required.
  let ownStorage: StorageProvider;
  try {
    ownStorage = opts.getStorage(opts.req);
  } catch {
    // Public route with no resolved storage. The shared path may still
    // succeed if the registry has an entry.
    return resolveSharedTrip(opts);
  }

  let ownTrip: Trip | null = null;
  try {
    ownTrip = await ownStorage.getTrip(opts.tripId);
  } catch {
    ownTrip = null;
  }
  if (ownTrip) {
    return {
      ok: true,
      trip: ownTrip,
      storage: ownStorage,
      accessLevel: "owner",
    };
  }

  return resolveSharedTrip(opts);
}

async function resolveSharedTrip(
  opts: ResolveTripAccessOptions,
): Promise<AccessResult> {
  const email = opts.req.userEmail;
  if (
    !email ||
    !opts.shareRegistry ||
    !opts.resolveOwnerStorage
  ) {
    return { ok: false, status: 404, reason: "trip-not-found" };
  }

  const matching = opts.shareRegistry
    .lookupByEmail(email)
    .find((s) => s.tripId === opts.tripId);
  if (!matching) {
    return { ok: false, status: 404, reason: "trip-not-found" };
  }
  if (opts.requiredPermission === "edit" && matching.permission !== "edit") {
    return { ok: false, status: 403, reason: "shared-view-only" };
  }

  const ownerStorage = await opts.resolveOwnerStorage(matching.ownerUserId);
  if (!ownerStorage) {
    return { ok: false, status: 503, reason: "owner-auth-expired" };
  }

  let trip: Trip | null = null;
  try {
    trip = await ownerStorage.getTrip(opts.tripId);
  } catch {
    trip = null;
  }
  if (!trip) {
    // Registry says we have access but the owner has since deleted the
    // trip in Drive. Treat as 404 (we'll opportunistically clean up
    // stale registry entries elsewhere).
    return { ok: false, status: 404, reason: "trip-deleted-by-owner" };
  }

  return {
    ok: true,
    trip,
    storage: ownerStorage,
    accessLevel: matching.permission === "edit" ? "shared-edit" : "shared-view",
    ownerEmail: matching.ownerEmail,
  };
}

export interface SharedTripWithMeta {
  trip: Trip;
  ownerEmail?: string;
  permission: SharePermission;
}

/**
 * List every trip that has been shared with `userEmail`. Groups by
 * owner so we mint each owner's access token at most once. Failures
 * (revoked tokens, deleted trips) are silently skipped — a contributor's
 * own owned trips should never be hidden because some other owner's
 * Drive happens to be unavailable.
 */
export async function listSharedTrips(opts: {
  userEmail: string | undefined;
  shareRegistry?: ShareRegistry;
  resolveOwnerStorage?: ResolveOwnerStorage;
}): Promise<SharedTripWithMeta[]> {
  if (!opts.userEmail || !opts.shareRegistry || !opts.resolveOwnerStorage) {
    return [];
  }
  const shares = opts.shareRegistry.lookupByEmail(opts.userEmail);
  if (shares.length === 0) return [];

  // Bucket shares by owner so we mint each owner's access token once.
  const byOwner = new Map<string, typeof shares>();
  for (const share of shares) {
    const list = byOwner.get(share.ownerUserId) ?? [];
    list.push(share);
    byOwner.set(share.ownerUserId, list);
  }

  const result: SharedTripWithMeta[] = [];
  for (const [ownerUserId, ownerShares] of byOwner) {
    let ownerStorage: StorageProvider | null = null;
    try {
      ownerStorage = await opts.resolveOwnerStorage(ownerUserId);
    } catch {
      ownerStorage = null;
    }
    if (!ownerStorage) continue;

    for (const share of ownerShares) {
      try {
        const trip = await ownerStorage.getTrip(share.tripId);
        if (!trip) continue;
        result.push({
          trip,
          ownerEmail: share.ownerEmail,
          permission: share.permission,
        });
      } catch {
        // Drive read failed for this trip — skip; the rest of the
        // owner's shared trips can still resolve.
        continue;
      }
    }
  }
  return result;
}
