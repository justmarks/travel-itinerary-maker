import { Router, type Request, type Response } from "express";
import {
  createTripSchema,
  updateTripSchema,
  createSegmentSchema,
  updateSegmentSchema,
  createTodoSchema,
  updateTodoSchema,
  createShareSchema,
  generateId,
  generateDateRange,
  getDayOfWeek,
  findOverlappingTrips,
  type Trip,
  type TripDay,
  type Segment,
} from "@travel-app/shared";
import type { StorageProvider, StorageResolver } from "../services/storage";
import type { ShareRegistry } from "../services/share-registry";

export interface TripRoutesOptions {
  resolveStorage: StorageResolver | StorageProvider;
  shareRegistry?: ShareRegistry;
}

export function createTripRoutes(options: TripRoutesOptions): Router {
  const { resolveStorage, shareRegistry } = options;

  // Support both a resolver function and a direct storage instance
  const getStorage: StorageResolver =
    typeof resolveStorage === "function"
      ? resolveStorage
      : () => resolveStorage;

  const router = Router();

  // ─── Trip CRUD ───────────────────────────────────────────

  router.get("/", async (req: Request, res: Response) => {
    try {
      const storage = getStorage(req);
      const trips = await storage.listTrips();
      // Return summary list (without full day/segment data)
      const summaries = trips.map((t) => ({
        id: t.id,
        title: t.title,
        startDate: t.startDate,
        endDate: t.endDate,
        status: t.status,
        dayCount: t.days.length,
        todoCount: t.todos.filter((td) => !td.isCompleted).length,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      }));
      res.json(summaries);
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
    };

    await storage.saveTrip(trip);
    res.status(201).json(trip);
  });

  router.get("/:tripId", async (req: Request, res: Response) => {
    const storage = getStorage(req);
    const trip = await storage.getTrip(req.params.tripId as string);
    if (!trip) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    res.json(trip);
  });

  router.put("/:tripId", async (req: Request, res: Response) => {
    const storage = getStorage(req);
    const trip = await storage.getTrip(req.params.tripId as string);
    if (!trip) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }

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
  });

  router.delete("/:tripId", async (req: Request, res: Response) => {
    const storage = getStorage(req);
    const tripId = req.params.tripId as string;

    // Clean up share registry entries when a trip is deleted
    if (shareRegistry) {
      shareRegistry.removeByTrip(tripId);
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
    const storage = getStorage(req);
    const trip = await storage.getTrip(req.params.tripId as string);
    if (!trip) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    res.json(trip.days);
  });

  router.put(
    "/:tripId/days/:date",
    async (req: Request, res: Response) => {
      const storage = getStorage(req);
      const trip = await storage.getTrip(req.params.tripId as string);
      if (!trip) {
        res.status(404).json({ error: "Trip not found" });
        return;
      }

      const day = trip.days.find((d) => d.date === (req.params.date as string));
      if (!day) {
        res.status(404).json({ error: "Day not found" });
        return;
      }

      if (req.body.city !== undefined) day.city = req.body.city;
      trip.updatedAt = new Date().toISOString();
      await storage.saveTrip(trip);
      res.json(day);
    },
  );

  // ─── Segments ────────────────────────────────────────────

  router.get(
    "/:tripId/segments",
    async (req: Request, res: Response) => {
      const storage = getStorage(req);
      const trip = await storage.getTrip(req.params.tripId as string);
      if (!trip) {
        res.status(404).json({ error: "Trip not found" });
        return;
      }

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
      const storage = getStorage(req);
      const trip = await storage.getTrip(req.params.tripId as string);
      if (!trip) {
        res.status(404).json({ error: "Trip not found" });
        return;
      }

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
      trip.updatedAt = new Date().toISOString();
      await storage.saveTrip(trip);
      res.status(201).json(segment);
    },
  );

  router.put(
    "/:tripId/segments/:segId",
    async (req: Request, res: Response) => {
      const storage = getStorage(req);
      const trip = await storage.getTrip(req.params.tripId as string);
      if (!trip) {
        res.status(404).json({ error: "Trip not found" });
        return;
      }

      let found: Segment | undefined;
      for (const day of trip.days) {
        found = day.segments.find((s) => s.id === (req.params.segId as string));
        if (found) break;
      }

      if (!found) {
        res.status(404).json({ error: "Segment not found" });
        return;
      }

      // Validate partial updates
      const parsed = updateSegmentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues });
        return;
      }

      // Apply validated updates (immutable fields protected by schema — id/source/sourceEmailId not in updateSegmentSchema)
      for (const [key, value] of Object.entries(parsed.data)) {
        (found as unknown as Record<string, unknown>)[key] = value;
      }

      trip.updatedAt = new Date().toISOString();
      await storage.saveTrip(trip);
      res.json(found);
    },
  );

  router.delete(
    "/:tripId/segments/:segId",
    async (req: Request, res: Response) => {
      const storage = getStorage(req);
      const trip = await storage.getTrip(req.params.tripId as string);
      if (!trip) {
        res.status(404).json({ error: "Trip not found" });
        return;
      }

      let deleted = false;
      for (const day of trip.days) {
        const idx = day.segments.findIndex((s) => s.id === (req.params.segId as string));
        if (idx >= 0) {
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
      res.status(204).send();
    },
  );

  router.post(
    "/:tripId/segments/:segId/confirm",
    async (req: Request, res: Response) => {
      const storage = getStorage(req);
      const trip = await storage.getTrip(req.params.tripId as string);
      if (!trip) {
        res.status(404).json({ error: "Trip not found" });
        return;
      }

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
    },
  );

  // ─── Cost Summary ───────────────────────────────────────

  router.get("/:tripId/costs", async (req: Request, res: Response) => {
    const storage = getStorage(req);
    const trip = await storage.getTrip(req.params.tripId as string);
    if (!trip) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }

    const items: Array<{
      category: string;
      description: string;
      amount: number;
      currency: string;
      details?: string;
      segmentId: string;
    }> = [];

    for (const day of trip.days) {
      for (const seg of day.segments) {
        if (seg.cost) {
          items.push({
            category: seg.type,
            description: seg.title,
            amount: seg.cost.amount,
            currency: seg.cost.currency,
            details: seg.cost.details,
            segmentId: seg.id,
          });
        }
      }
    }

    const totalsByCurrency: Record<string, number> = {};
    for (const item of items) {
      totalsByCurrency[item.currency] =
        (totalsByCurrency[item.currency] ?? 0) + item.amount;
    }

    res.json({ items, totalsByCurrency });
  });

  // ─── TODOs ──────────────────────────────────────────────

  router.get("/:tripId/todos", async (req: Request, res: Response) => {
    const storage = getStorage(req);
    const trip = await storage.getTrip(req.params.tripId as string);
    if (!trip) {
      res.status(404).json({ error: "Trip not found" });
      return;
    }
    res.json(trip.todos);
  });

  router.post(
    "/:tripId/todos",
    async (req: Request, res: Response) => {
      const storage = getStorage(req);
      const trip = await storage.getTrip(req.params.tripId as string);
      if (!trip) {
        res.status(404).json({ error: "Trip not found" });
        return;
      }

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
        sortOrder: trip.todos.length,
      };

      trip.todos.push(todo);
      trip.updatedAt = new Date().toISOString();
      await storage.saveTrip(trip);
      res.status(201).json(todo);
    },
  );

  router.put(
    "/:tripId/todos/:todoId",
    async (req: Request, res: Response) => {
      const storage = getStorage(req);
      const trip = await storage.getTrip(req.params.tripId as string);
      if (!trip) {
        res.status(404).json({ error: "Trip not found" });
        return;
      }

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
      if (updates.sortOrder !== undefined) todo.sortOrder = updates.sortOrder;

      trip.updatedAt = new Date().toISOString();
      await storage.saveTrip(trip);
      res.json(todo);
    },
  );

  router.delete(
    "/:tripId/todos/:todoId",
    async (req: Request, res: Response) => {
      const storage = getStorage(req);
      const trip = await storage.getTrip(req.params.tripId as string);
      if (!trip) {
        res.status(404).json({ error: "Trip not found" });
        return;
      }

      const idx = trip.todos.findIndex((t) => t.id === (req.params.todoId as string));
      if (idx < 0) {
        res.status(404).json({ error: "Todo not found" });
        return;
      }

      trip.todos.splice(idx, 1);
      trip.updatedAt = new Date().toISOString();
      await storage.saveTrip(trip);
      res.status(204).send();
    },
  );

  // ─── Shares ──────────────────────────────────────────────

  router.post(
    "/:tripId/share",
    async (req: Request, res: Response) => {
      const storage = getStorage(req);
      const trip = await storage.getTrip(req.params.tripId as string);
      if (!trip) {
        res.status(404).json({ error: "Trip not found" });
        return;
      }

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
      if (shareRegistry && req.userId) {
        shareRegistry.register(share.shareToken, trip.id, req.userId);
      }

      res.status(201).json(share);
    },
  );

  router.get(
    "/:tripId/shares",
    async (req: Request, res: Response) => {
      const storage = getStorage(req);
      const trip = await storage.getTrip(req.params.tripId as string);
      if (!trip) {
        res.status(404).json({ error: "Trip not found" });
        return;
      }
      res.json(trip.shares);
    },
  );

  router.delete(
    "/:tripId/shares/:shareId",
    async (req: Request, res: Response) => {
      const storage = getStorage(req);
      const trip = await storage.getTrip(req.params.tripId as string);
      if (!trip) {
        res.status(404).json({ error: "Trip not found" });
        return;
      }

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

      trip.shares.splice(idx, 1);
      trip.updatedAt = new Date().toISOString();
      await storage.saveTrip(trip);
      res.status(204).send();
    },
  );

  // ─── Export ──────────────────────────────────────────────

  router.get(
    "/:tripId/export/markdown",
    async (req: Request, res: Response) => {
      const storage = getStorage(req);
      const { tripToMarkdown } = await import("@travel-app/shared");
      const trip = await storage.getTrip(req.params.tripId as string);
      if (!trip) {
        res.status(404).json({ error: "Trip not found" });
        return;
      }

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
      const storage = getStorage(req);
      const { tripToOneNoteHtml } = await import("@travel-app/shared");
      const trip = await storage.getTrip(req.params.tripId as string);
      if (!trip) {
        res.status(404).json({ error: "Trip not found" });
        return;
      }

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

  return router;
}
