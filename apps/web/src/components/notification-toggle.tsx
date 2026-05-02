"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useDemoMode } from "@/lib/demo";
import {
  useSubscribePush,
  useUnsubscribePush,
} from "@travel-app/api-client";
import {
  getCurrentSubscription,
  getNotificationPermission,
  getPushSupport,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push";
import { describeError } from "@/lib/api-error";

/**
 * Dropdown-menu item that toggles Web Push notifications for the
 * current device. Hidden entirely when the browser doesn't support
 * push or VAPID isn't configured (the menu just renders the rest of
 * its items as if this affordance didn't exist).
 *
 * Demo mode: the toggle still renders so the layout looks complete,
 * but tapping it explains push isn't available in demo mode rather
 * than silently failing.
 *
 * Browser-state vs. server-state: the source of truth for "is this
 * device subscribed?" is the browser's PushManager — only it knows
 * if the OS-level subscription is still alive. We sync server-side
 * after each subscribe/unsubscribe so the backend can find this
 * device, but the UI label always reflects the browser truth.
 */
export function NotificationToggleMenu(): React.JSX.Element | null {
  const isDemo = useDemoMode();
  const subscribe = useSubscribePush();
  const unsubscribe = useUnsubscribePush();

  const [support, setSupport] = useState<"unknown" | ReturnType<typeof getPushSupport>>(
    "unknown",
  );
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [subscribed, setSubscribed] = useState<boolean>(false);
  const [busy, setBusy] = useState(false);

  // First-render sync: figure out browser support, current permission,
  // and whether a subscription already exists. The toggle defaults to
  // "off" while this runs so we don't briefly show the wrong state.
  useEffect(() => {
    setSupport(getPushSupport());
    setPermission(getNotificationPermission());
    void (async () => {
      const sub = await getCurrentSubscription();
      setSubscribed(Boolean(sub));
    })();
  }, []);

  if (support === "unknown") return null;
  if (support === "unsupported-browser") return null;
  // VAPID-not-configured: don't render in production builds where
  // push is genuinely unavailable. Dev still renders so engineers
  // can see the affordance even without keys set locally.
  if (support === "unsupported-no-vapid" && process.env.NODE_ENV === "production") {
    return null;
  }

  const handleToggle = async (event: Event) => {
    // Prevent the dropdown from closing while we wait on the OS
    // permission prompt — closing dismisses Sonner toasts that haven't
    // started rendering yet.
    event.preventDefault();
    if (busy) return;

    if (isDemo) {
      toast.info("Notifications aren't available in demo mode", {
        description: "Sign in to enable push notifications on this device.",
      });
      return;
    }

    if (support === "unsupported-no-vapid") {
      toast.error("Push isn't configured for this deployment.", {
        description: "Set NEXT_PUBLIC_VAPID_PUBLIC_KEY to enable notifications.",
      });
      return;
    }

    setBusy(true);
    try {
      if (subscribed) {
        const endpoint = await unsubscribeFromPush();
        if (endpoint) {
          await unsubscribe.mutateAsync(endpoint);
        }
        setSubscribed(false);
        setPermission(getNotificationPermission());
        toast.success("Notifications turned off");
      } else {
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
            keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
          },
          userAgent:
            typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        });
        setSubscribed(true);
        setPermission(getNotificationPermission());
        toast.success("Notifications turned on", {
          description: "You'll get a push when someone shares a trip with you.",
        });
      }
    } catch (err) {
      toast.error(
        subscribed
          ? "Couldn't turn off notifications"
          : "Couldn't turn on notifications",
        { description: describeError(err) },
      );
    } finally {
      setBusy(false);
    }
  };

  // Choose label + icon. We separate "denied at OS level" from "off"
  // so the user understands why a tap won't bring up the prompt.
  const iconClass = "mr-2 h-4 w-4";
  const Icon = busy ? Loader2 : subscribed ? Bell : BellOff;
  const label = busy
    ? "…"
    : subscribed
      ? "Notifications on"
      : permission === "denied"
        ? "Notifications blocked"
        : "Turn on notifications";

  return (
    <DropdownMenuItem onSelect={handleToggle} disabled={busy}>
      <Icon className={`${iconClass}${busy ? " animate-spin" : ""}`} />
      {label}
    </DropdownMenuItem>
  );
}
