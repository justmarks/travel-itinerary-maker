/**
 * Verifies the "graceful Drive-scope failure" path: a user who signed in
 * but unticked Drive on the consent screen ends up with an access token
 * that 403s on every Drive call. We don't want the dashboard to die
 * outright — owned trips should silently come back empty and any trips
 * shared *with* the user should still surface, so they have a path
 * forward (the frontend banner re-asks for the scope).
 *
 * Mirrors the contributor-flow harness: mounts `createTripRoutes`
 * directly with a per-user storage map and a fake-auth header. To
 * simulate the scope failure we wrap one user's storage with a Proxy
 * that throws a Drive-shaped 403 from `listTrips()` only — write paths
 * are left intact so the test bed can still seed shares.
 */

import express from "express";
import request from "supertest";
import { InMemoryStorage } from "../../src/services/storage";
import type { StorageProvider } from "../../src/services/storage";
import { ShareRegistry } from "../../src/services/share-registry";
import { createTripRoutes } from "../../src/routes/trips";
import type { ResolveOwnerStorage } from "../../src/services/trip-access";
import { isInsufficientScopeError } from "../../src/services/google-drive/drive-error";

interface TestUser {
  id: string;
  email: string;
  storage: StorageProvider;
}

/** Mimics the GaxiosError thrown by googleapis when Drive scope is absent. */
function makeInsufficientScopeError(): Error {
  const err = new Error("Insufficient Permission") as Error & {
    code: number;
    errors: Array<{ reason: string; message: string }>;
  };
  err.code = 403;
  err.errors = [
    { reason: "insufficientPermissions", message: "Insufficient Permission" },
  ];
  return err;
}

function buildApp(users: Record<string, TestUser>, registry: ShareRegistry) {
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
    }),
  );
  return app;
}

describe("isInsufficientScopeError", () => {
  it("matches Drive's 403 / insufficientPermissions shape", () => {
    expect(isInsufficientScopeError(makeInsufficientScopeError())).toBe(true);
  });

  it("matches when the reason is insufficientScopes", () => {
    const err = new Error("oops") as Error & {
      errors: Array<{ reason: string }>;
    };
    err.errors = [{ reason: "insufficientScopes" }];
    expect(isInsufficientScopeError(err)).toBe(true);
  });

  it("does not match unrelated 403s", () => {
    const err = new Error("Forbidden") as Error & { code: number };
    err.code = 403;
    expect(isInsufficientScopeError(err)).toBe(false);
  });

  it("does not match unrelated errors that mention 'scope'", () => {
    // Status must be 403 *and* the message must hint at insufficiency.
    // A 500 with "scope" in the message is a server bug, not a missing scope.
    const err = new Error("Variable out of scope");
    expect(isInsufficientScopeError(err)).toBe(false);
  });

  it("returns false on null / undefined / non-objects", () => {
    expect(isInsufficientScopeError(null)).toBe(false);
    expect(isInsufficientScopeError(undefined)).toBe(false);
    expect(isInsufficientScopeError("Insufficient Permission")).toBe(false);
  });
});

describe("GET /trips with missing Drive scope", () => {
  let alice: TestUser;
  let bob: TestUser;
  let registry: ShareRegistry;
  let app: express.Express;

  beforeEach(async () => {
    // Alice owns a trip in her own (healthy) Drive.
    alice = {
      id: "alice-uid",
      email: "alice@example.com",
      storage: new InMemoryStorage(),
    };

    // Bob signed in but never granted Drive — every owner-side read
    // throws the 403 shape the helper recognises. We only override
    // listTrips here; the route never calls Bob's other methods because
    // resolveTripAccess swallows the owner-path failure and falls
    // through to the share registry.
    const bobStorage = new InMemoryStorage();
    bob = {
      id: "bob-uid",
      email: "bob@example.com",
      storage: new Proxy(bobStorage, {
        get(target, prop, receiver) {
          if (prop === "listTrips") {
            return () => Promise.reject(makeInsufficientScopeError());
          }
          return Reflect.get(target, prop, receiver);
        },
      }),
    };

    registry = new ShareRegistry();
    app = buildApp({ alice, bob }, registry);

    // Seed: alice creates a trip and shares it with bob.
    const created = await request(app)
      .post("/trips")
      .set("x-test-user", "alice")
      .send({
        title: "Tokyo Trip",
        startDate: "2027-06-01",
        endDate: "2027-06-03",
      });
    expect(created.status).toBe(201);

    const shared = await request(app)
      .post(`/trips/${created.body.id}/share`)
      .set("x-test-user", "alice")
      .send({
        sharedWithEmail: bob.email,
        permission: "view",
        showCosts: true,
        showTodos: true,
      });
    expect(shared.status).toBe(201);
  });

  it("returns shared trips even when the user's own listTrips 403s", async () => {
    const res = await request(app).get("/trips").set("x-test-user", "bob");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      title: "Tokyo Trip",
      sharedFromEmail: alice.email,
      sharedPermission: "view",
    });
  });

  it("re-throws non-scope errors (still 5xx) so real bugs aren't masked", async () => {
    // Swap Bob's storage for one whose listTrips throws a generic
    // (non-scope) error. The graceful path should NOT swallow it —
    // only the specific Drive-403 shape is allowed to degrade.
    const carol: TestUser = {
      id: "carol-uid",
      email: "carol@example.com",
      storage: new Proxy(new InMemoryStorage(), {
        get(target, prop, receiver) {
          if (prop === "listTrips") {
            return () => Promise.reject(new Error("disk ate the bytes"));
          }
          return Reflect.get(target, prop, receiver);
        },
      }),
    };
    const bugApp = buildApp({ carol }, new ShareRegistry());

    const res = await request(bugApp).get("/trips").set("x-test-user", "carol");
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to list/i);
  });
});
