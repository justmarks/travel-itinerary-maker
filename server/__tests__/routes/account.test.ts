import express from "express";
import request from "supertest";
import { InMemoryStorage } from "../../src/services/storage";
import { createAccountRoutes } from "../../src/routes/account";
import { generateId, type Trip } from "@itinly/shared";

const USER_ID = "user-1";

function buildApp(opts: { storage: InMemoryStorage; authed?: boolean }) {
  const app = express();
  app.use(express.json());

  // Memory-mode harness: optional fake auth that stamps req.userId.
  if (opts.authed !== false) {
    app.use((req, _res, next) => {
      req.userId = USER_ID;
      req.userEmail = `${USER_ID}@example.com`;
      next();
    });
  }

  app.use(
    "/api/v1/account",
    createAccountRoutes({ resolveStorage: opts.storage }),
  );
  return app;
}

function tripFixture(overrides: Partial<Trip> = {}): Trip {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    schemaVersion: 1,
    title: "Trip",
    startDate: "2026-06-01",
    endDate: "2026-06-05",
    status: "planning",
    days: [],
    todos: [],
    shares: [],
    history: [],
    createdAt: now,
    updatedAt: now,
    dayCities: {},
    ...overrides,
  };
}

describe("DELETE /api/v1/account (memory mode)", () => {
  it("wipes the in-memory storage and returns 204", async () => {
    const storage = new InMemoryStorage();
    await storage.saveTrip(tripFixture({ title: "Trip A" }));
    await storage.saveTrip(tripFixture({ title: "Trip B" }));
    await storage.saveShareRule({
      id: generateId(),
      ownerEmail: `${USER_ID}@example.com`,
      sharedWithEmail: "guest@example.com",
      permission: "view",
      showCosts: true,
      showTodos: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await storage.saveProcessedEmails([
      {
        gmailMessageId: "m1",
        parseStatus: "success",
        createdAt: new Date().toISOString(),
      },
    ]);

    const app = buildApp({ storage });
    await request(app).delete("/api/v1/account").expect(204);

    expect(await storage.listTrips()).toEqual([]);
    expect(await storage.listShareRules()).toEqual([]);
    expect(await storage.getProcessedEmails()).toEqual([]);
  });

  it("is idempotent — a second call still returns 204", async () => {
    const storage = new InMemoryStorage();
    await storage.saveTrip(tripFixture());
    const app = buildApp({ storage });

    await request(app).delete("/api/v1/account").expect(204);
    await request(app).delete("/api/v1/account").expect(204);
    expect(await storage.listTrips()).toEqual([]);
  });

  it("works without a userId (anonymous memory-mode path)", async () => {
    const storage = new InMemoryStorage();
    await storage.saveTrip(tripFixture());
    const app = buildApp({ storage, authed: false });

    await request(app).delete("/api/v1/account").expect(204);
    expect(await storage.listTrips()).toEqual([]);
  });
});
