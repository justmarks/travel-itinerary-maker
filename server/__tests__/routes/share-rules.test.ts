import express from "express";
import request from "supertest";
import { InMemoryStorage } from "../../src/services/storage";
import { ShareRegistry } from "../../src/services/share-registry";
import { createShareRuleRoutes } from "../../src/routes/share-rules";
import { createTripRoutes } from "../../src/routes/trips";
import type { Trip } from "@itinly/shared";

const OWNER_ID = "owner-uid";
const OWNER_EMAIL = "owner@example.com";
const RECIPIENT_EMAIL = "guest@example.com";

function buildApp(opts: { storage: InMemoryStorage; registry?: ShareRegistry }) {
  const app = express();
  app.use(express.json());

  // Fake auth — every request is "owner". Tests that need to deny
  // can override the header.
  app.use((req, _res, next) => {
    const headerUser = req.header("x-test-user");
    if (headerUser === "anon") {
      next();
      return;
    }
    if (headerUser === "other") {
      req.userId = "other-uid";
      req.userEmail = "other@example.com";
    } else {
      req.userId = OWNER_ID;
      req.userEmail = OWNER_EMAIL;
    }
    next();
  });

  const resolveStorage = () => opts.storage;
  app.use(
    "/share-rules",
    createShareRuleRoutes({
      resolveStorage,
      shareRegistry: opts.registry,
    }),
  );
  app.use(
    "/trips",
    createTripRoutes({
      resolveStorage,
      shareRegistry: opts.registry,
    }),
  );
  return app;
}

async function createTrip(app: express.Express, title: string, dates: [string, string]) {
  const res = await request(app)
    .post("/trips")
    .send({ title, startDate: dates[0], endDate: dates[1] });
  expect(res.status).toBe(201);
  return res.body as Trip;
}

async function fetchTrip(app: express.Express, id: string): Promise<Trip> {
  const res = await request(app).get(`/trips/${id}`);
  expect(res.status).toBe(200);
  return res.body as Trip;
}

describe("share-rules routes", () => {
  let storage: InMemoryStorage;
  let registry: ShareRegistry;
  let app: express.Express;

  beforeEach(() => {
    storage = new InMemoryStorage();
    registry = new ShareRegistry();
    app = buildApp({ storage, registry });
  });

  describe("POST /share-rules", () => {
    it("creates a rule and backfills across N trips", async () => {
      const t1 = await createTrip(app, "Trip 1", ["2027-01-01", "2027-01-03"]);
      const t2 = await createTrip(app, "Trip 2", ["2027-02-01", "2027-02-03"]);
      const t3 = await createTrip(app, "Trip 3", ["2027-03-01", "2027-03-03"]);

      const res = await request(app)
        .post("/share-rules")
        .send({
          sharedWithEmail: RECIPIENT_EMAIL,
          permission: "view",
          showCosts: true,
          showTodos: true,
        });
      expect(res.status).toBe(201);
      expect(res.body.spawnedShareCount).toBe(3);
      expect(res.body.upgradedShareCount).toBe(0);
      expect(res.body.rule.id).toBeTruthy();

      for (const trip of [t1, t2, t3]) {
        const fresh = await fetchTrip(app, trip.id);
        expect(fresh.shares).toHaveLength(1);
        expect(fresh.shares[0].sharedWithEmail).toBe(RECIPIENT_EMAIL);
        expect(fresh.shares[0].originRuleId).toBe(res.body.rule.id);
      }
    });

    it("normalises recipient email to lowercase", async () => {
      const res = await request(app)
        .post("/share-rules")
        .send({
          sharedWithEmail: "Guest@Example.COM",
          permission: "view",
          showCosts: true,
          showTodos: true,
        });
      expect(res.status).toBe(201);
      expect(res.body.rule.sharedWithEmail).toBe("guest@example.com");
    });

    it("rejects when a rule already exists for that recipient (409)", async () => {
      await request(app)
        .post("/share-rules")
        .send({
          sharedWithEmail: RECIPIENT_EMAIL,
          permission: "view",
          showCosts: true,
          showTodos: true,
        });

      const dupe = await request(app)
        .post("/share-rules")
        .send({
          sharedWithEmail: RECIPIENT_EMAIL,
          permission: "edit",
          showCosts: true,
          showTodos: true,
        });
      expect(dupe.status).toBe(409);
      expect(dupe.body.existingRuleId).toBeTruthy();
    });

    it("rejects an invalid email payload (400)", async () => {
      const res = await request(app)
        .post("/share-rules")
        .send({
          sharedWithEmail: "not-an-email",
          permission: "view",
          showCosts: true,
          showTodos: true,
        });
      expect(res.status).toBe(400);
    });

    it("rejects sharing with yourself (400)", async () => {
      const res = await request(app)
        .post("/share-rules")
        .send({
          sharedWithEmail: OWNER_EMAIL,
          permission: "view",
          showCosts: true,
          showTodos: true,
        });
      expect(res.status).toBe(400);
    });

    it("requires auth (401)", async () => {
      const res = await request(app)
        .post("/share-rules")
        .set("x-test-user", "anon")
        .send({
          sharedWithEmail: RECIPIENT_EMAIL,
          permission: "view",
          showCosts: true,
          showTodos: true,
        });
      expect(res.status).toBe(401);
    });

    describe("conflict policy: upgrade only if stricter", () => {
      it("upgrades a view share to edit when rule grants edit", async () => {
        const trip = await createTrip(app, "Trip", ["2027-01-01", "2027-01-03"]);
        // Pre-create a manual view share for the recipient.
        const manualRes = await request(app)
          .post(`/trips/${trip.id}/share`)
          .send({
            sharedWithEmail: RECIPIENT_EMAIL,
            permission: "view",
            showCosts: true,
            showTodos: true,
          });
        expect(manualRes.status).toBe(201);

        const res = await request(app)
          .post("/share-rules")
          .send({
            sharedWithEmail: RECIPIENT_EMAIL,
            permission: "edit",
            showCosts: true,
            showTodos: true,
          });
        expect(res.status).toBe(201);
        expect(res.body.spawnedShareCount).toBe(0);
        expect(res.body.upgradedShareCount).toBe(1);

        const fresh = await fetchTrip(app, trip.id);
        expect(fresh.shares).toHaveLength(1);
        expect(fresh.shares[0].permission).toBe("edit");
        expect(fresh.shares[0].originRuleId).toBe(res.body.rule.id);
      });

      it("does NOT downgrade an edit share when rule grants view", async () => {
        const trip = await createTrip(app, "Trip", ["2027-01-01", "2027-01-03"]);
        const manualRes = await request(app)
          .post(`/trips/${trip.id}/share`)
          .send({
            sharedWithEmail: RECIPIENT_EMAIL,
            permission: "edit",
            showCosts: true,
            showTodos: true,
          });
        expect(manualRes.status).toBe(201);

        const res = await request(app)
          .post("/share-rules")
          .send({
            sharedWithEmail: RECIPIENT_EMAIL,
            permission: "view",
            showCosts: true,
            showTodos: true,
          });
        expect(res.status).toBe(201);
        expect(res.body.spawnedShareCount).toBe(0);
        expect(res.body.upgradedShareCount).toBe(0);

        const fresh = await fetchTrip(app, trip.id);
        expect(fresh.shares).toHaveLength(1);
        expect(fresh.shares[0].permission).toBe("edit");
        // Manual share, not tagged with the rule.
        expect(fresh.shares[0].originRuleId).toBeUndefined();
      });

      it("skips trips where existing share has equal permission", async () => {
        const trip = await createTrip(app, "Trip", ["2027-01-01", "2027-01-03"]);
        await request(app)
          .post(`/trips/${trip.id}/share`)
          .send({
            sharedWithEmail: RECIPIENT_EMAIL,
            permission: "view",
            showCosts: true,
            showTodos: true,
          });

        const res = await request(app)
          .post("/share-rules")
          .send({
            sharedWithEmail: RECIPIENT_EMAIL,
            permission: "view",
            showCosts: true,
            showTodos: true,
          });
        expect(res.status).toBe(201);
        expect(res.body.spawnedShareCount).toBe(0);
        expect(res.body.upgradedShareCount).toBe(0);

        const fresh = await fetchTrip(app, trip.id);
        expect(fresh.shares[0].originRuleId).toBeUndefined();
      });
    });
  });

  describe("GET /share-rules", () => {
    it("returns the owner's rules only", async () => {
      const created = await request(app)
        .post("/share-rules")
        .send({
          sharedWithEmail: RECIPIENT_EMAIL,
          permission: "view",
          showCosts: true,
          showTodos: true,
        });
      expect(created.status).toBe(201);

      const ownerList = await request(app).get("/share-rules");
      expect(ownerList.status).toBe(200);
      expect(ownerList.body).toHaveLength(1);

      // A different user shouldn't see this owner's rule.
      const otherList = await request(app)
        .get("/share-rules")
        .set("x-test-user", "other");
      expect(otherList.status).toBe(200);
      expect(otherList.body).toHaveLength(0);
    });
  });

  describe("PUT /share-rules/:ruleId", () => {
    it("cascades permission changes onto every share with originRuleId", async () => {
      const t1 = await createTrip(app, "Trip 1", ["2027-01-01", "2027-01-03"]);
      const t2 = await createTrip(app, "Trip 2", ["2027-02-01", "2027-02-03"]);

      const created = await request(app)
        .post("/share-rules")
        .send({
          sharedWithEmail: RECIPIENT_EMAIL,
          permission: "view",
          showCosts: true,
          showTodos: true,
        });
      const ruleId = created.body.rule.id;

      const res = await request(app)
        .put(`/share-rules/${ruleId}`)
        .send({ permission: "edit" });
      expect(res.status).toBe(200);
      expect(res.body.updatedShareCount).toBe(2);

      for (const trip of [t1, t2]) {
        const fresh = await fetchTrip(app, trip.id);
        expect(fresh.shares[0].permission).toBe("edit");
      }
    });

    it("does not touch manual shares (no originRuleId)", async () => {
      const trip = await createTrip(app, "Trip", ["2027-01-01", "2027-01-03"]);
      // Manual share to a DIFFERENT email so the rule won't backfill / upgrade it.
      await request(app)
        .post(`/trips/${trip.id}/share`)
        .send({
          sharedWithEmail: "manual@example.com",
          permission: "view",
          showCosts: true,
          showTodos: true,
        });

      const created = await request(app)
        .post("/share-rules")
        .send({
          sharedWithEmail: RECIPIENT_EMAIL,
          permission: "view",
          showCosts: true,
          showTodos: true,
        });
      const ruleId = created.body.rule.id;

      await request(app)
        .put(`/share-rules/${ruleId}`)
        .send({ permission: "edit" });

      const fresh = await fetchTrip(app, trip.id);
      const manual = fresh.shares.find((s) => s.sharedWithEmail === "manual@example.com");
      expect(manual?.permission).toBe("view");
    });

    it("rejects an empty body (400)", async () => {
      const created = await request(app)
        .post("/share-rules")
        .send({
          sharedWithEmail: RECIPIENT_EMAIL,
          permission: "view",
          showCosts: true,
          showTodos: true,
        });
      const res = await request(app)
        .put(`/share-rules/${created.body.rule.id}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it("404 for a rule owned by another user", async () => {
      const created = await request(app)
        .post("/share-rules")
        .send({
          sharedWithEmail: RECIPIENT_EMAIL,
          permission: "view",
          showCosts: true,
          showTodos: true,
        });
      const res = await request(app)
        .put(`/share-rules/${created.body.rule.id}`)
        .set("x-test-user", "other")
        .send({ permission: "edit" });
      expect(res.status).toBe(404);
    });
  });

  describe("trip-create fan-out", () => {
    it("spawns a share on a new trip when a rule exists", async () => {
      const created = await request(app)
        .post("/share-rules")
        .send({
          sharedWithEmail: RECIPIENT_EMAIL,
          permission: "edit",
          showCosts: false,
          showTodos: true,
        });
      expect(created.status).toBe(201);

      const trip = await createTrip(app, "After-rule trip", ["2027-04-01", "2027-04-03"]);
      const fresh = await fetchTrip(app, trip.id);
      expect(fresh.shares).toHaveLength(1);
      expect(fresh.shares[0].sharedWithEmail).toBe(RECIPIENT_EMAIL);
      expect(fresh.shares[0].permission).toBe("edit");
      expect(fresh.shares[0].showCosts).toBe(false);
      expect(fresh.shares[0].originRuleId).toBe(created.body.rule.id);
    });

    it("re-spawns on a new trip even after the recipient left an earlier one", async () => {
      const created = await request(app)
        .post("/share-rules")
        .send({
          sharedWithEmail: RECIPIENT_EMAIL,
          permission: "view",
          showCosts: true,
          showTodos: true,
        });
      const ruleId = created.body.rule.id;

      const t1 = await createTrip(app, "Trip 1", ["2027-05-01", "2027-05-03"]);
      const t1After = await fetchTrip(app, t1.id);
      const spawned = t1After.shares.find((s) => s.originRuleId === ruleId);
      expect(spawned).toBeDefined();

      // Simulate recipient leaving t1 by deleting the share via the
      // owner endpoint (close enough for this assertion — both paths
      // remove the share).
      const del = await request(app).delete(
        `/trips/${t1.id}/shares/${spawned!.id}`,
      );
      expect(del.status).toBe(204);

      const t2 = await createTrip(app, "Trip 2", ["2027-06-01", "2027-06-03"]);
      const t2After = await fetchTrip(app, t2.id);
      expect(t2After.shares.find((s) => s.originRuleId === ruleId)).toBeDefined();
    });

    it("creates no shares when there are no rules", async () => {
      const trip = await createTrip(app, "No-rule trip", ["2027-07-01", "2027-07-03"]);
      const fresh = await fetchTrip(app, trip.id);
      expect(fresh.shares).toHaveLength(0);
    });
  });

  describe("DELETE /share-rules/:ruleId", () => {
    it("400 when cascade query param is missing", async () => {
      const created = await request(app)
        .post("/share-rules")
        .send({
          sharedWithEmail: RECIPIENT_EMAIL,
          permission: "view",
          showCosts: true,
          showTodos: true,
        });
      const res = await request(app).delete(`/share-rules/${created.body.rule.id}`);
      expect(res.status).toBe(400);
    });

    it("cascade=false leaves spawned shares intact", async () => {
      const trip = await createTrip(app, "Trip", ["2027-01-01", "2027-01-03"]);
      const created = await request(app)
        .post("/share-rules")
        .send({
          sharedWithEmail: RECIPIENT_EMAIL,
          permission: "view",
          showCosts: true,
          showTodos: true,
        });

      const res = await request(app).delete(
        `/share-rules/${created.body.rule.id}?cascade=false`,
      );
      expect(res.status).toBe(200);
      expect(res.body.revokedShareCount).toBe(0);

      const fresh = await fetchTrip(app, trip.id);
      expect(fresh.shares).toHaveLength(1);
      // Tag remains — the share is now an "orphan" of a deleted rule
      // but the recipient still has access.
      expect(fresh.shares[0].originRuleId).toBe(created.body.rule.id);
    });

    it("cascade=true revokes only originRuleId-matching shares", async () => {
      const trip = await createTrip(app, "Trip", ["2027-01-01", "2027-01-03"]);
      // Manual share to a different recipient.
      await request(app)
        .post(`/trips/${trip.id}/share`)
        .send({
          sharedWithEmail: "other-guest@example.com",
          permission: "view",
          showCosts: true,
          showTodos: true,
        });
      const created = await request(app)
        .post("/share-rules")
        .send({
          sharedWithEmail: RECIPIENT_EMAIL,
          permission: "view",
          showCosts: true,
          showTodos: true,
        });

      const res = await request(app).delete(
        `/share-rules/${created.body.rule.id}?cascade=true`,
      );
      expect(res.status).toBe(200);
      expect(res.body.revokedShareCount).toBe(1);

      const fresh = await fetchTrip(app, trip.id);
      expect(fresh.shares).toHaveLength(1);
      expect(fresh.shares[0].sharedWithEmail).toBe("other-guest@example.com");
      expect(fresh.shares[0].originRuleId).toBeUndefined();
    });

    it("404 when deleting a rule owned by another user", async () => {
      const created = await request(app)
        .post("/share-rules")
        .send({
          sharedWithEmail: RECIPIENT_EMAIL,
          permission: "view",
          showCosts: true,
          showTodos: true,
        });
      const res = await request(app)
        .delete(`/share-rules/${created.body.rule.id}?cascade=true`)
        .set("x-test-user", "other");
      expect(res.status).toBe(404);
    });
  });
});
