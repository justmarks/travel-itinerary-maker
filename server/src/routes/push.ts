import { Router, type Request, type Response } from "express";
import { pushSubscriptionSchema } from "@travel-app/shared";
import type { PushSubscriptionStore } from "../services/push-subscription-store";
import { config } from "../config/env";

export interface PushRoutesOptions {
  store: PushSubscriptionStore;
}

/**
 * Routes for the browser to register / unregister its Web Push
 * subscription. Auth-gated (the user is identified by the bearer
 * token); POST upserts by endpoint so a re-subscribe replaces the
 * existing entry.
 *
 * GET /push/config returns the VAPID public key as a runtime fallback
 * for clients that don't have `NEXT_PUBLIC_VAPID_PUBLIC_KEY` baked
 * into their bundle. Behind the same auth gate as the rest — only
 * signed-in users have any reason to subscribe.
 */
export function createPushRoutes(options: PushRoutesOptions): Router {
  const { store } = options;
  const router = Router();

  router.get("/config", (_req: Request, res: Response) => {
    res.json({
      publicKey: config.vapid.publicKey || null,
      enabled: Boolean(config.vapid.publicKey && config.vapid.privateKey),
    });
  });

  router.post("/subscribe", async (req: Request, res: Response) => {
    if (!req.userId || !req.userEmail) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const parsed = pushSubscriptionSchema.safeParse(req.body?.subscription);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }

    const userAgent =
      typeof req.body?.userAgent === "string" ? req.body.userAgent : undefined;

    store.upsert({
      userId: req.userId,
      email: req.userEmail,
      subscription: parsed.data,
      userAgent,
    });

    res.status(201).json({ ok: true });
  });

  router.post("/unsubscribe", async (req: Request, res: Response) => {
    if (!req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const endpoint = typeof req.body?.endpoint === "string" ? req.body.endpoint : null;
    if (!endpoint) {
      res.status(400).json({ error: "Missing endpoint" });
      return;
    }

    store.remove(req.userId, endpoint);
    res.status(204).send();
  });

  /**
   * Lets the client confirm "is this endpoint still registered for
   * me?". The browser holds the canonical subscription object; this
   * route just answers whether the server agrees. Useful after a
   * cold start where the SW already has a subscription but the user
   * cleared site data.
   */
  router.get("/status", async (req: Request, res: Response) => {
    if (!req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const endpoint = typeof req.query.endpoint === "string" ? req.query.endpoint : null;
    const list = store.listForUser(req.userId);
    if (!endpoint) {
      res.json({ subscribed: list.length > 0, deviceCount: list.length });
      return;
    }
    const found = list.some((e) => e.subscription.endpoint === endpoint);
    res.json({ subscribed: found, deviceCount: list.length });
  });

  return router;
}
