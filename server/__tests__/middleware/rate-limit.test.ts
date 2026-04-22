import express from "express";
import request from "supertest";
import { createEmailScanRateLimiter } from "../../src/middleware/rate-limit";

/**
 * The production middleware short-circuits under `NODE_ENV === "test"` so
 * existing route suites don't trip it. These tests temporarily flip the env
 * to prove the limiter kicks in when it's supposed to.
 */
describe("createEmailScanRateLimiter", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "development"; // turn the limiter on
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  function makeApp(limit: number) {
    const app = express();
    const limiter = createEmailScanRateLimiter({ windowMs: 60_000, limit });
    app.post("/scan", limiter, (_req, res) => {
      res.status(200).json({ ok: true });
    });
    return app;
  }

  it("allows requests up to the configured limit", async () => {
    const app = makeApp(3);
    for (let i = 0; i < 3; i++) {
      const res = await request(app).post("/scan");
      expect(res.status).toBe(200);
    }
  });

  it("returns 429 once the limit is exceeded", async () => {
    const app = makeApp(2);
    await request(app).post("/scan").expect(200);
    await request(app).post("/scan").expect(200);
    const over = await request(app).post("/scan");
    expect(over.status).toBe(429);
    expect(over.body.error).toMatch(/too many scan requests/i);
  });

  it("keys separate users independently (different userIds get their own quotas)", async () => {
    // Simulate two authenticated users hitting the same endpoint. When keyed
    // by userId, neither should consume the other's quota.
    const app = express();
    app.use((req, _res, next) => {
      // Pretend auth middleware ran and attached userId from a header
      req.userId = req.header("x-user-id");
      next();
    });
    const limiter = createEmailScanRateLimiter({ windowMs: 60_000, limit: 1 });
    app.post("/scan", limiter, (_req, res) => {
      res.status(200).json({ ok: true });
    });

    // user-a burns their single request
    await request(app).post("/scan").set("x-user-id", "user-a").expect(200);
    await request(app).post("/scan").set("x-user-id", "user-a").expect(429);

    // user-b still has their own quota
    await request(app).post("/scan").set("x-user-id", "user-b").expect(200);
  });

  it("is inactive when NODE_ENV=test (so existing test suites don't need to worry about it)", async () => {
    process.env.NODE_ENV = "test";
    const app = makeApp(1);
    // Fire 5 requests; all should pass because the limiter short-circuits.
    for (let i = 0; i < 5; i++) {
      await request(app).post("/scan").expect(200);
    }
  });
});
