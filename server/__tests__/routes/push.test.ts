/**
 * Route-level tests for /api/v1/push/* using a tiny test app.
 *
 * The full `createApp` factory in memory mode doesn't apply
 * `requireAuth`, which would leave `req.userId` / `req.userEmail`
 * undefined and our subscribe/unsubscribe routes returning 401. To
 * exercise the happy paths we mount the router on a hand-rolled
 * Express app with a fake auth middleware that injects the values
 * directly. This mirrors the unit-test ergonomics used by other
 * route tests.
 */

import express from "express";
import request from "supertest";
import { createPushRoutes } from "../../src/routes/push";
import { PushSubscriptionStore } from "../../src/services/push-subscription-store";

interface FakeAuth {
  userId?: string;
  userEmail?: string;
}

function buildApp(store: PushSubscriptionStore, auth: FakeAuth | null) {
  const app = express();
  app.use(express.json());
  if (auth) {
    app.use((req, _res, next) => {
      req.userId = auth.userId;
      req.userEmail = auth.userEmail;
      next();
    });
  }
  app.use("/api/v1/push", createPushRoutes({ store }));
  return app;
}

const SUB = {
  endpoint: "https://push.example/abc",
  keys: { p256dh: "p256-key", auth: "auth-key" },
};

describe("POST /api/v1/push/subscribe", () => {
  it("rejects unauthenticated requests", async () => {
    const store = new PushSubscriptionStore();
    const app = buildApp(store, null);
    const res = await request(app)
      .post("/api/v1/push/subscribe")
      .send({ subscription: SUB });
    expect(res.status).toBe(401);
  });

  it("registers a subscription for the authenticated user", async () => {
    const store = new PushSubscriptionStore();
    const app = buildApp(store, { userId: "user-1", userEmail: "alice@example.com" });

    const res = await request(app)
      .post("/api/v1/push/subscribe")
      .send({ subscription: SUB, userAgent: "test-browser" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
    const list = store.listForUser("user-1");
    expect(list).toHaveLength(1);
    expect(list[0]!.subscription.endpoint).toBe(SUB.endpoint);
    expect(list[0]!.userAgent).toBe("test-browser");
  });

  it("rejects invalid subscription payloads", async () => {
    const store = new PushSubscriptionStore();
    const app = buildApp(store, { userId: "user-1", userEmail: "alice@example.com" });

    const res = await request(app)
      .post("/api/v1/push/subscribe")
      .send({ subscription: { endpoint: "not-a-url", keys: { p256dh: "", auth: "" } } });

    expect(res.status).toBe(400);
    expect(store.listForUser("user-1")).toEqual([]);
  });

  it("upserts when the same browser re-subscribes", async () => {
    const store = new PushSubscriptionStore();
    const app = buildApp(store, { userId: "user-1", userEmail: "alice@example.com" });

    await request(app)
      .post("/api/v1/push/subscribe")
      .send({ subscription: SUB, userAgent: "first" });
    await request(app)
      .post("/api/v1/push/subscribe")
      .send({ subscription: SUB, userAgent: "second" });

    const list = store.listForUser("user-1");
    expect(list).toHaveLength(1);
    expect(list[0]!.userAgent).toBe("second");
  });
});

describe("POST /api/v1/push/unsubscribe", () => {
  it("removes the matching endpoint", async () => {
    const store = new PushSubscriptionStore();
    store.upsert({
      userId: "user-1",
      email: "alice@example.com",
      subscription: SUB,
    });
    const app = buildApp(store, { userId: "user-1", userEmail: "alice@example.com" });

    const res = await request(app)
      .post("/api/v1/push/unsubscribe")
      .send({ endpoint: SUB.endpoint });

    expect(res.status).toBe(204);
    expect(store.listForUser("user-1")).toEqual([]);
  });

  it("400s when no endpoint provided", async () => {
    const store = new PushSubscriptionStore();
    const app = buildApp(store, { userId: "user-1", userEmail: "alice@example.com" });

    const res = await request(app).post("/api/v1/push/unsubscribe").send({});
    expect(res.status).toBe(400);
  });

  it("rejects unauthenticated requests", async () => {
    const store = new PushSubscriptionStore();
    const app = buildApp(store, null);
    const res = await request(app)
      .post("/api/v1/push/unsubscribe")
      .send({ endpoint: SUB.endpoint });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/v1/push/status", () => {
  it("returns subscribed=false when the user has no devices", async () => {
    const store = new PushSubscriptionStore();
    const app = buildApp(store, { userId: "user-1", userEmail: "alice@example.com" });

    const res = await request(app).get("/api/v1/push/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ subscribed: false, deviceCount: 0 });
  });

  it("returns subscribed=true with deviceCount after a subscription", async () => {
    const store = new PushSubscriptionStore();
    store.upsert({
      userId: "user-1",
      email: "alice@example.com",
      subscription: SUB,
    });
    const app = buildApp(store, { userId: "user-1", userEmail: "alice@example.com" });

    const res = await request(app).get("/api/v1/push/status");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ subscribed: true, deviceCount: 1 });
  });

  it("filters by endpoint when provided", async () => {
    const store = new PushSubscriptionStore();
    store.upsert({
      userId: "user-1",
      email: "alice@example.com",
      subscription: SUB,
    });
    const app = buildApp(store, { userId: "user-1", userEmail: "alice@example.com" });

    const matched = await request(app)
      .get(`/api/v1/push/status?endpoint=${encodeURIComponent(SUB.endpoint)}`);
    expect(matched.body.subscribed).toBe(true);

    const missed = await request(app)
      .get(`/api/v1/push/status?endpoint=${encodeURIComponent("https://push.example/other")}`);
    expect(missed.body.subscribed).toBe(false);
    expect(missed.body.deviceCount).toBe(1);
  });
});

describe("GET /api/v1/push/config", () => {
  it("returns the public key and enabled flag", async () => {
    const store = new PushSubscriptionStore();
    const app = buildApp(store, { userId: "user-1", userEmail: "alice@example.com" });
    const res = await request(app).get("/api/v1/push/config");
    expect(res.status).toBe(200);
    expect(typeof res.body.enabled).toBe("boolean");
    // publicKey is null in tests where VAPID_*_KEY is unset
    expect(res.body).toHaveProperty("publicKey");
  });
});
