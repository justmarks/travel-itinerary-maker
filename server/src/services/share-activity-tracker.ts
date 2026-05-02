/**
 * Throttle for "recipient viewed / edited a shared trip" pushes.
 *
 * Keeps an in-memory map of `(shareId, kind) → lastFiredAt`. The trip
 * routes call `shouldFire()` before doing the work — if it returns
 * false the request goes through normally but we skip the disk write
 * AND the push, so a recipient scrolling around doesn't churn the
 * trip JSON or spam the owner with notifications.
 *
 * The throttle is intentionally in-memory only:
 *   - View / edit activity is ephemeral signal, not an audit log.
 *   - A server restart clearing it just means the recipient's next
 *     activity fires one extra push — acceptable tradeoff for not
 *     touching Redis on every shared-trip read.
 *   - The persisted `lastViewedAt` / `lastEditedAt` on the share are
 *     the durable record; this map only governs *write* and *push*
 *     frequency.
 *
 * Window: 30 minutes by default. Tuned so an active recipient
 * generates one push per "session" rather than one per page-load.
 */

export type ShareActivityKind = "view" | "edit";

export interface ShareActivityTrackerOptions {
  /** Override the throttle window (ms). Defaults to 30 minutes. */
  windowMs?: number;
  /** Override the clock for tests. Defaults to `Date.now`. */
  now?: () => number;
}

export class ShareActivityTracker {
  private lastFired: Map<string, number> = new Map();
  private windowMs: number;
  private now: () => number;

  constructor(options: ShareActivityTrackerOptions = {}) {
    this.windowMs = options.windowMs ?? 30 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  /**
   * Returns true if enough time has elapsed since the last fire for
   * this share+kind. Side-effect: records the new fire-time so a
   * subsequent call within the window returns false. Callers should
   * branch on the return value before doing any throttled work.
   */
  shouldFire(shareId: string, kind: ShareActivityKind): boolean {
    const key = `${shareId}:${kind}`;
    const now = this.now();
    const last = this.lastFired.get(key);
    if (last !== undefined && now - last < this.windowMs) {
      return false;
    }
    this.lastFired.set(key, now);
    return true;
  }

  /** Test helper. */
  clear(): void {
    this.lastFired.clear();
  }
}
