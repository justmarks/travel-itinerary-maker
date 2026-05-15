import express from "express";
import request from "supertest";
import { InMemoryStorage } from "../../src/services/storage";
import {
  createEmailScanScheduleRoutes,
} from "../../src/routes/email-scan-schedules";
import {
  createMemoryDueEmailScanScheduleStore,
} from "../../src/services/email-scan-due";
import type { EmailScanSchedule } from "@itinly/shared";

const OWNER_ID = "owner-uid";

function buildApp(storage: InMemoryStorage) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const u = req.header("x-test-user") || "owner";
    if (u === "anon") return next();
    if (u === "other") {
      req.userId = "other-uid";
    } else {
      req.userId = OWNER_ID;
    }
    next();
  });
  const resolveStorage = () => storage;
  app.use(
    "/email-scan-schedules",
    createEmailScanScheduleRoutes({
      resolveStorage,
      resolveStorageForUser: async () => storage,
      dueScheduleStore: createMemoryDueEmailScanScheduleStore(storage),
    }),
  );
  return app;
}

describe("email-scan-schedules routes", () => {
  let storage: InMemoryStorage;
  let app: express.Express;

  beforeEach(() => {
    storage = new InMemoryStorage();
    app = buildApp(storage);
  });

  describe("POST /email-scan-schedules", () => {
    it("creates a schedule with computed nextRunAt", async () => {
      const before = Date.now();
      const res = await request(app)
        .post("/email-scan-schedules")
        .send({ provider: "google", frequency: "daily" });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeTruthy();
      expect(res.body.userId).toBe(OWNER_ID);
      expect(res.body.provider).toBe("google");
      expect(res.body.frequency).toBe("daily");
      expect(res.body.enabled).toBe(true);
      const next = new Date(res.body.nextRunAt).getTime();
      // Daily cadence ⇒ nextRunAt is ~24h out from creation. Allow
      // 5 minutes of slop for slow test boxes.
      expect(next - before).toBeGreaterThan(23 * 60 * 60 * 1000);
      expect(next - before).toBeLessThan(25 * 60 * 60 * 1000);
    });

    it("rejects a payload missing frequency", async () => {
      const res = await request(app)
        .post("/email-scan-schedules")
        .send({ provider: "google" });
      expect(res.status).toBe(400);
    });

    it("rejects an unknown frequency", async () => {
      const res = await request(app)
        .post("/email-scan-schedules")
        .send({ provider: "google", frequency: "hourly" });
      expect(res.status).toBe(400);
    });

    it("rejects an unauthenticated request", async () => {
      const res = await request(app)
        .post("/email-scan-schedules")
        .set("x-test-user", "anon")
        .send({ provider: "google", frequency: "daily" });
      expect(res.status).toBe(401);
    });

    it("stores includeSublabels: false by default when omitted", async () => {
      const res = await request(app)
        .post("/email-scan-schedules")
        .send({ provider: "google", frequency: "daily" });
      expect(res.status).toBe(201);
      expect(res.body.includeSublabels).toBe(false);
    });

    it("stores includeSublabels: true when sent + round-trips through GET", async () => {
      const created = await request(app)
        .post("/email-scan-schedules")
        .send({
          provider: "google",
          frequency: "daily",
          labelFilter: "Label_42",
          labelName: "Travel",
          includeSublabels: true,
        });
      expect(created.status).toBe(201);
      expect(created.body.includeSublabels).toBe(true);

      const list = await request(app).get("/email-scan-schedules");
      const found = (list.body as Array<{ id: string; includeSublabels: boolean }>)
        .find((s) => s.id === created.body.id);
      expect(found?.includeSublabels).toBe(true);
    });

    it("PUT can flip includeSublabels back to false", async () => {
      const created = await request(app)
        .post("/email-scan-schedules")
        .send({
          provider: "google",
          frequency: "daily",
          labelFilter: "Label_42",
          includeSublabels: true,
        });
      const res = await request(app)
        .put(`/email-scan-schedules/${created.body.id}`)
        .send({ includeSublabels: false });
      expect(res.status).toBe(200);
      expect(res.body.includeSublabels).toBe(false);
    });
  });

  describe("GET /email-scan-schedules", () => {
    it("returns user's schedules in creation order", async () => {
      await request(app)
        .post("/email-scan-schedules")
        .send({ provider: "google", frequency: "daily" });
      await request(app)
        .post("/email-scan-schedules")
        .send({ provider: "microsoft", frequency: "weekly" });

      const res = await request(app).get("/email-scan-schedules");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].provider).toBe("google");
      expect(res.body[1].provider).toBe("microsoft");
    });

    it("returns empty for anonymous requests", async () => {
      const res = await request(app)
        .get("/email-scan-schedules")
        .set("x-test-user", "anon");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe("PUT /email-scan-schedules/:id", () => {
    it("toggles enabled", async () => {
      const created = await request(app)
        .post("/email-scan-schedules")
        .send({ provider: "google", frequency: "daily" });
      const id = created.body.id;
      const res = await request(app)
        .put(`/email-scan-schedules/${id}`)
        .send({ enabled: false });
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
    });

    it("recomputes nextRunAt when frequency changes", async () => {
      const created = await request(app)
        .post("/email-scan-schedules")
        .send({ provider: "google", frequency: "daily" });
      const before = new Date(created.body.nextRunAt).getTime();

      const res = await request(app)
        .put(`/email-scan-schedules/${created.body.id}`)
        .send({ frequency: "monthly" });
      expect(res.status).toBe(200);
      const after = new Date(res.body.nextRunAt).getTime();
      // Monthly is much further out than daily.
      expect(after).toBeGreaterThan(before);
    });

    it("clears labelFilter when client sends null", async () => {
      const created = await request(app)
        .post("/email-scan-schedules")
        .send({
          provider: "google",
          frequency: "daily",
          labelFilter: "Label_5",
          labelName: "Travel",
        });
      const res = await request(app)
        .put(`/email-scan-schedules/${created.body.id}`)
        .send({ labelFilter: null, labelName: null });
      expect(res.status).toBe(200);
      expect(res.body.labelFilter).toBeUndefined();
      expect(res.body.labelName).toBeUndefined();
    });

    it("rejects empty patches", async () => {
      const created = await request(app)
        .post("/email-scan-schedules")
        .send({ provider: "google", frequency: "daily" });
      const res = await request(app)
        .put(`/email-scan-schedules/${created.body.id}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it("404s when the id is unknown", async () => {
      const res = await request(app)
        .put("/email-scan-schedules/missing")
        .send({ enabled: false });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /email-scan-schedules/:id", () => {
    it("deletes the schedule and its run history", async () => {
      const created = await request(app)
        .post("/email-scan-schedules")
        .send({ provider: "google", frequency: "daily" });
      // Seed a fake run row so we can confirm cascade.
      await storage.saveEmailScanRun({
        id: "run-1",
        scheduleId: created.body.id,
        userId: OWNER_ID,
        startedAt: new Date().toISOString(),
        status: "succeeded",
        scannedCount: 5,
        newCount: 1,
      });
      expect(await storage.listEmailScanRuns(created.body.id)).toHaveLength(1);
      const res = await request(app).delete(
        `/email-scan-schedules/${created.body.id}`,
      );
      expect(res.status).toBe(200);
      expect(await storage.listEmailScanRuns(created.body.id)).toHaveLength(0);
      expect(await storage.getEmailScanSchedule(created.body.id)).toBeNull();
    });
  });

  describe("GET /email-scan-schedules/:id/runs", () => {
    it("returns runs newest-first, capped at 50", async () => {
      const created = await request(app)
        .post("/email-scan-schedules")
        .send({ provider: "google", frequency: "daily" });
      // Insert 55 runs to exceed the cap.
      const base = Date.now();
      for (let i = 0; i < 55; i++) {
        await storage.saveEmailScanRun({
          id: `run-${i}`,
          scheduleId: created.body.id,
          userId: OWNER_ID,
          // 1-min increments so the sort order is deterministic.
          startedAt: new Date(base + i * 60_000).toISOString(),
          status: "succeeded",
          scannedCount: 1,
          newCount: 0,
        });
      }
      const res = await request(app).get(
        `/email-scan-schedules/${created.body.id}/runs`,
      );
      expect(res.status).toBe(200);
      // Capped at 50; newest first.
      expect(res.body).toHaveLength(50);
      // First entry is the latest insert.
      expect(res.body[0].id).toBe("run-54");
    });

    it("404s when the schedule id is unknown", async () => {
      const res = await request(app).get(
        "/email-scan-schedules/missing/runs",
      );
      expect(res.status).toBe(404);
    });
  });

  describe("POST /email-scan-schedules/tick (cron)", () => {
    it("runs every due schedule and skips non-due ones", async () => {
      // Schedule A: due NOW (nextRunAt in the past)
      const dueSched: EmailScanSchedule = {
        id: "sched-due",
        userId: OWNER_ID,
        provider: "google",
        frequency: "daily",
        enabled: true,
        nextRunAt: new Date(Date.now() - 60_000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await storage.saveEmailScanSchedule(dueSched);

      // Schedule B: NOT due — nextRunAt is in the future.
      const futureSched: EmailScanSchedule = {
        id: "sched-future",
        userId: OWNER_ID,
        provider: "google",
        frequency: "weekly",
        enabled: true,
        nextRunAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await storage.saveEmailScanSchedule(futureSched);

      // Schedule C: due but DISABLED — must be skipped.
      const disabledSched: EmailScanSchedule = {
        id: "sched-disabled",
        userId: OWNER_ID,
        provider: "google",
        frequency: "daily",
        enabled: false,
        nextRunAt: new Date(Date.now() - 60_000).toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await storage.saveEmailScanSchedule(disabledSched);

      const res = await request(app).post("/email-scan-schedules/tick");
      expect(res.status).toBe(200);
      // Only sched-due is due. The executor will mark it "failed"
      // because no connectionsStore is wired in this test app, but a
      // run record still gets written.
      expect(res.body.dueCount).toBe(1);

      const runs = await storage.listEmailScanRuns("sched-due");
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe("failed");
      expect(runs[0].errorMessage).toMatch(/AI service not configured|isn't connected/i);
    });
  });
});
