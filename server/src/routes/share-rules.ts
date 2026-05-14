import { Router, type Request, type Response } from "express";
import {
  createShareRuleSchema,
  updateShareRuleSchema,
  generateId,
  type SharePermission,
  type Trip,
  type TripShare,
  type TripShareRule,
} from "@itinly/shared";
import type { StorageProvider, StorageResolver } from "../services/storage";
import type { ShareRegistry } from "../services/share-registry";
import type { ShareSnapshotStore } from "../services/share-snapshot-store";
import type { NotificationSender } from "../services/notification-sender";
import { applyShareToTrip } from "../services/share-fanout";
import { recordHistory } from "../services/trip-history";
import { mapWithConcurrency } from "../utils/concurrency";

/**
 * Concurrent saveTrip / cascade-revoke calls in the rule routes. Bounded
 * to keep us under Drive's per-user quota when the user has many trips
 * (a 30-trip rule fan-out at concurrency 6 finishes in ~5 round-trips
 * instead of 30 sequential ones).
 */
const FANOUT_CONCURRENCY = 6;

export interface ShareRuleRoutesOptions {
  resolveStorage: StorageResolver | StorageProvider;
  shareRegistry?: ShareRegistry;
  shareSnapshotStore?: ShareSnapshotStore;
  notificationSender?: NotificationSender;
}

/**
 * Strictness ordering for `SharePermission` — used to decide whether a
 * rule should overwrite an existing manual share. Edit > view: a rule
 * never downgrades a recipient who was previously granted edit access
 * down to view.
 */
const PERMISSION_RANK: Record<SharePermission, number> = { view: 0, edit: 1 };

function isStricter(a: SharePermission, b: SharePermission): boolean {
  return PERMISSION_RANK[a] > PERMISSION_RANK[b];
}

export function createShareRuleRoutes(options: ShareRuleRoutesOptions): Router {
  const { resolveStorage, shareRegistry, shareSnapshotStore, notificationSender } = options;

  const getStorage: StorageResolver =
    typeof resolveStorage === "function" ? resolveStorage : () => resolveStorage;

  const router = Router();

  router.get("/", async (req: Request, res: Response) => {
    const storage = getStorage(req);
    const ownerUserId = req.userId;
    if (!ownerUserId) {
      res.json([]);
      return;
    }
    const rules = await storage.listShareRules();
    res.json(rules.filter((r) => r.ownerUserId === ownerUserId));
  });

  router.post("/", async (req: Request, res: Response) => {
    const storage = getStorage(req);
    const ownerUserId = req.userId;
    if (!ownerUserId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const parsed = createShareRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }

    const recipient = parsed.data.sharedWithEmail.toLowerCase();
    const ownerEmail = req.userEmail?.toLowerCase();
    if (ownerEmail && recipient === ownerEmail) {
      res.status(400).json({ error: "Cannot auto-share with yourself" });
      return;
    }

    const allRules = await storage.listShareRules();
    const existing = allRules.find(
      (r) =>
        r.ownerUserId === ownerUserId &&
        r.sharedWithEmail.toLowerCase() === recipient,
    );
    if (existing) {
      res
        .status(409)
        .json({ error: "A rule already exists for this recipient", existingRuleId: existing.id });
      return;
    }

    const now = new Date().toISOString();
    const rule: TripShareRule = {
      id: generateId(),
      ownerUserId,
      ownerEmail: req.userEmail,
      sharedWithEmail: recipient,
      permission: parsed.data.permission,
      showCosts: parsed.data.showCosts,
      showTodos: parsed.data.showTodos,
      createdAt: now,
      updatedAt: now,
    };
    await storage.saveShareRule(rule);

    // Backfill across existing trips. Conflict policy: "upgrade only if
    // stricter" — never downgrade a recipient's existing access. Each
    // trip is an independent file write, so the fan-out runs in
    // parallel (bounded) — N sequential ~300ms writes becomes
    // ~ceil(N/FANOUT_CONCURRENCY) round-trips.
    const trips = await storage.listTrips();
    type Outcome = "spawned" | "upgraded" | "skipped";
    const outcomes = await mapWithConcurrency<Trip, Outcome>(trips, FANOUT_CONCURRENCY, async (trip) => {
      const existingShare = trip.shares.find(
        (s) => s.sharedWithEmail?.toLowerCase() === recipient,
      );
      if (existingShare) {
        if (!isStricter(rule.permission, existingShare.permission)) {
          // Equal or weaker permission → leave existing share untouched.
          return "skipped";
        }
        existingShare.permission = rule.permission;
        existingShare.showCosts = rule.showCosts;
        existingShare.showTodos = rule.showTodos;
        existingShare.originRuleId = rule.id;
        trip.updatedAt = now;
        recordHistory(
          trip,
          req,
          "share.create",
          `Auto-share rule upgraded ${recipient} to ${rule.permission}`,
          { entityId: existingShare.id },
        );
        if (shareRegistry) {
          shareRegistry.register({
            shareToken: existingShare.shareToken,
            tripId: trip.id,
            ownerUserId,
            ownerEmail: req.userEmail,
            sharedWithEmail: existingShare.sharedWithEmail,
            permission: existingShare.permission,
            showCosts: existingShare.showCosts,
            showTodos: existingShare.showTodos,
          });
        }
        await storage.saveTrip(trip);
        return "upgraded";
      }

      applyShareToTrip(
        trip,
        {
          sharedWithEmail: recipient,
          permission: rule.permission,
          showCosts: rule.showCosts,
          showTodos: rule.showTodos,
          originRuleId: rule.id,
        },
        {
          req,
          shareRegistry,
          shareSnapshotStore,
          notificationSender,
          // Suppress per-trip pushes — we fire one rule-level push below.
          suppressNotification: true,
          historySummary: `Auto-shared with ${recipient} via rule (${rule.permission})`,
        },
      );
      await storage.saveTrip(trip);
      return "spawned";
    });
    const spawned = outcomes.filter((o) => o === "spawned").length;
    const upgraded = outcomes.filter((o) => o === "upgraded").length;

    // One consolidated push for the rule application — not N per-share
    // pushes (would spam the recipient on the first rule activation
    // against a busy account).
    if (notificationSender && (spawned > 0 || upgraded > 0)) {
      const senderName = req.userEmail ?? "Someone";
      const total = spawned + upgraded;
      const tripWord = total === 1 ? "trip" : "trips";
      notificationSender
        .sendToEmail(recipient, {
          title: `${senderName} now auto-shares trips with you`,
          body: `${total} ${tripWord} shared so far`,
          url: "/",
          tag: `share-rule:${rule.id}`,
          data: { kind: "share-rule-create", ruleId: rule.id },
        })
        .catch((err) =>
          console.warn(
            "[share-rules] rule-create push failed:",
            err instanceof Error ? err.message : err,
          ),
        );
    }

    console.log(
      `[share-rules ${req.userEmail ?? "anon"}] POST → created rule ${rule.id} for ${recipient} (spawned=${spawned}, upgraded=${upgraded})`,
    );
    res.status(201).json({ rule, spawnedShareCount: spawned, upgradedShareCount: upgraded });
  });

  router.put("/:ruleId", async (req: Request, res: Response) => {
    const storage = getStorage(req);
    const ownerUserId = req.userId;
    if (!ownerUserId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const parsed = updateShareRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }

    const rule = await storage.getShareRule(req.params.ruleId as string);
    if (!rule || rule.ownerUserId !== ownerUserId) {
      res.status(404).json({ error: "Rule not found" });
      return;
    }

    const now = new Date().toISOString();
    if (parsed.data.permission !== undefined) rule.permission = parsed.data.permission;
    if (parsed.data.showCosts !== undefined) rule.showCosts = parsed.data.showCosts;
    if (parsed.data.showTodos !== undefined) rule.showTodos = parsed.data.showTodos;
    rule.updatedAt = now;
    await storage.saveShareRule(rule);

    // Cascade to existing spawned shares: every TripShare with
    // originRuleId === rule.id picks up the new permission / flags.
    // Manual shares for the same recipient (no originRuleId) are not
    // touched. Per-trip writes run in parallel (bounded).
    const trips = await storage.listTrips();
    const updateOutcomes = await mapWithConcurrency<Trip, boolean>(trips, FANOUT_CONCURRENCY, async (trip) => {
      const share = trip.shares.find((s) => s.originRuleId === rule.id);
      if (!share) return false;
      share.permission = rule.permission;
      share.showCosts = rule.showCosts;
      share.showTodos = rule.showTodos;
      trip.updatedAt = now;
      recordHistory(
        trip,
        req,
        "share.create",
        `Auto-share rule updated ${rule.sharedWithEmail} (${rule.permission})`,
        { entityId: share.id },
      );
      if (shareRegistry) {
        shareRegistry.register({
          shareToken: share.shareToken,
          tripId: trip.id,
          ownerUserId,
          ownerEmail: req.userEmail,
          sharedWithEmail: share.sharedWithEmail,
          permission: share.permission,
          showCosts: share.showCosts,
          showTodos: share.showTodos,
        });
      }
      await storage.saveTrip(trip);
      return true;
    });
    const updated = updateOutcomes.filter(Boolean).length;

    if (notificationSender && updated > 0) {
      const senderName = req.userEmail ?? "Someone";
      notificationSender
        .sendToEmail(rule.sharedWithEmail, {
          title: `${senderName} updated your access`,
          body: `Now ${rule.permission} on ${updated} trip${updated === 1 ? "" : "s"}`,
          url: "/",
          tag: `share-rule:${rule.id}`,
          data: { kind: "share-rule-update", ruleId: rule.id },
        })
        .catch((err) =>
          console.warn(
            "[share-rules] rule-update push failed:",
            err instanceof Error ? err.message : err,
          ),
        );
    }

    res.json({ rule, updatedShareCount: updated });
  });

  router.delete("/:ruleId", async (req: Request, res: Response) => {
    const storage = getStorage(req);
    const ownerUserId = req.userId;
    if (!ownerUserId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // `cascade` is required and must be the literal "true" or "false".
    // Forces the caller to be explicit — there's no safe default.
    const cascadeRaw = req.query.cascade;
    if (cascadeRaw !== "true" && cascadeRaw !== "false") {
      res
        .status(400)
        .json({ error: "Query param `cascade` is required and must be 'true' or 'false'" });
      return;
    }
    const cascade = cascadeRaw === "true";

    const rule = await storage.getShareRule(req.params.ruleId as string);
    if (!rule || rule.ownerUserId !== ownerUserId) {
      res.status(404).json({ error: "Rule not found" });
      return;
    }

    let revoked = 0;
    if (cascade) {
      const trips = await storage.listTrips();
      const now = new Date().toISOString();
      const revokeOutcomes = await mapWithConcurrency<Trip, boolean>(trips, FANOUT_CONCURRENCY, async (trip) => {
        const idx = trip.shares.findIndex((s) => s.originRuleId === rule.id);
        if (idx < 0) return false;
        const share = trip.shares[idx] as TripShare;
        trip.shares.splice(idx, 1);
        trip.updatedAt = now;
        if (shareRegistry) shareRegistry.remove(share.shareToken);
        if (shareSnapshotStore) shareSnapshotStore.delete(share.shareToken);
        recordHistory(
          trip,
          req,
          "share.revoke",
          `Cascade-revoked from auto-share rule deletion (${rule.sharedWithEmail})`,
          { entityId: share.id },
        );
        await storage.saveTrip(trip);
        return true;
      });
      revoked = revokeOutcomes.filter(Boolean).length;
    }

    await storage.deleteShareRule(rule.id);

    if (notificationSender && cascade && revoked > 0) {
      const senderName = req.userEmail ?? "Someone";
      notificationSender
        .sendToEmail(rule.sharedWithEmail, {
          title: `${senderName} stopped auto-sharing trips with you`,
          body: `${revoked} trip${revoked === 1 ? "" : "s"} no longer shared`,
          url: "/",
          tag: `share-rule:${rule.id}`,
          data: { kind: "share-rule-delete", ruleId: rule.id },
        })
        .catch((err) =>
          console.warn(
            "[share-rules] rule-delete push failed:",
            err instanceof Error ? err.message : err,
          ),
        );
    }

    console.log(
      `[share-rules ${req.userEmail ?? "anon"}] DELETE → ${rule.id} cascade=${cascade} revoked=${revoked}`,
    );
    res.json({ revokedShareCount: revoked });
  });

  return router;
}
