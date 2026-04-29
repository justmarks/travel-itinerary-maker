/**
 * Helper that rebuilds share-registry entries for a single user by scanning
 * their trips on Drive. The in-memory ShareRegistry doesn't survive server
 * restarts, so we use this on two recovery paths:
 *
 *   1. After login: pre-warm the registry with the user's own shares so
 *      recipients can resolve them immediately.
 *   2. From `/shared/:token` on a registry miss: walk every known user
 *      until we find the trip that carries the token, then register it
 *      so subsequent lookups are O(1).
 *
 * Failures (expired access tokens, Drive errors) are swallowed and logged.
 * The caller treats the registry as best-effort — the share route falls
 * back to "not found" if the rescan can't locate the token.
 */

import type { ShareRegistry } from "./share-registry";
import type { TokenStore } from "./token-store";
import { DriveStorage } from "./google-drive/drive-storage";

export async function rebuildRegistryForUser(
  userId: string,
  shareRegistry: ShareRegistry,
  tokenStore: TokenStore,
): Promise<{ registered: number } | null> {
  const accessToken = await tokenStore.getAccessToken(userId);
  if (!accessToken) return null;

  const ownerEntry = tokenStore.get(userId);
  const ownerEmail = ownerEntry?.email;

  let trips;
  try {
    const storage = new DriveStorage({ accessToken });
    trips = await storage.listTrips();
  } catch (err) {
    console.warn(
      `[registry-rebuild] listTrips failed for user ${userId}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }

  // ownerEmail is captured from the tokenStore so future code (the PR-B
  // contributor flow) can attribute shared trips back to the owner without
  // a second tokenStore lookup. Today's ShareRegistry only persists the
  // first three positional fields; the others are dropped on re-register.
  void ownerEmail;

  let registered = 0;
  for (const trip of trips) {
    for (const share of trip.shares) {
      shareRegistry.register(share.shareToken, trip.id, userId);
      registered += 1;
    }
  }
  return { registered };
}
