/**
 * Records "recipient viewed / edited a shared trip" — bumps the
 * matching share's activity timestamp and pushes the owner.
 *
 * Both the disk write and the push are throttled through
 * ShareActivityTracker so a recipient scrolling around doesn't churn
 * the trip JSON or spam the owner. When the throttle says no, the
 * call is a complete no-op.
 *
 * View tracking only fires for *named* recipients — the contributor
 * flow resolves them via their authenticated email, so we know who
 * the activity belongs to. Anonymous public-link viewers never reach
 * this code path; they hit `GET /api/v1/shared/:token`, which
 * deliberately doesn't track because we can't attribute anything
 * useful to "someone with the link".
 */

import type { Trip, TripShare } from "@travel-app/shared";
import type { StorageProvider } from "./storage";
import type { ShareActivityTracker, ShareActivityKind } from "./share-activity-tracker";
import type { NotificationSender } from "./notification-sender";

export interface RecordShareActivityArgs {
  trip: Trip;
  storage: StorageProvider;
  /** Email of the contributor who just viewed / edited. */
  recipientEmail: string;
  /** Email of the trip owner — push target. */
  ownerEmail?: string;
  kind: ShareActivityKind;
  tracker: ShareActivityTracker;
  notificationSender?: NotificationSender;
}

export async function recordShareActivity(args: RecordShareActivityArgs): Promise<void> {
  const { trip, storage, recipientEmail, ownerEmail, kind, tracker, notificationSender } = args;

  // Find the share entry the recipient is using. Email match is the
  // only signal we have here — the contributor flow doesn't carry the
  // share id. Multiple shares for the same email is theoretically
  // possible (e.g. an old view-share + a new edit-share); we pick the
  // first match because the activity is the same intent regardless.
  const normalized = recipientEmail.toLowerCase();
  const share: TripShare | undefined = trip.shares.find(
    (s) => s.sharedWithEmail?.toLowerCase() === normalized,
  );
  if (!share) return;

  if (!tracker.shouldFire(share.id, kind)) return;

  // Update timestamp on the share — same field the owner-facing UI
  // reads to render "viewed 2h ago".
  const nowIso = new Date().toISOString();
  if (kind === "view") {
    share.lastViewedAt = nowIso;
  } else {
    share.lastEditedAt = nowIso;
  }
  // We deliberately do NOT bump trip.updatedAt — the trip itself
  // hasn't changed; only this side metadata has. Bumping updatedAt
  // would invalidate the contributor's React-Query cache for every
  // tab they have open and trigger refetch storms.
  try {
    await storage.saveTrip(trip);
  } catch (err) {
    // Persist failure shouldn't break the user-facing request the
    // hook fired from. Log and carry on; we'll re-fire next window.
    console.warn(
      "[share-activity] failed to persist activity timestamp:",
      err instanceof Error ? err.message : err,
    );
  }

  // Push the owner. Fire-and-forget — the request that triggered this
  // shouldn't block on push delivery.
  if (notificationSender && ownerEmail) {
    const verb = kind === "view" ? "viewed" : "edited";
    const url = `/trips/${trip.id}`;
    notificationSender
      .sendToEmail(ownerEmail, {
        title: `${recipientEmail} ${verb} your trip`,
        body: trip.title,
        url,
        // One tag per share+kind so a second push within the next
        // notification's lifetime collapses on the first — relevant
        // for browsers that keep banners visible for a few seconds.
        tag: `share-activity:${share.id}:${kind}`,
        data: {
          kind: "share-activity",
          activity: kind,
          shareId: share.id,
          tripId: trip.id,
          recipientEmail,
        },
      })
      .catch((err) =>
        console.warn(
          "[share-activity] push failed:",
          err instanceof Error ? err.message : err,
        ),
      );
  }
}
