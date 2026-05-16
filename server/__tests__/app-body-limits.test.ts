// Set env vars before any imports so config picks them up.
process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";

import request from "supertest";
import { createApp } from "../src/app";
import { InMemoryStorage } from "../src/services/storage";

/**
 * End-to-end smoke for the body-parser config in `createApp`.
 *
 * Two buckets — `/api/v1/auth/*` is capped tight (64kb) so a rate-
 * limited attacker can't bomb 10mb bodies into the auth flow, while
 * everything else stays at the 10mb cap that import-html / xlsx
 * imports need. This is the regression guard against the global
 * 10mb limit being applied to auth routes by mistake.
 */
describe("body-parser limits per route bucket", () => {
  it("rejects >64kb bodies on /api/v1/auth/* with 413", async () => {
    const app = await createApp({
      mode: "memory",
      storage: new InMemoryStorage(),
      disableRedis: true,
    });

    // 80kb of nothing — comfortably over the 64kb auth bucket, well
    // under the 10mb everywhere-else bucket.
    const huge = "x".repeat(80 * 1024);

    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Content-Type", "application/json")
      .send({ refreshToken: huge });

    // Express body-parser surfaces oversize bodies as 413 Payload Too
    // Large via its `PayloadTooLargeError`. Asserting on the status
    // alone proves the tight parser saw the request before the route
    // handler did — the wide parser would have accepted it.
    expect(res.status).toBe(413);
  });

  it("still accepts a tiny auth body (control: limit is on size, not the route)", async () => {
    const app = await createApp({
      mode: "memory",
      storage: new InMemoryStorage(),
      disableRedis: true,
    });

    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Content-Type", "application/json")
      .send({ refreshToken: "small-token" });

    // No 413 here — the body fits under 64kb. The route itself fails
    // because no Google client is wired up in this app, but that's
    // not 413.
    expect(res.status).not.toBe(413);
  });
});
