"use client";

import { toast } from "sonner";
import { useSubscribePush } from "@travel-app/api-client";
import { toastMutationError } from "@/lib/api-error";
import { dismissHint, isHintDismissed } from "@/lib/onboarding-hints";
import {
  getNotificationPermission,
  getPushSupport,
  subscribeToPush,
} from "@/lib/push";

/**
 * Surfaces a one-time Sonner toast on the user's first successful
 * share creation, offering to turn on push notifications. The toast
 * has an "Turn on" action button that runs the same subscribe flow as
 * the user-menu toggle (`subscribeToPush()` + the API mutation).
 *
 * Gates — the toast is suppressed when any of these is true:
 *   - the `share-notifications` hint was already dismissed
 *   - the browser doesn't support push (no Service Worker /
 *     PushManager / Notification API, or the deployment is missing
 *     `NEXT_PUBLIC_VAPID_PUBLIC_KEY`)
 *   - notification permission is anything other than `default` (if
 *     it's `granted`, the user already has it on; if `denied`, the OS
 *     won't re-prompt and bothering them isn't useful)
 *
 * The dismissal flag is set as soon as the toast is shown — we treat
 * the hint as "fired" regardless of whether the user clicks the
 * action, ignores it, or closes it. That way the next share doesn't
 * surface another toast nagging about the same setting.
 *
 * Used from both the desktop `<ShareTripDialog>` and the mobile
 * `<MobileShareSheet>` so a user creating their first share from
 * either surface gets the same hint.
 */
export function useShareNotificationsHint(): {
  maybeShow: () => void;
} {
  const subscribe = useSubscribePush();

  return {
    maybeShow: () => {
      if (typeof window === "undefined") return;
      if (isHintDismissed("share-notifications")) return;
      if (getPushSupport() !== "supported") return;
      if (getNotificationPermission() !== "default") return;

      const handleEnable = async () => {
        try {
          const sub = await subscribeToPush();
          const json = sub.toJSON() as {
            endpoint?: string;
            keys?: { p256dh?: string; auth?: string };
          };
          if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
            throw new Error("Subscription is missing endpoint or keys.");
          }
          await subscribe.mutateAsync({
            subscription: {
              endpoint: json.endpoint,
              keys: {
                p256dh: json.keys.p256dh,
                auth: json.keys.auth,
              },
            },
            userAgent:
              typeof navigator !== "undefined"
                ? navigator.userAgent
                : undefined,
          });
          toast.success("Notifications turned on", {
            description:
              "We'll ping you when someone opens or edits this trip.",
          });
        } catch (err) {
          toastMutationError("turn on notifications")(err);
        }
      };

      toast("Get notified when someone opens this share?", {
        description:
          "We'll ping you whenever a recipient views or edits the trip.",
        // 12 s gives the user time to read past the share-success
        // celebration without leaving the toast around forever.
        duration: 12_000,
        action: {
          label: "Turn on",
          onClick: handleEnable,
        },
      });

      // Mark dismissed as soon as we surface the toast — the user
      // saw the hint, that's enough. Sonner doesn't expose a reliable
      // "shown" callback (onDismiss / onAutoClose run on close, which
      // races with page navigation), so eager-write is the safest
      // way to guarantee one-and-done semantics.
      dismissHint("share-notifications");
    },
  };
}
