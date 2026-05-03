/**
 * Browser-side helpers for the Web Push subscription handshake.
 *
 * The flow:
 *   1. Check the browser supports the relevant APIs (Notifications +
 *      Service Worker + PushManager). Older browsers and iOS Safari
 *      below 16.4 fail the support check and we hide the affordance.
 *   2. Wait for the SW registration the existing `ServiceWorkerRegister`
 *      sets up. We do NOT register a new SW from this module — that's
 *      `sw-register.tsx`'s job and runs in production only.
 *   3. Request notification permission (this is where the OS prompt
 *      fires).
 *   4. Subscribe to the push manager with the application's VAPID
 *      public key, then POST the resulting subscription to the
 *      backend so it can deliver pushes.
 *
 * Unsubscribing is the mirror image — drop the browser subscription
 * AND tell the backend to forget the endpoint.
 *
 * Everything here is best-effort: any failure throws, and the caller
 * surfaces the error via toast. The UI never assumes success.
 */

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

export type PushSupportStatus =
  | "supported"
  | "unsupported-browser"
  | "unsupported-no-vapid";

/**
 * `serviceWorker` is only registered in production builds (see
 * `sw-register.tsx`). We deliberately treat dev as "supported" so the
 * UI affordance still renders — the actual subscribe call will fail
 * with a clear error, which is more useful than silently hiding the
 * toggle and confusing yourself in dev.
 */
export function getPushSupport(): PushSupportStatus {
  if (typeof window === "undefined") return "unsupported-browser";
  if (!("Notification" in window)) return "unsupported-browser";
  if (!("serviceWorker" in navigator)) return "unsupported-browser";
  if (!("PushManager" in window)) return "unsupported-browser";
  if (!VAPID_PUBLIC_KEY) return "unsupported-no-vapid";
  return "supported";
}

/**
 * One-shot diagnostic log so a developer can confirm the VAPID key
 * actually got embedded in the production bundle without having to
 * tap "Turn on notifications" first. The log runs once per page load
 * — fine for diagnostics, low enough volume that it doesn't clutter
 * devtools. We deliberately log a key prefix (not the whole value)
 * so it's easy to spot mismatches with the server's boot log without
 * pasting full keys into screenshots / chats.
 */
let pushDiagnosticsLogged = false;
export function logPushDiagnostics(): void {
  if (pushDiagnosticsLogged) return;
  if (typeof window === "undefined") return;
  pushDiagnosticsLogged = true;
  const support = getPushSupport();
  if (support === "supported") {
    console.info(
      `[push] enabled — VAPID key embedded (${VAPID_PUBLIC_KEY.slice(0, 12)}…)`,
    );
  } else if (support === "unsupported-no-vapid") {
    console.info(
      "[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY not embedded — notifications disabled in this build",
    );
  } else {
    console.info("[push] this browser doesn't support Web Push");
  }
}

export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

/**
 * Fetches the current Web Push subscription for this device, if any.
 * Returns null pre-registration or in dev where the SW isn't running.
 */
export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return null;
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Convert the URL-safe base64 VAPID public key into the Uint8Array
 * `pushManager.subscribe` expects. Lifted from the W3C Push API
 * tutorial; behaviour matches the example app on MDN.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  // Allocate a fresh ArrayBuffer (vs. SharedArrayBuffer) so the result
  // matches the BufferSource type pushManager.subscribe expects under
  // strict TS lib settings.
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Run the full subscribe flow: ensure the SW is ready, prompt for
 * permission, subscribe to the push manager, return the subscription
 * object the API client should POST to the backend.
 *
 * Throws on any failure (permission denied, no SW registered, etc.) so
 * the caller can show a meaningful toast.
 */
export async function subscribeToPush(): Promise<PushSubscription> {
  const support = getPushSupport();
  if (support !== "supported") {
    throw new Error(
      support === "unsupported-no-vapid"
        ? "Push isn't configured for this deployment."
        : "This browser doesn't support push notifications.",
    );
  }

  const registration = await navigator.serviceWorker.ready;

  // Browsers don't differentiate "default" from "denied" once the user
  // explicitly clicked block — `requestPermission()` resolves "denied"
  // immediately in that case, so there's no infinite-prompt risk.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked for this site. Enable them in your browser settings."
        : "Notification permission was dismissed.",
    );
  }

  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
}

/**
 * Tell the browser to drop its subscription. Returns the endpoint
 * that was active so the caller can also tell the backend to forget
 * it. Returns null when there was no subscription to drop.
 */
export async function unsubscribeFromPush(): Promise<string | null> {
  const sub = await getCurrentSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}
