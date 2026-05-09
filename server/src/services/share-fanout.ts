import type { Request } from "express";
import {
  formatTripDateRange,
  generateId,
  type SharePermission,
  type Trip,
  type TripShare,
} from "@travel-app/shared";
import { generateShareToken } from "../utils/share-token";
import { recordHistory } from "./trip-history";
import type { ShareRegistry } from "./share-registry";
import type { ShareSnapshotStore } from "./share-snapshot-store";
import type { NotificationSender } from "./notification-sender";

export interface ApplyShareInput {
  sharedWithEmail?: string;
  permission: SharePermission;
  showCosts: boolean;
  showTodos: boolean;
  /**
   * When set, the spawned share carries this rule id. The owner can
   * later cascade-revoke or cascade-update spawned shares without
   * touching shares they created manually.
   */
  originRuleId?: string;
}

export interface ApplyShareDeps {
  req: Request;
  shareRegistry?: ShareRegistry;
  shareSnapshotStore?: ShareSnapshotStore;
  notificationSender?: NotificationSender;
  /**
   * When true, skip the per-share push notification. Used by auto-share
   * rule paths that fire one consolidated rule-level push instead of N
   * per-trip pushes.
   */
  suppressNotification?: boolean;
  /**
   * Override the history summary line. Defaults to
   * `Shared trip with <recipient> (<permission>)`.
   */
  historySummary?: string;
}

/**
 * Mutates `trip.shares` to add a new share, registers it in the share
 * registry and snapshot store, records a `share.create` history entry,
 * and (unless suppressed) fires a push to the recipient.
 *
 * Does NOT call `storage.saveTrip` — the caller decides when to flush
 * (e.g. after a fan-out loop, save once at the end).
 *
 * Returns the spawned share so callers can include it in their
 * response payload if useful.
 */
export function applyShareToTrip(
  trip: Trip,
  input: ApplyShareInput,
  deps: ApplyShareDeps,
): TripShare {
  const { req, shareRegistry, shareSnapshotStore, notificationSender, suppressNotification, historySummary } = deps;

  const share: TripShare = {
    id: generateId(),
    shareToken: generateShareToken(),
    sharedWithEmail: input.sharedWithEmail,
    permission: input.permission,
    showCosts: input.showCosts,
    showTodos: input.showTodos,
    createdAt: new Date().toISOString(),
    ...(input.originRuleId ? { originRuleId: input.originRuleId } : {}),
  };

  trip.shares.push(share);
  trip.updatedAt = new Date().toISOString();

  const shareTarget = share.sharedWithEmail ?? "anyone with the link";
  recordHistory(
    trip,
    req,
    "share.create",
    historySummary ?? `Shared trip with ${shareTarget} (${share.permission})`,
    { entityId: share.id },
  );

  if (shareRegistry && req.userId) {
    shareRegistry.register({
      shareToken: share.shareToken,
      tripId: trip.id,
      ownerUserId: req.userId,
      ownerEmail: req.userEmail,
      sharedWithEmail: share.sharedWithEmail,
      permission: share.permission,
      showCosts: share.showCosts,
      showTodos: share.showTodos,
    });
  }

  if (shareSnapshotStore) {
    shareSnapshotStore.set(share.shareToken, {
      title: trip.title,
      startDate: trip.startDate,
      endDate: trip.endDate,
      dayCount: trip.days.length,
    });
  }

  if (!suppressNotification && notificationSender && share.sharedWithEmail) {
    const senderName = req.userEmail ?? "Someone";
    const url = `/shared/${share.shareToken}`;
    notificationSender
      .sendToEmail(share.sharedWithEmail, {
        title: `${senderName} shared a trip with you`,
        body: `${trip.title} (${formatTripDateRange(trip.startDate, trip.endDate)})`,
        url,
        tag: `share:${share.shareToken}`,
        data: { kind: "share-invite", shareToken: share.shareToken, tripId: trip.id },
      })
      .catch((err) =>
        console.warn(
          "[trips] share-invite push failed:",
          err instanceof Error ? err.message : err,
        ),
      );
  }

  return share;
}
