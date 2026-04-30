/**
 * Integration tests for the contributor-flow gates added in PR B.
 * Builds a multi-user test harness on top of `createTripRoutes` directly
 * (not `createApp`, which is single-storage in memory mode), wires
 * `resolveStorage` and `resolveOwnerStorage` by the `x-test-user` header,
 * and exercises the view/edit/owner-only branches.
 */

import express from "express";
import request from "supertest";
import { InMemoryStorage } from "../../src/services/storage";
import { ShareRegistry } from "../../src/services/share-registry";
import { createTripRoutes } from "../../src/routes/trips";
import type { ResolveOwnerStorage } from "../../src/services/trip-access";

interface TestUser {
  id: string;
  email: string;
  storage: InMemoryStorage;
}

function buildApp(users: Record<string, TestUser>, registry: ShareRegistry) {
  const app = express();
  app.use(express.json());

  // Fake auth: a header picks which test user the request is "from".
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
    }),
  );
  return app;
}

async function createTrip(app: express.Express, who: string, title: string) {
  const res = await request(app)
    .post("/trips")
    .set("x-test-user", who)
    .send({ title, startDate: "2027-06-01", endDate: "2027-06-03" });
  expect(res.status).toBe(201);
  return res.body;
}

async function shareTripWith(
  app: express.Express,
  owner: string,
  tripId: string,
  recipientEmail: string,
  permission: "view" | "edit",
) {
  const res = await request(app)
    .post(`/trips/${tripId}/share`)
    .set("x-test-user", owner)
    .send({
      sharedWithEmail: recipientEmail,
      permission,
      showCosts: true,
      showTodos: true,
    });
  expect(res.status).toBe(201);
  return res.body;
}

describe("Contributor flow", () => {
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let registry: ShareRegistry;
  let app: express.Express;

  beforeEach(() => {
    alice = {
      id: "alice-uid",
      email: "alice@example.com",
      storage: new InMemoryStorage(),
    };
    bob = {
      id: "bob-uid",
      email: "bob@example.com",
      storage: new InMemoryStorage(),
    };
    carol = {
      id: "carol-uid",
      email: "carol@example.com",
      storage: new InMemoryStorage(),
    };
    registry = new ShareRegistry();
    app = buildApp({ alice, bob, carol }, registry);
  });

  describe("GET /trips", () => {
    it("merges shared trips into the recipient's list with owner attribution", async () => {
      const trip = await createTrip(app, "alice", "Tokyo Trip");
      await shareTripWith(app, "alice", trip.id, bob.email, "edit");

      const bobsList = await request(app).get("/trips").set("x-test-user", "bob");
      expect(bobsList.status).toBe(200);
      expect(bobsList.body).toHaveLength(1);
      expect(bobsList.body[0]).toMatchObject({
        id: trip.id,
        title: "Tokyo Trip",
        sharedFromEmail: alice.email,
        sharedPermission: "edit",
      });
    });

    it("does not duplicate a trip the user owns even if a share exists for them", async () => {
      const trip = await createTrip(app, "bob", "My Trip");
      // Pretend Bob shared the trip with himself (silly but possible).
      await shareTripWith(app, "bob", trip.id, bob.email, "view");

      const list = await request(app).get("/trips").set("x-test-user", "bob");
      expect(list.body).toHaveLength(1);
      expect(list.body[0].id).toBe(trip.id);
      expect(list.body[0].sharedFromEmail).toBeUndefined();
    });

    it("excludes trips shared with someone else", async () => {
      const trip = await createTrip(app, "alice", "Tokyo Trip");
      await shareTripWith(app, "alice", trip.id, bob.email, "view");

      const carolsList = await request(app)
        .get("/trips")
        .set("x-test-user", "carol");
      expect(carolsList.body).toHaveLength(0);
    });
  });

  describe("read access", () => {
    it("lets a contributor read a trip shared with them", async () => {
      const trip = await createTrip(app, "alice", "Tokyo Trip");
      await shareTripWith(app, "alice", trip.id, bob.email, "view");

      const res = await request(app)
        .get(`/trips/${trip.id}`)
        .set("x-test-user", "bob");
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(trip.id);
    });

    it("returns 404 to a third party with no share", async () => {
      const trip = await createTrip(app, "alice", "Tokyo Trip");
      const res = await request(app)
        .get(`/trips/${trip.id}`)
        .set("x-test-user", "carol");
      expect(res.status).toBe(404);
    });
  });

  describe("write access", () => {
    it("lets an edit-share contributor update the trip", async () => {
      const trip = await createTrip(app, "alice", "Tokyo Trip");
      await shareTripWith(app, "alice", trip.id, bob.email, "edit");

      const res = await request(app)
        .put(`/trips/${trip.id}`)
        .set("x-test-user", "bob")
        .send({ title: "Bob's Renamed Tokyo Trip" });
      expect(res.status).toBe(200);

      // The change must actually land in the OWNER'S storage — not a fork
      // on Bob's account.
      const aliceTrip = await alice.storage.getTrip(trip.id);
      expect(aliceTrip?.title).toBe("Bob's Renamed Tokyo Trip");
    });

    it("rejects writes from a view-only share with 403", async () => {
      const trip = await createTrip(app, "alice", "Tokyo Trip");
      await shareTripWith(app, "alice", trip.id, bob.email, "view");

      const res = await request(app)
        .put(`/trips/${trip.id}`)
        .set("x-test-user", "bob")
        .send({ title: "Sneaky" });
      expect(res.status).toBe(403);
      expect(res.body.reason).toBe("shared-view-only");
    });

    it("rejects writes from a third party with 404", async () => {
      const trip = await createTrip(app, "alice", "Tokyo Trip");
      const res = await request(app)
        .put(`/trips/${trip.id}`)
        .set("x-test-user", "carol")
        .send({ title: "Nope" });
      expect(res.status).toBe(404);
    });
  });

  describe("owner-only operations", () => {
    it("blocks an edit-share contributor from deleting the trip", async () => {
      const trip = await createTrip(app, "alice", "Tokyo Trip");
      await shareTripWith(app, "alice", trip.id, bob.email, "edit");

      const res = await request(app)
        .delete(`/trips/${trip.id}`)
        .set("x-test-user", "bob");
      expect(res.status).toBe(403);
      expect(res.body.reason).toBe("owner-only");

      // Trip must still exist in Alice's storage.
      const stillThere = await alice.storage.getTrip(trip.id);
      expect(stillThere).toBeTruthy();
    });

    it("blocks an edit-share contributor from creating new shares", async () => {
      const trip = await createTrip(app, "alice", "Tokyo Trip");
      await shareTripWith(app, "alice", trip.id, bob.email, "edit");

      const res = await request(app)
        .post(`/trips/${trip.id}/share`)
        .set("x-test-user", "bob")
        .send({
          sharedWithEmail: carol.email,
          permission: "view",
          showCosts: true,
          showTodos: true,
        });
      expect(res.status).toBe(403);
      expect(res.body.reason).toBe("owner-only");
    });

    it("blocks a contributor from listing the share roster", async () => {
      const trip = await createTrip(app, "alice", "Tokyo Trip");
      await shareTripWith(app, "alice", trip.id, bob.email, "edit");

      const res = await request(app)
        .get(`/trips/${trip.id}/shares`)
        .set("x-test-user", "bob");
      expect(res.status).toBe(403);
    });
  });

  describe("segment + todo writes via contributor flow", () => {
    it("lets an edit-share contributor add a segment", async () => {
      const trip = await createTrip(app, "alice", "Tokyo Trip");
      await shareTripWith(app, "alice", trip.id, bob.email, "edit");

      const res = await request(app)
        .post(`/trips/${trip.id}/segments`)
        .set("x-test-user", "bob")
        .send({
          date: "2027-06-01",
          type: "activity",
          title: "Bob's recommended ramen spot",
        });
      expect(res.status).toBe(201);

      // Verify the segment landed in Alice's trip
      const aliceTrip = await alice.storage.getTrip(trip.id);
      const day = aliceTrip?.days.find((d) => d.date === "2027-06-01");
      expect(day?.segments.some((s) => s.title.includes("ramen"))).toBe(true);
    });

    it("rejects segment add from a view-only share", async () => {
      const trip = await createTrip(app, "alice", "Tokyo Trip");
      await shareTripWith(app, "alice", trip.id, bob.email, "view");

      const res = await request(app)
        .post(`/trips/${trip.id}/segments`)
        .set("x-test-user", "bob")
        .send({
          date: "2027-06-01",
          type: "activity",
          title: "Sneaky add",
        });
      expect(res.status).toBe(403);
    });
  });
});
