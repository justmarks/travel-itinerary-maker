/**
 * Integration tests for share-activity tracking + owner push triggers.
 *
 * Multi-user harness mirrors `contributor-flow.test.ts` so two users
 * (Alice = owner, Bob = recipient) live in separate InMemoryStorages
 * connected via a ShareRegistry. We swap in a fake NotificationSender
 * that records calls instead of hitting the real web-push library, and
 * a real ShareActivityTracker so we can verify the throttle.
 */

import express from "express";
import request from "supertest";
import { InMemoryStorage } from "../../src/services/storage";
import { ShareRegistry } from "../../src/services/share-registry";
import { ShareActivityTracker } from "../../src/services/share-activity-tracker";
import { createTripRoutes } from "../../src/routes/trips";
import type { ResolveOwnerStorage } from "../../src/services/trip-access";

interface TestUser {
  id: string;
  email: string;
  storage: InMemoryStorage;
}

interface PushCall {
  email: string | undefined;
  payload: { title: string; body: string; url?: string; tag?: string; data?: Record<string, unknown> };
}

function buildHarness() {
  const alice: TestUser = {
    id: "alice-uid",
    email: "alice@example.com",
    storage: new InMemoryStorage(),
  };
  const bob: TestUser = {
    id: "bob-uid",
    email: "bob@example.com",
    storage: new InMemoryStorage(),
  };
  const users: Record<string, TestUser> = { alice, bob };
  const registry = new ShareRegistry();
  const tracker = new ShareActivityTracker({ windowMs: 30 * 60 * 1000 });
  const pushCalls: PushCall[] = [];
  const fakeSender = {
    isEnabled: () => true,
    sendToEmail: jest.fn(async (email: string | undefined, payload: PushCall["payload"]) => {
      pushCalls.push({ email, payload });
      return 1;
    }),
    sendToUser: jest.fn(),
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const key = req.header("x-test-user");
    const user = key ? users[key] : undefined;
    if (user) {
      req.userId = user.id;
      req.userEmail = user.email;
      req.accessToken = `${key}-token`;
    }
    next();
  });

  const resolveStorage = (req: express.Request) => {
    const user = Object.values(users).find((u) => u.id === req.userId);
    if (!user) throw new Error(`No storage for user ${req.userId}`);
    return user.storage;
  };

  const resolveOwnerStorage: ResolveOwnerStorage = async (ownerUserId) => {
    const owner = Object.values(users).find((u) => u.id === ownerUserId);
    return owner?.storage ?? null;
  };

  app.use(
    "/trips",
    createTripRoutes({
      resolveStorage,
      shareRegistry: registry,
      resolveOwnerStorage,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      notificationSender: fakeSender as any,
      shareActivityTracker: tracker,
    }),
  );

  return { app, alice, bob, registry, tracker, pushCalls, fakeSender };
}

async function aliceCreatesTripAndSharesWithBob(
  app: express.Express,
  permission: "view" | "edit" = "edit",
): Promise<{ tripId: string; shareId: string }> {
  const tripRes = await request(app)
    .post("/trips")
    .set("x-test-user", "alice")
    .send({ title: "Japan", startDate: "2027-06-01", endDate: "2027-06-03" });
  expect(tripRes.status).toBe(201);
  const tripId = tripRes.body.id;

  const shareRes = await request(app)
    .post(`/trips/${tripId}/share`)
    .set("x-test-user", "alice")
    .send({
      sharedWithEmail: "bob@example.com",
      permission,
      showCosts: true,
      showTodos: true,
    });
  expect(shareRes.status).toBe(201);
  return { tripId, shareId: shareRes.body.id };
}

describe("Share activity tracking — view", () => {
  it("bumps lastViewedAt and pushes the owner when Bob opens the trip", async () => {
    const { app, alice, pushCalls } = buildHarness();
    const { tripId } = await aliceCreatesTripAndSharesWithBob(app, "view");
    pushCalls.length = 0;

    const res = await request(app)
      .get(`/trips/${tripId}`)
      .set("x-test-user", "bob");
    expect(res.status).toBe(200);

    // Activity is fire-and-forget — wait for the microtask queue
    await new Promise((r) => setImmediate(r));

    const trip = await alice.storage.getTrip(tripId);
    expect(trip?.shares[0]!.lastViewedAt).toBeDefined();

    expect(pushCalls).toHaveLength(1);
    expect(pushCalls[0]!.email).toBe(alice.email);
    expect(pushCalls[0]!.payload.title).toContain("viewed");
    expect(pushCalls[0]!.payload.title).toContain("bob@example.com");
  });

  it("does not push when the OWNER opens their own trip", async () => {
    const { app, pushCalls } = buildHarness();
    const { tripId } = await aliceCreatesTripAndSharesWithBob(app);
    pushCalls.length = 0;

    const res = await request(app)
      .get(`/trips/${tripId}`)
      .set("x-test-user", "alice");
    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));

    expect(pushCalls).toHaveLength(0);
  });

  it("throttles repeat views — single push when Bob opens twice in a row", async () => {
    const { app, pushCalls } = buildHarness();
    const { tripId } = await aliceCreatesTripAndSharesWithBob(app);
    pushCalls.length = 0;

    await request(app).get(`/trips/${tripId}`).set("x-test-user", "bob");
    await new Promise((r) => setImmediate(r));
    await request(app).get(`/trips/${tripId}`).set("x-test-user", "bob");
    await new Promise((r) => setImmediate(r));

    expect(pushCalls).toHaveLength(1);
  });
});

describe("Share activity tracking — edit", () => {
  it("bumps lastEditedAt and pushes when Bob mutates a shared trip", async () => {
    const { app, alice, pushCalls } = buildHarness();
    const { tripId } = await aliceCreatesTripAndSharesWithBob(app, "edit");
    pushCalls.length = 0;

    // Bob adds a segment.
    const segRes = await request(app)
      .post(`/trips/${tripId}/segments`)
      .set("x-test-user", "bob")
      .send({
        date: "2027-06-01",
        type: "flight",
        title: "JFK → NRT",
      });
    expect(segRes.status).toBe(201);
    await new Promise((r) => setImmediate(r));

    const trip = await alice.storage.getTrip(tripId);
    expect(trip?.shares[0]!.lastEditedAt).toBeDefined();

    expect(pushCalls.length).toBeGreaterThanOrEqual(1);
    const editPush = pushCalls.find((c) => c.payload.title.includes("edited"));
    expect(editPush).toBeDefined();
    expect(editPush!.email).toBe(alice.email);
  });

  it("uses separate throttle windows for view and edit", async () => {
    const { app, pushCalls } = buildHarness();
    const { tripId } = await aliceCreatesTripAndSharesWithBob(app, "edit");
    pushCalls.length = 0;

    // View first — fires view push.
    await request(app).get(`/trips/${tripId}`).set("x-test-user", "bob");
    await new Promise((r) => setImmediate(r));

    // Edit immediately after — should still fire (different bucket).
    await request(app)
      .post(`/trips/${tripId}/segments`)
      .set("x-test-user", "bob")
      .send({ date: "2027-06-01", type: "flight", title: "Flight 1" });
    await new Promise((r) => setImmediate(r));

    const titles = pushCalls.map((c) => c.payload.title);
    expect(titles.some((t) => t.includes("viewed"))).toBe(true);
    expect(titles.some((t) => t.includes("edited"))).toBe(true);
  });

  it("does not push when the OWNER mutates their own trip", async () => {
    const { app, pushCalls } = buildHarness();
    const { tripId } = await aliceCreatesTripAndSharesWithBob(app);
    pushCalls.length = 0;

    await request(app)
      .post(`/trips/${tripId}/segments`)
      .set("x-test-user", "alice")
      .send({ date: "2027-06-01", type: "flight", title: "Flight 1" });
    await new Promise((r) => setImmediate(r));

    expect(pushCalls).toHaveLength(0);
  });
});
