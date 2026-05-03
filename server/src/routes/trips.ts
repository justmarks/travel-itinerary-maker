import { Router, type Request, type Response } from "express";
import {
  createTripSchema,
  updateTripSchema,
  createSegmentSchema,
  updateSegmentSchema,
  createTodoSchema,
  updateTodoSchema,
  createShareSchema,
  xlsxImportRequestSchema,
  generateId,
  generateDateRange,
  getDayOfWeek,
  findOverlappingTrips,
  convertToUsd,
  applyCruisePortsToDayCities,
  primaryLocationFor,
  formatTripDateRange,
  CURRENT_TRIP_SCHEMA_VERSION,
  type Trip,
  type TripDay,
  type Segment,
} from "@travel-app/shared";
import type { SharePermission } from "@travel-app/shared";
import type { StorageProvider, StorageResolver } from "../services/storage";
import type { ShareRegistry } from "../services/share-registry";
import type { ShareSnapshotStore } from "../services/share-snapshot-store";
import type { NotificationSender } from "../services/notification-sender";
import type { ShareActivityTracker, ShareActivityKind } from "../services/share-activity-tracker";
import { recordShareActivity } from "../services/share-activity";
import {
  resolveTripAccess,
  listSharedTrips,
  type AccessResult,
  type AccessGranted,
  type AccessDenied,
  type ResolveOwnerStorage,
} from "../services/trip-access";
import {
  XlsxTripImporter,
  extractYearHint,
  shiftWorkbookYears,
  type ParsedWorkbookSegment,
} from "../services/xlsx-importer";

export interface TripRoutesOptions {
  resolveStorage: StorageResolver | StorageProvider;
  shareRegistry?: ShareRegistry;
  shareSnapshotStore?: ShareSnapshotStore;
  /**
   * Resolves the *owner's* storage for a shared trip — used when a
   * contributor accesses a trip they don't own. Optional; without it
   * the contributor flow short-circuits to 404 (the request resolves
   * via the requester's own storage only).
   */
  resolveOwnerStorage?: ResolveOwnerStorage;
  /**
   * Optional Web Push sender — when present, share creation fires a
   * push to every device the recipient has registered. No-op when
   * VAPID isn't configured or the recipient has no subscriptions
   * (cold invite to a not-yet-onboarded user).
   */
  notificationSender?: NotificationSender;
  /**
   * Optional throttle for "recipient viewed / edited" pushes. When
   * present, contributor view / edit operations bump the matching
   * share's lastViewedAt / lastEditedAt and push the owner — at most
   * once per 30-min window per share-and-kind. Without it, no
   * activity tracking happens (matches the legacy behaviour).
   */
  shareActivityTracker?: ShareActivityTracker;
}

export function createTripRoutes(options: TripRoutesOptions): Router {
  const {
    resolveStorage,
    shareRegistry,
    shareSnapshotStore,
    resolveOwnerStorage,
    notificationSender,
    shareActivityTracker,
  } = options;

  // Support both a resolver function and a direct storage instance
  const getStorage: StorageResolver =
    typeof resolveStorage === "function"
      ? resolveStorage
      : () => resolveStorage;

  const router = Router();

  // Authorisation gate: every read/write route on `/trips/:tripId` runs
  // through this so a recipient with an edit-share can mutate the
  // owner's trip in place. The helper returns a discriminated result —
  // route handlers branch on `ok`. Owner-only operations (delete,
  // create/revoke shares) check `accessLevel === "owner"` after the
  // permission gate.
  async function accessTrip(
    req: Request,
    tripId: string,
    requiredPermission: SharePermission,
  ): Promise<AccessResult> {
    return resolveTripAccess({
      req,
      tripId,
      requiredPermission,
      getStorage,
      shareRegistry,
      resolveOwnerStorage,
    });
  }

  function denyAccess(res: Response, denied: AccessDenied): void {
    const message =
      denied.reason === "shared-view-only"
        ? "View-only share — editing not permitted"
        : denied.reason === "owner-auth-expired"
          ? "Trip owner needs to re-authenticate"
          : "Trip not found";
    res.status(denied.status).json({ error: message, reason: denied.reason });
  }

  /**
   * Fire activity tracking + owner push when a contributor (not the
   * owner) views or edits a shared trip. No-op for owners (they don't
   * need to be notified about their own activity), no-op when no
   * tracker is configured, and throttled to 30 min per share+kind so
   * scrolling doesn't churn writes or pushes.
   *
   * Safe to await even when it'd be a no-op — the tracker check runs
   * first and returns synchronously when the throttle bites.
   */
  async function recordContributorActivity(
    access: AccessGranted,
    req: Request,
    kind: ShareActivityKind,
  ): Promise<void> {
    if (!shareActivityTracker) return;
    if (access.accessLevel === "owner") return;
    if (!req.userEmail) return;
    await recordShareActivity({
      trip: access.trip,
      storage: access.storage,
      recipientEmail: req.userEmail,
      ownerEmail: access.ownerEmail,
      kind,
      tracker: shareActivityTracker,
      notificationSender,
    });
  }

  function denyOwnerOnly(res: Response): void {
    res.status(403).json({
      error: "Only the trip owner can perform this action",
      reason: "owner-only",
    });
  }

  // ─── Trip CRUD ───────────────────────────────────────────

  router.get("/", async (req: Request, res: Response) => {
    try {
      const storage = getStorage(req);
      const ownedTrips = await storage.listTrips();
      const ownedIds = new Set(ownedTrips.map((t) => t.id));

      // Pull every trip shared with this user (in addition to the ones
      // they own) so a contributor sees those trips inline in their
      // dashboard. Shared and owned can technically overlap if a user
      // gets a share for their own trip — dedupe by id, owned wins.
      const shared = await listSharedTrips({
        userEmail: req.userEmail,
        shareRegistry,
        resolveOwnerStorage,
      });

      const ownedSummaries = ownedTrips.map((t) => {
        const primary = primaryLocationFor(t);
        return {
          id: t.id,
          title: t.title,
          startDate: t.startDate,
          endDate: t.endDate,
          status: t.status,
          dayCount: t.days.length,
          todoCount: t.todos.filter((td) => !td.isCompleted).length,
          primaryCity: primary?.city,
          primaryCountryCode: primary?.countryCode,
          primaryCountry: primary?.country,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        };
      });

      const sharedSummaries = shared
        .filter(({ trip }) => !ownedIds.has(trip.id))
        .map(({ trip, ownerEmail, permission, showCosts, showTodos }) => {
          const primary = primaryLocationFor(trip);
          return {
            id: trip.id,
            title: trip.title,
            startDate: trip.startDate,
            endDate: trip.endDate,
            status: trip.status,
            dayCount: trip.days.length,
            // Hide the to-do count in the summary when the share itself
            // hides to-dos — otherwise the recipient sees "5 todos" on
            // their card with no way to open them.
            todoCount: showTodos
              ? trip.todos.filter((td) => !td.isCompleted).length
              : 0,
            primaryCity: primary?.city,
            primaryCountryCode: primary?.countryCode,
            primaryCountry: primary?.country,
            createdAt: trip.createdAt,
            updatedAt: trip.updatedAt,
            sharedFromEmail: ownerEmail,
            sharedPermission: permission,
            sharedShowCosts: showCosts,
            sharedShowTodos: showTodos,
          };
        });

      res.json([...ownedSummaries, ...sharedSummaries]);
    } catch (err) {
      console.error("GET /trips error:", err);
      res.status(500).json({ error: "Failed to list trips" });
    }
  });

  router.post("/", async (req: Request, res: Response) => {
    const storage = getStorage(req);
    const parsed = createTripSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }

    const { title, startDate, endDate } = parsed.data;

    // Check for overlapping trips
    const existingTrips = await storage.listTrips();
    const overlapping = findOverlappingTrips(existingTrips, { startDate, endDate });
    if (overlapping.length > 0) {
      res.status(409).json({
        error: "Date range overlaps with an existing trip",
        overlappingTrips: overlapping.map((t) => ({
          id: t.id,
          title: t.title,
          startDate: t.startDate,
          endDate: t.endDate,
        })),
      });
      return;
    }

    const now = new Date().toISOString();

    const days: TripDay[] = generateDateRange(startDate, endDate).map(
      (date) => ({
        date,
        dayOfWeek: getDayOfWeek(date),
        city: "",
        segments: [],
      }),
    );

    const trip: Trip = {
      id: generateId(),
      title,
      startDate,
      endDate,
      status: "planning",
      days,
      todos: [],
      shares: [],
      createdAt: now,
      updatedAt: now,
      schemaVersion: CURRENT_TRIP_SCHEMA_VERSION,
    };

    await storage.saveTrip(trip);
    res.status(201).json(trip);
  });

  // ─── XLSX import (one-shot) ─────────────────────────────
  //
  // Accepts a base64-encoded .xlsx workbook exported from OneNote (or any
  // workbook following the same layout: Itinerary sheet with columns
  // City / Day / Date / Transport / Lodging / Lunch / Dinner, plus a
  // Costs sheet). Parses the workbook deterministically and creates a
  // full trip with all days + segments in a single call. The user can
  // edit or delete the result afterward via the normal UI.
  router.post("/import-xlsx", async (req: Request, res: Response) => {
    const storage = getStorage(req);
    const parsed = xlsxImportRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }

    let buffer: Buffer;
    try {
      buffer = Buffer.from(parsed.data.fileBase64, "base64");
      if (buffer.length === 0) {
        throw new Error("Decoded buffer is empty");
      }
    } catch (err) {
      res.status(400).json({
        error: "Invalid base64 file data",
        details: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const importer = new XlsxTripImporter();
    let parsedBook;
    try {
      parsedBook = await importer.parseWorkbook(buffer);
    } catch (err) {
      res.status(400).json({
        error: "Failed to parse XLSX file",
        details: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    // Derive a title: explicit override > filename (minus extension) > default
    const title =
      parsed.data.title ||
      (parsed.data.filename
        ? parsed.data.filename.replace(/\.(xlsx|xls)$/i, "").trim()
        : "") ||
      parsedBook.title ||
      "Imported Trip";

    // Excel stores dates with a year, but when a user types a year-less
    // date like "June 15" into a cell Excel defaults to the current year
    // at entry time. If the trip title or filename names a specific year
    // that doesn't match the year on the parsed dates, shift every date
    // to the hinted year. Prefer the explicit title over the filename.
    const yearHint =
      extractYearHint(parsed.data.title) ??
      extractYearHint(parsed.data.filename) ??
      extractYearHint(parsedBook.title);
    if (yearHint && parsedBook.startDate) {
      const parsedStartYear = Number(parsedBook.startDate.slice(0, 4));
      if (
        Number.isFinite(parsedStartYear) &&
        parsedStartYear !== yearHint
      ) {
        parsedBook = shiftWorkbookYears(parsedBook, yearHint - parsedStartYear);
      }
    }

    // Guard: reject if the date range overlaps an existing trip
    const existingTrips = await storage.listTrips();
    const overlapping = findOverlappingTrips(existingTrips, {
      startDate: parsedBook.startDate,
      endDate: parsedBook.endDate,
    });
    if (overlapping.length > 0) {
      res.status(409).json({
        error: "Date range overlaps with an existing trip",
        overlappingTrips: overlapping.map((t) => ({
          id: t.id,
          title: t.title,
          startDate: t.startDate,
          endDate: t.endDate,
        })),
      });
      return;
    }

    const now = new Date().toISOString();

    // Build a full days array from the parsed workbook. Fill in any gaps
    // in the date range (shouldn't happen for well-formed inputs, but we
    // want the resulting trip to always span contiguous dates).
    const parsedByDate = new Map(parsedBook.days.map((d) => [d.date, d]));
    const days: TripDay[] = generateDateRange(
      parsedBook.startDate,
      parsedBook.endDate,
    ).map((date) => {
      const source = parsedByDate.get(date);
      if (!source) {
        return {
          date,
          dayOfWeek: getDayOfWeek(date),
          city: "",
          segments: [],
        };
      }
      const segments: Segment[] = source.segments.map(
        (s: ParsedWorkbookSegment, idx: number): Segment => ({
          id: generateId(),
          type: s.type,
          title: s.title,
          ...(s.startTime ? { startTime: s.startTime } : {}),
          ...(s.endTime ? { endTime: s.endTime } : {}),
          ...(s.venueName ? { venueName: s.venueName } : {}),
          ...(s.address ? { address: s.address } : {}),
          ...(s.phone ? { phone: s.phone } : {}),
          ...(s.city ? { city: s.city } : {}),
          ...(s.departureCity ? { departureCity: s.departureCity } : {}),
          ...(s.arrivalCity ? { arrivalCity: s.arrivalCity } : {}),
          ...(s.departureAirport ? { departureAirport: s.departureAirport } : {}),
          ...(s.arrivalAirport ? { arrivalAirport: s.arrivalAirport } : {}),
          ...(s.endDate ? { endDate: s.endDate } : {}),
          ...(s.confirmationCode ? { confirmationCode: s.confirmationCode } : {}),
          ...(s.partySize !== undefined ? { partySize: s.partySize } : {}),
          ...(s.creditCardHold ? { creditCardHold: true } : {}),
          ...(s.cost ? { cost: s.cost } : {}),
          source: "manual",
          needsReview: true,
          sortOrder: idx,
        }),
      );
      return {
        date,
        dayOfWeek: source.dayOfWeek || getDayOfWeek(date),
        city: source.city,
        segments,
      };
    });

    const trip: Trip = {
      id: generateId(),
      title,
      startDate: parsedBook.startDate,
      endDate: parsedBook.endDate,
      status: "planning",
      days,
      todos: [],
      shares: [],
      createdAt: now,
      updatedAt: now,
      schemaVersion: CURRENT_TRIP_SCHEMA_VERSION,
    };

    await storage.saveTrip(trip);
    res.status(201).json({
      trip,
      warnings: parsedBook.warnings,
      unmatchedCosts: parsedBook.costs.filter((c) => {
        // A cost is "unmatched" if no hotel segment in the created trip
        // picked it up. We only track lodging attachment today; everything
        // else remains in this list so the caller can show it separately.
        if (!/^Hotel in /i.test(c.category)) return true;
        const anyAttached = trip.days.some((d) =>
          d.segments.some(
            (s) =>
              s.type === "hotel" &&
              s.cost &&
              s.cost.amount === c.amount &&
              s.cost.currency === c.currency,
          ),
        );
        return !anyAttached;
      }),
    });
  });

  router.get("/:tripId", async (req: Request, res: Response) => {
    const access = await accessTrip(req, req.params.tripId as string, "view");
    if (!access.ok) return denyAccess(res, access);
    res.json(access.trip);
    // Fire-and-forget activity tracking. Don't await before responding —
    // the contributor's load shouldn't pay for the throttle write or
    // owner push. Errors inside record* are swallowed and logged.
    void recordContributorActivity(access, req, "view");
  });

  router.put("/:tripId", async (req: Request, res: Response) => {
    const access = await accessTrip(req, req.params.tripId as string, "edit");
    if (!access.ok) return denyAccess(res, access);
    const { trip, storage } = access;

    const parsed = updateTripSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }

    const updates = parsed.data;

    // Check for overlapping trips if dates are changing
    if (updates.startDate !== undefined || updates.endDate !== undefined) {
      const newStart = updates.startDate ?? trip.startDate;
      const newEnd = updates.endDate ?? trip.endDate;
      const existingTrips = await storage.listTrips();
      const overlapping = findOverlappingTrips(
        existingTrips,
        { startDate: newStart, endDate: newEnd },
        trip.id,
      );
      if (overlapping.length > 0) {
        res.status(409).json({
          error: "Date range overlaps with an existing trip",
          overlappingTrips: overlapping.map((t) => ({
            id: t.id,
            title: t.title,
            startDate: t.startDate,
            endDate: t.endDate,
          })),
        });
        return;
      }
    }

    if (updates.title !== undefined) trip.title = updates.title;
    if (updates.status !== undefined) trip.status = updates.status;

    // When dates change, rebuild the days array while preserving existing
    // segments for dates that remain in range.
    if (updates.startDate !== undefined || updates.endDate !== undefined) {
      const newStart = updates.startDate ?? trip.startDate;
      const newEnd = updates.endDate ?? trip.endDate;
      trip.startDate = newStart;
      trip.endDate = newEnd;

      // Index existing days by date for fast lookup
      const existingDays = new Map(trip.days.map((d) => [d.date, d]));

      trip.days = generateDateRange(newStart, newEnd).map((date) => {
        const existing = existingDays.get(date);
        if (existing) return existing;
        return {
          date,
          dayOfWeek: getDayOfWeek(date),
          city: "",
          segments: [],
        };
      });
    }

    trip.updatedAt = new Date().toISOString();

    await storage.saveTrip(trip);
    res.json(trip);
    void recordContributorActivity(access, req, "edit");
  });

  router.delete("/:tripId", async (req: Request, res: Response) => {
    // Trip deletion is owner-only — even an edit-share contributor
    // shouldn't be able to delete the trip out from under the owner.
    const access = await accessTrip(req, req.params.tripId as string, "edit");
    if (!access.ok) return denyAccess(res, access);
    if (access.accessLevel !== "owner") return denyOwnerOnly(res);
    const { storage, trip } = access;
    const tripId = trip.id;

    // Capture the share tokens BEFORE deleting the trip so we can cascade
    // the cleanup to the snapshot store. The trip object is the source of
    // truth for which tokens existed; the registry only knows tokens that
    // hydrated successfully on the current process.
    const shareTokens = trip.shares.map((s) => s.shareToken);

    // Clean up share registry entries when a trip is deleted
    if (shareRegistry) {
      shareRegistry.removeByTrip(tripId);
    }
    if (shareSnapshotStore && shareTokens.length > 0) {
      shareSnapshotStore.deleteMany(shareTokens);
    }

    const deleted = await storage.deleteTrip(tripId);
    if (!deleted) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    res.status(204).send();
  });

  // ─── Days ────────────────────────────────────────────────

  router.get("/:tripId/days", async (req: Request, res: Response) => {
    const access = await accessTrip(req, req.params.tripId as string, "view");
    if (!access.ok) return denyAccess(res, access);
    res.json(access.trip.days);
  });

  router.put(
    "/:tripId/days/:date",
    async (req: Request, res: Response) => {
      const access = await accessTrip(req, req.params.tripId as string, "edit");
      if (!access.ok) return denyAccess(res, access);
      const { trip, storage } = access;

      const day = trip.days.find((d) => d.date === (req.params.date as string));
      if (!day) {
        res.status(404).json({ error: "Day not found" });
        return;
      }

      if (req.body.city !== undefined) day.city = req.body.city;
      trip.updatedAt = new Date().toISOString();
      await storage.saveTrip(trip);
      res.json(day);
      void recordContributorActivity(access, req, "edit");
    },
  );

  // ─── Segments ────────────────────────────────────────────

  router.get(
    "/:tripId/segments",
    async (req: Request, res: Response) => {
      const access = await accessTrip(req, req.params.tripId as string, "view");
      if (!access.ok) return denyAccess(res, access);
      const { trip } = access;

      const allSegments: (Segment & { date: string })[] = [];
      for (const day of trip.days) {
        for (const seg of day.segments) {
          allSegments.push({ ...seg, date: day.date });
        }
      }

      // Optional type filter
      const typeFilter = req.query.type as string | undefined;
      if (typeFilter) {
        const filtered = allSegments.filter((s) => s.type === typeFilter);
        res.json(filtered);
        return;
      }

      // Optional needs_review filter
      if (req.query.needs_review === "true") {
        res.json(allSegments.filter((s) => s.needsReview));
        return;
      }

      res.json(allSegments);
    },
  );

  router.post(
    "/:tripId/segments",
    async (req: Request, res: Response) => {
      const access = await accessTrip(req, req.params.tripId as string, "edit");
      if (!access.ok) return denyAccess(res, access);
      const { trip, storage } = access;

      const { date, ...segmentData } = req.body;
      if (!date) {
        res.status(400).json({ error: "date is required" });
        return;
      }

      const day = trip.days.find((d) => d.date === date);
      if (!day) {
        res.status(404).json({ error: "Day not found for given date" });
        return;
      }

      const parsed = createSegmentSchema.safeParse(segmentData);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues });
        return;
      }

      const segment: Segment = {
        ...parsed.data,
        id: generateId(),
        source: "manual",
        needsReview: false,
        sortOrder: day.segments.length,
      };

      day.segments.push(segment);
      // For cruises with per-day ports, update each TripDay.city to match.
      if (segment.type === "cruise" && segment.portsOfCall) {
        applyCruisePortsToDayCities(trip);
      }
      trip.updatedAt = new Date().toISOString();
      await storage.saveTrip(trip);
      res.status(201).json(segment);
      void recordContributorActivity(access, req, "edit");
    },
  );

  router.put(
    "/:tripId/segments/:segId",
    async (req: Request, res: Response) => {
      const access = await accessTrip(req, req.params.tripId as string, "edit");
      if (!access.ok) return denyAccess(res, access);
      const { trip, storage } = access;

      let found: Segment | undefined;
      let currentDay: TripDay | undefined;
      for (const day of trip.days) {
        const seg = day.segments.find(
          (s) => s.id === (req.params.segId as string),
        );
        if (seg) {
          found = seg;
          currentDay = day;
          break;
        }
      }

      if (!found || !currentDay) {
        res.status(404).json({ error: "Segment not found" });
        return;
      }

      // Validate partial updates
      const parsed = updateSegmentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues });
        return;
      }

      const { date: newDate, ...segmentUpdates } = parsed.data;

      if (newDate && newDate !== currentDay.date) {
        const targetDay = trip.days.find((d) => d.date === newDate);
        if (!targetDay) {
          res
            .status(400)
            .json({ error: "Target date is outside this trip's range" });
          return;
        }
        currentDay.segments = currentDay.segments.filter(
          (s) => s.id !== found!.id,
        );
        found.sortOrder = targetDay.segments.length;
        targetDay.segments.push(found);
      }

      // Apply validated updates (immutable fields protected by schema — id/source/sourceEmailId not in updateSegmentSchema)
      const wasNeedsReview = found.needsReview;
      for (const [key, value] of Object.entries(segmentUpdates)) {
        (found as unknown as Record<string, unknown>)[key] = value;
      }

      // Clearing the review flag is treated as a confirmation — mirror the
      // behavior of POST /segments/:id/confirm so editing a review-flagged
      // segment also updates its source.
      if (wasNeedsReview && found.needsReview === false) {
        found.source = "email_confirmed";
      }

      // A cruise update may have added or changed portsOfCall — re-run the
      // day-city override so TripDay cities stay in sync.
      if (found.type === "cruise" && found.portsOfCall) {
        applyCruisePortsToDayCities(trip);
      }

      trip.updatedAt = new Date().toISOString();
      await storage.saveTrip(trip);
      res.json(found);
      void recordContributorActivity(access, req, "edit");
    },
  );

  router.delete(
    "/:tripId/segments/:segId",
    async (req: Request, res: Response) => {
      const access = await accessTrip(req, req.params.tripId as string, "edit");
      if (!access.ok) return denyAccess(res, access);
      const { trip, storage } = access;

      let deletedCalendarEventId: string | undefined;
      let deleted = false;
      for (const day of trip.days) {
        const idx = day.segments.findIndex((s) => s.id === (req.params.segId as string));
        if (idx >= 0) {
          deletedCalendarEventId = day.segments[idx].calendarEventId;
          day.segments.splice(idx, 1);
          deleted = true;
          break;
        }
      }

      if (!deleted) {
        res.status(404).json({ error: "Segment not found" });
        return;
      }

      trip.updatedAt = new Date().toISOString();
      await storage.saveTrip(trip);

      // Remove the corresponding Google Calendar event if the trip is synced
      if (deletedCalendarEventId && trip.calendarId && req.accessToken) {
        const { deleteCalendarEvent } = await import("../services/google-calendar");
        deleteCalendarEvent(req.accessToken, trip.calendarId, deletedCalendarEventId).catch(() => {
          // Fire-and-forget — deletion failure is non-critical
        });
      }

      res.status(204).send();
      void recordContributorActivity(access, req, "edit");
    },
  );

  router.post(
    "/:tripId/segments/:segId/confirm",
    async (req: Request, res: Response) => {
      const access = await accessTrip(req, req.params.tripId as string, "edit");
      if (!access.ok) return denyAccess(res, access);
      const { trip, storage } = access;

      let found: Segment | undefined;
      for (const day of trip.days) {
        found = day.segments.find((s) => s.id === (req.params.segId as string));
        if (found) break;
      }

      if (!found) {
        res.status(404).json({ error: "Segment not found" });
        return;
      }

      found.needsReview = false;
      found.source = "email_confirmed";
      trip.updatedAt = new Date().toISOString();
      await storage.saveTrip(trip);
      res.json(found);
      void recordContributorActivity(access, req, "edit");
    },
  );

  router.post(
    "/:tripId/segments/confirm-all",
    async (req: Request, res: Response) => {
      const access = await accessTrip(req, req.params.tripId as string, "edit");
      if (!access.ok) return denyAccess(res, access);
      const { trip, storage } = access;

      let confirmed = 0;
      for (const day of trip.days) {
        for (const segment of day.segments) {
          if (segment.needsReview) {
            segment.needsReview = false;
            segment.source = "email_confirmed";
            confirmed += 1;
          }
        }
      }

      if (confirmed > 0) {
        trip.updatedAt = new Date().toISOString();
        await storage.saveTrip(trip);
      }
      res.json({ confirmed });
      if (confirmed > 0) void recordContributorActivity(access, req, "edit");
    },
  );

  // ─── Cost Summary ───────────────────────────────────────

  router.get("/:tripId/costs", async (req: Request, res: Response) => {
    const access = await accessTrip(req, req.params.tripId as string, "view");
    if (!access.ok) return denyAccess(res, access);
    const { trip } = access;

    const items: Array<{
      category: string;
      description: string;
      city?: string;
      amount: number;
      currency: string;
      amountUsd?: number;
      details?: string;
      segmentId: string;
    }> = [];

    for (const day of trip.days) {
      for (const seg of day.segments) {
        if (seg.cost) {
          const amountUsd = convertToUsd(seg.cost.amount, seg.cost.currency);
          // Prefer the segment's own city; fall back to the trip day's city
          // so the cost table can render "City: Activity" entries.
          const city = seg.city?.trim() || day.city?.trim() || undefined;
          items.push({
            category: seg.type,
            description: seg.title,
            city,
            amount: seg.cost.amount,
            currency: seg.cost.currency,
            amountUsd,
            details: seg.cost.details,
            segmentId: seg.id,
          });
        }
      }
    }

    const totalsByCurrency: Record<string, number> = {};
    let totalUsd = 0;
    let anyUsd = false;
    for (const item of items) {
      totalsByCurrency[item.currency] =
        (totalsByCurrency[item.currency] ?? 0) + item.amount;
      if (item.amountUsd !== undefined) {
        totalUsd += item.amountUsd;
        anyUsd = true;
      }
    }

    res.json({
      items,
      totalsByCurrency,
      ...(anyUsd ? { totalUsd } : {}),
    });
  });

  // ─── TODOs ──────────────────────────────────────────────

  router.get("/:tripId/todos", async (req: Request, res: Response) => {
    const access = await accessTrip(req, req.params.tripId as string, "view");
    if (!access.ok) return denyAccess(res, access);
    res.json(access.trip.todos);
  });

  router.post(
    "/:tripId/todos",
    async (req: Request, res: Response) => {
      const access = await accessTrip(req, req.params.tripId as string, "edit");
      if (!access.ok) return denyAccess(res, access);
      const { trip, storage } = access;

      const parsed = createTodoSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues });
        return;
      }

      const todo = {
        id: generateId(),
        text: parsed.data.text,
        isCompleted: false,
        category: parsed.data.category,
        details: parsed.data.details || undefined,
        sortOrder: trip.todos.length,
      };

      trip.todos.push(todo);
      trip.updatedAt = new Date().toISOString();
      await storage.saveTrip(trip);
      res.status(201).json(todo);
      void recordContributorActivity(access, req, "edit");
    },
  );

  router.put(
    "/:tripId/todos/:todoId",
    async (req: Request, res: Response) => {
      const access = await accessTrip(req, req.params.tripId as string, "edit");
      if (!access.ok) return denyAccess(res, access);
      const { trip, storage } = access;

      const todo = trip.todos.find((t) => t.id === (req.params.todoId as string));
      if (!todo) {
        res.status(404).json({ error: "Todo not found" });
        return;
      }

      const parsed = updateTodoSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues });
        return;
      }

      const updates = parsed.data;
      if (updates.text !== undefined) todo.text = updates.text;
      if (updates.isCompleted !== undefined)
        todo.isCompleted = updates.isCompleted;
      if (updates.category !== undefined) todo.category = updates.category;
      // null or empty string clears notes; non-empty string sets them.
      if (updates.details !== undefined) {
        todo.details = updates.details ? updates.details : undefined;
      }
      if (updates.sortOrder !== undefined) todo.sortOrder = updates.sortOrder;

      trip.updatedAt = new Date().toISOString();
      await storage.saveTrip(trip);
      res.json(todo);
      void recordContributorActivity(access, req, "edit");
    },
  );

  router.delete(
    "/:tripId/todos/:todoId",
    async (req: Request, res: Response) => {
      const access = await accessTrip(req, req.params.tripId as string, "edit");
      if (!access.ok) return denyAccess(res, access);
      const { trip, storage } = access;

      const idx = trip.todos.findIndex((t) => t.id === (req.params.todoId as string));
      if (idx < 0) {
        res.status(404).json({ error: "Todo not found" });
        return;
      }

      trip.todos.splice(idx, 1);
      trip.updatedAt = new Date().toISOString();
      await storage.saveTrip(trip);
      res.status(204).send();
      void recordContributorActivity(access, req, "edit");
    },
  );

  // ─── Shares ──────────────────────────────────────────────

  router.post(
    "/:tripId/share",
    async (req: Request, res: Response) => {
      // Only the owner may create shares — a contributor with edit
      // access can mutate the itinerary but not re-share the trip.
      const access = await accessTrip(req, req.params.tripId as string, "edit");
      if (!access.ok) return denyAccess(res, access);
      if (access.accessLevel !== "owner") return denyOwnerOnly(res);
      const { trip, storage } = access;

      const parsed = createShareSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues });
        return;
      }

      const share = {
        id: generateId(),
        shareToken: generateId(),
        sharedWithEmail: parsed.data.sharedWithEmail,
        permission: parsed.data.permission,
        showCosts: parsed.data.showCosts,
        showTodos: parsed.data.showTodos,
        createdAt: new Date().toISOString(),
      };

      trip.shares.push(share);
      trip.updatedAt = new Date().toISOString();
      await storage.saveTrip(trip);

      // Register share token in the share registry for public access
      // and (if `sharedWithEmail` is set) for the recipient's contributor
      // trip list.
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

      // Persist a display-only snapshot for the unfurl preview. The Edge
      // runtime reads this in `generateMetadata` to render the trip's
      // title and date range without calling back to the API.
      if (shareSnapshotStore) {
        shareSnapshotStore.set(share.shareToken, {
          title: trip.title,
          startDate: trip.startDate,
          endDate: trip.endDate,
          dayCount: trip.days.length,
        });
      }

      // Notify the recipient on every device they've registered. Fires
      // only when the share targets a specific email — anonymous "anyone
      // with the link" shares have no recipient to push to. Failure
      // (transient network, dead subscription) must not break share
      // creation, so we fire-and-forget and log inside the sender.
      if (notificationSender && share.sharedWithEmail) {
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

      res.status(201).json(share);
    },
  );

  router.get(
    "/:tripId/shares",
    async (req: Request, res: Response) => {
      // Owner-only — a contributor shouldn't see the share list or
      // discover the recipients of view-shares.
      const access = await accessTrip(req, req.params.tripId as string, "view");
      if (!access.ok) return denyAccess(res, access);
      if (access.accessLevel !== "owner") return denyOwnerOnly(res);
      res.json(access.trip.shares);
    },
  );

  router.delete(
    "/:tripId/shares/:shareId",
    async (req: Request, res: Response) => {
      const access = await accessTrip(req, req.params.tripId as string, "edit");
      if (!access.ok) return denyAccess(res, access);
      if (access.accessLevel !== "owner") return denyOwnerOnly(res);
      const { trip, storage } = access;

      const idx = trip.shares.findIndex((s) => s.id === (req.params.shareId as string));
      if (idx < 0) {
        res.status(404).json({ error: "Share not found" });
        return;
      }

      // Remove from share registry
      const removedShare = trip.shares[idx];
      if (shareRegistry && removedShare) {
        shareRegistry.remove(removedShare.shareToken);
      }
      if (shareSnapshotStore && removedShare) {
        shareSnapshotStore.delete(removedShare.shareToken);
      }

      trip.shares.splice(idx, 1);
      trip.updatedAt = new Date().toISOString();
      await storage.saveTrip(trip);
      res.status(204).send();

      // Tell the recipient their access is gone — same fire-and-forget
      // pattern as share creation. Anonymous link shares (no recipient
      // email) don't push since we have no one to address. The push
      // arrives just as the recipient's UI starts 404'ing on the trip
      // they had open, so they understand why rather than seeing a
      // blank "trip not found" page.
      if (notificationSender && removedShare?.sharedWithEmail) {
        const senderName = req.userEmail ?? "The owner";
        notificationSender
          .sendToEmail(removedShare.sharedWithEmail, {
            title: `${senderName} revoked your access`,
            body: `${trip.title} (${formatTripDateRange(trip.startDate, trip.endDate)})`,
            // Land them on the dashboard rather than the now-revoked
            // trip — clicking the notification shouldn't surface a 404.
            url: "/",
            tag: `share-revoke:${removedShare.shareToken}`,
            data: {
              kind: "share-revoke",
              shareToken: removedShare.shareToken,
              tripId: trip.id,
            },
          })
          .catch((err) =>
            console.warn(
              "[trips] share-revoke push failed:",
              err instanceof Error ? err.message : err,
            ),
          );
      }
    },
  );

  // ─── Export ──────────────────────────────────────────────

  router.get(
    "/:tripId/export/markdown",
    async (req: Request, res: Response) => {
      const access = await accessTrip(req, req.params.tripId as string, "view");
      if (!access.ok) return denyAccess(res, access);
      const { tripToMarkdown } = await import("@travel-app/shared");
      const { trip } = access;

      const excludeCosts = req.query.exclude?.toString().includes("costs");
      const excludeTodos = req.query.exclude?.toString().includes("todos");

      const markdown = tripToMarkdown(trip, {
        includeCosts: !excludeCosts,
        includeTodos: !excludeTodos,
      });

      res.setHeader("Content-Type", "text/markdown");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${trip.title.replace(/[^a-zA-Z0-9 ]/g, "")}.md"`,
      );
      res.send(markdown);
    },
  );

  router.get(
    "/:tripId/export/onenote",
    async (req: Request, res: Response) => {
      const access = await accessTrip(req, req.params.tripId as string, "view");
      if (!access.ok) return denyAccess(res, access);
      const { tripToOneNoteHtml } = await import("@travel-app/shared");
      const { trip } = access;

      const excludeCosts = req.query.exclude?.toString().includes("costs");
      const excludeTodos = req.query.exclude?.toString().includes("todos");

      const html = tripToOneNoteHtml(trip, {
        includeCosts: !excludeCosts,
        includeTodos: !excludeTodos,
      });

      res.setHeader("Content-Type", "text/html");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${trip.title.replace(/[^a-zA-Z0-9 ]/g, "")}.html"`,
      );
      res.send(html);
    },
  );

  router.get(
    "/:tripId/export/ical",
    async (req: Request, res: Response) => {
      const access = await accessTrip(req, req.params.tripId as string, "view");
      if (!access.ok) return denyAccess(res, access);
      const [{ tripToIcal }, { resolveTripTimezones }] = await Promise.all([
        import("@travel-app/shared"),
        import("../utils/timezone-lookup"),
      ]);
      const { trip } = access;

      await resolveTripTimezones(trip);
      const ics = tripToIcal(trip);
      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${trip.title.replace(/[^a-zA-Z0-9 ]/g, "")}.ics"`,
      );
      res.send(ics);
    },
  );

  router.get(
    "/:tripId/export/pdf",
    async (req: Request, res: Response) => {
      const access = await accessTrip(req, req.params.tripId as string, "view");
      if (!access.ok) return denyAccess(res, access);
      const { generateTripPdf } = await import("../utils/pdf-generator");
      const { trip } = access;

      const excludeCosts = req.query.exclude?.toString().includes("costs");
      const excludeTodos = req.query.exclude?.toString().includes("todos");

      const pdfBuffer = await generateTripPdf(trip, {
        includeCosts: !excludeCosts,
        includeTodos: !excludeTodos,
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${trip.title.replace(/[^a-zA-Z0-9 ]/g, "")}.pdf"`,
      );
      res.send(pdfBuffer);
    },
  );

  return router;
}
