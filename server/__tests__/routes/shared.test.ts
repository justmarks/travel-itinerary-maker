import request from "supertest";
import express from "express";
import { createSharedRoutes } from "../../src/routes/shared";
import { InMemoryStorage } from "../../src/services/storage";
import type { Trip } from "@travel-app/shared";

// DriveStorage is imported by shared.ts but only instantiated when shareRegistry
// provides an owner userId — not exercised in these tests.
jest.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({ setCredentials: jest.fn() })),
    },
    drive: jest.fn(),
  },
}));

let idCounter = 0;
function nextId() {
  return `id-${++idCounter}`;
}

function makeTrip(shareToken: string, shareOverrides: Partial<Trip["shares"][0]> = {}): Trip {
  return {
    id: nextId(),
    title: "Japan Trip",
    startDate: "2027-06-01",
    endDate: "2027-06-02",
    status: "planning",
    days: [
      {
        date: "2027-06-01",
        dayOfWeek: "Tue",
        city: "Tokyo",
        segments: [
          {
            id: nextId(),
            type: "flight",
            title: "SEA → NRT",
            date: "2027-06-01",
            cost: { amount: 800, currency: "USD" },
          },
        ],
      },
    ],
    todos: [{ id: nextId(), text: "Book taxi", done: false }],
    shares: [
      {
        id: nextId(),
        shareToken,
        permission: "view",
        showCosts: false,
        showTodos: false,
        createdAt: new Date().toISOString(),
        ...shareOverrides,
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    schemaVersion: 1,
  };
}

function makeApp(storage: InMemoryStorage) {
  const app = express();
  app.use(express.json());
  app.use("/shared", createSharedRoutes({ resolveStorage: storage }));
  return app;
}

describe("GET /shared/:token", () => {
  let storage: InMemoryStorage;

  beforeEach(() => {
    idCounter = 0;
    storage = new InMemoryStorage();
  });

  it("returns trip data for a valid share token", async () => {
    await storage.saveTrip(makeTrip("tok-abc"));
    const res = await request(makeApp(storage)).get("/shared/tok-abc");
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Japan Trip");
    expect(res.body.startDate).toBe("2027-06-01");
  });

  it("returns 404 for an unknown share token", async () => {
    const res = await request(makeApp(storage)).get("/shared/no-such-token");
    expect(res.status).toBe(404);
  });

  it("hides segment costs when showCosts is false", async () => {
    await storage.saveTrip(makeTrip("tok-no-costs", { showCosts: false }));
    const res = await request(makeApp(storage)).get("/shared/tok-no-costs");
    expect(res.status).toBe(200);
    expect(res.body.days[0].segments[0].cost).toBeUndefined();
  });

  it("exposes segment costs when showCosts is true", async () => {
    await storage.saveTrip(makeTrip("tok-costs", { showCosts: true }));
    const res = await request(makeApp(storage)).get("/shared/tok-costs");
    expect(res.status).toBe(200);
    expect(res.body.days[0].segments[0].cost).toEqual({ amount: 800, currency: "USD" });
  });

  it("returns empty todos array when showTodos is false", async () => {
    await storage.saveTrip(makeTrip("tok-no-todos", { showTodos: false }));
    const res = await request(makeApp(storage)).get("/shared/tok-no-todos");
    expect(res.status).toBe(200);
    expect(res.body.todos).toEqual([]);
  });

  it("returns todos when showTodos is true", async () => {
    await storage.saveTrip(makeTrip("tok-todos", { showTodos: true }));
    const res = await request(makeApp(storage)).get("/shared/tok-todos");
    expect(res.status).toBe(200);
    expect(res.body.todos).toHaveLength(1);
    expect(res.body.todos[0].text).toBe("Book taxi");
  });

  it("returns 410 Gone for an expired share link", async () => {
    await storage.saveTrip(
      makeTrip("tok-expired", { expiresAt: "2020-01-01T00:00:00.000Z" }),
    );
    const res = await request(makeApp(storage)).get("/shared/tok-expired");
    expect(res.status).toBe(410);
  });

  it("does not expire a share with a future expiresAt", async () => {
    await storage.saveTrip(
      makeTrip("tok-future", { expiresAt: "2099-01-01T00:00:00.000Z" }),
    );
    const res = await request(makeApp(storage)).get("/shared/tok-future");
    expect(res.status).toBe(200);
  });

  it("includes permission in the response but not the full shares array", async () => {
    await storage.saveTrip(makeTrip("tok-perm", { permission: "view" }));
    const res = await request(makeApp(storage)).get("/shared/tok-perm");
    expect(res.status).toBe(200);
    expect(res.body.permission).toBe("view");
    expect(res.body.shares).toBeUndefined();
  });
});
