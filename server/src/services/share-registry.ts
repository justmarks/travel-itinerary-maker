/**
 * Registry that maps share tokens to trip owner info.
 * Used by public shared routes to look up which user's Drive
 * contains the shared trip.
 *
 * Entries are created when a user creates a share link.
 * In production, this could be backed by Redis or a persistent store.
 */

export interface ShareEntry {
  shareToken: string;
  tripId: string;
  ownerUserId: string;
  createdAt: string;
}

export class ShareRegistry {
  private entries: Map<string, ShareEntry> = new Map();

  /** Register a share token mapping */
  register(shareToken: string, tripId: string, ownerUserId: string): void {
    this.entries.set(shareToken, {
      shareToken,
      tripId,
      ownerUserId,
      createdAt: new Date().toISOString(),
    });
  }

  /** Look up a share token */
  lookup(shareToken: string): ShareEntry | undefined {
    return this.entries.get(shareToken);
  }

  /** Remove a share token */
  remove(shareToken: string): void {
    this.entries.delete(shareToken);
  }

  /** Remove all shares for a given trip */
  removeByTrip(tripId: string): void {
    for (const [token, entry] of this.entries) {
      if (entry.tripId === tripId) {
        this.entries.delete(token);
      }
    }
  }

  /** Clear all entries (for testing) */
  clear(): void {
    this.entries.clear();
  }
}
