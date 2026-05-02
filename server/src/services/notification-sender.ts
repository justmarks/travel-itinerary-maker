/**
 * Sends Web Push notifications via VAPID.
 *
 * Wraps the `web-push` library so route handlers can fire-and-forget a
 * notification without thinking about VAPID config, dead-subscription
 * pruning, or partial-failure handling. When VAPID isn't configured
 * (dev / tests / un-keyed deploys) every send is a logged no-op so the
 * caller doesn't have to gate the call.
 *
 * Dead subscriptions: if the push provider returns 404 or 410 the
 * endpoint is permanently gone (the user uninstalled the PWA, cleared
 * site data, etc.) — we delete it from the store so we stop trying.
 * Other errors (timeouts, 5xx) are logged but the entry is left in
 * place for the next attempt.
 */

import webpush, { type SendResult, type WebPushError } from "web-push";
import type { PushSubscription as SharedPushSubscription } from "@travel-app/shared";
import { config } from "../config/env";
import type { PushSubscriptionStore } from "./push-subscription-store";

export interface NotificationPayload {
  title: string;
  body: string;
  /** URL the click handler should open. */
  url?: string;
  /**
   * Tag groups notifications so a second push with the same tag
   * collapses the first (no double-banner spam). Used for
   * trip-activity rollups.
   */
  tag?: string;
  /** Free-form data forwarded to the SW for advanced handling. */
  data?: Record<string, unknown>;
}

export class NotificationSender {
  private configured: boolean;

  constructor(private store: PushSubscriptionStore) {
    const { publicKey, privateKey, subject } = config.vapid;
    this.configured = Boolean(publicKey && privateKey);
    if (this.configured) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
    }
  }

  /** Whether this instance can actually deliver pushes. */
  isEnabled(): boolean {
    return this.configured;
  }

  /**
   * Send a notification to every device the user with `email` has
   * subscribed on. No-op when VAPID isn't configured, when the email
   * has no subscriptions, or when the email is empty. Returns the
   * number of devices reached (0 on no-op).
   */
  async sendToEmail(email: string | undefined, payload: NotificationPayload): Promise<number> {
    if (!email) return 0;
    if (!this.configured) {
      console.log(`[push] skip — VAPID not configured (would notify ${email}: ${payload.title})`);
      return 0;
    }
    const entries = this.store.listForEmail(email);
    if (entries.length === 0) return 0;
    return this.sendMany(entries.map((e) => e.subscription), payload);
  }

  /** Same as `sendToEmail` but keyed by userId. */
  async sendToUser(userId: string, payload: NotificationPayload): Promise<number> {
    if (!this.configured) {
      console.log(`[push] skip — VAPID not configured (would notify user ${userId}: ${payload.title})`);
      return 0;
    }
    const entries = this.store.listForUser(userId);
    if (entries.length === 0) return 0;
    return this.sendMany(entries.map((e) => e.subscription), payload);
  }

  private async sendMany(
    subscriptions: SharedPushSubscription[],
    payload: NotificationPayload,
  ): Promise<number> {
    const json = JSON.stringify(payload);
    const results = await Promise.allSettled(
      subscriptions.map((sub) => this.sendOne(sub, json)),
    );
    return results.filter((r) => r.status === "fulfilled").length;
  }

  private async sendOne(
    subscription: SharedPushSubscription,
    json: string,
  ): Promise<SendResult> {
    try {
      return await webpush.sendNotification(subscription, json);
    } catch (err) {
      const status = (err as WebPushError | undefined)?.statusCode;
      if (status === 404 || status === 410) {
        // Endpoint permanently gone — drop it so we don't keep paying
        // the latency of failed requests on every future send.
        this.store.removeByEndpoint(subscription.endpoint);
        console.log(`[push] pruned dead subscription (${status})`);
      } else {
        console.warn(
          "[push] send failed:",
          err instanceof Error ? err.message : err,
        );
      }
      throw err;
    }
  }
}
