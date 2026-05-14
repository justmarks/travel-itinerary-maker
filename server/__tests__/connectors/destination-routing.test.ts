/**
 * Phase 4: calendar destination routing — when the user has both
 * Google and Microsoft calendar connections, the `?provider=` query
 * param the route forwards must route to the matching connector,
 * and the auto-pick (no preference) must follow the Microsoft-first
 * rule the resolver documents.
 *
 * Scope: unit-level on `createConnectorResolvers` with a fake
 * `ConnectionsStore`. This is the layer that owns the routing
 * decision; running it through Supertest would only re-exercise
 * Express plumbing without proving more about the routing rule.
 * Per-impl HTTP behaviour stays covered by the existing per-route
 * tests.
 */

import { createConnectorResolvers } from "../../src/connectors/resolve";
import { GoogleCalendarConnector } from "../../src/connectors/google-calendar-connector";
import { MicrosoftCalendarConnector } from "../../src/connectors/microsoft-calendar-connector";
import { GoogleEmailConnector } from "../../src/connectors/google-email-connector";
import { MicrosoftEmailConnector } from "../../src/connectors/microsoft-email-connector";
import type {
  Connection,
  ConnectionsStore,
} from "../../src/services/connections-store";
import type { Request } from "express";

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "conn-1",
    userId: "user-1",
    provider: "google",
    capability: "calendar",
    accountEmail: "user@example.com",
    refreshToken: "rt-1",
    accessToken: "at-cached",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    scopes: ["openid", "https://www.googleapis.com/auth/calendar"],
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Minimal fake store. `getActiveAccessToken` only consumes
 *  `listForUser` + `upsert`; the rest can throw on accidental use. */
function fakeStore(rows: Connection[]): ConnectionsStore {
  return {
    listForUser: jest.fn().mockResolvedValue(rows),
    upsert: jest.fn(),
    findByKey: jest.fn(),
    getById: jest.fn(),
    markRevoked: jest.fn(),
    hardDeleteForUser: jest.fn(),
  } as unknown as ConnectionsStore;
}

function supabaseReq(): Request {
  return {
    authSource: "supabase",
    userId: "user-1",
    userEmail: "user@example.com",
  } as unknown as Request;
}

describe("Calendar destination routing", () => {
  describe("explicit `?provider=` preference", () => {
    it("provider=google returns a GoogleCalendarConnector when the google row exists", async () => {
      const store = fakeStore([
        makeConnection({ provider: "google", capability: "calendar", id: "g-cal" }),
        makeConnection({ provider: "microsoft", capability: "calendar", id: "m-cal" }),
      ]);
      const resolvers = createConnectorResolvers({ connectionsStore: store });

      const resolved = await resolvers.resolveCalendarConnector(supabaseReq(), "google");

      expect(resolved).not.toBeNull();
      expect(resolved!.connector).toBeInstanceOf(GoogleCalendarConnector);
      expect(resolved!.provider).toBe("google");
    });

    it("provider=microsoft returns a MicrosoftCalendarConnector when the microsoft row exists", async () => {
      const store = fakeStore([
        makeConnection({ provider: "google", capability: "calendar", id: "g-cal" }),
        makeConnection({ provider: "microsoft", capability: "calendar", id: "m-cal" }),
      ]);
      const resolvers = createConnectorResolvers({ connectionsStore: store });

      const resolved = await resolvers.resolveCalendarConnector(supabaseReq(), "microsoft");

      expect(resolved).not.toBeNull();
      expect(resolved!.connector).toBeInstanceOf(MicrosoftCalendarConnector);
      expect(resolved!.provider).toBe("microsoft");
    });

    it("provider=microsoft returns null when only google is connected (no silent fallback)", async () => {
      // PR #330's no-silent-fallback rule: the picker only surfaces
      // providers the user has a calendar row for, so a no-row outcome
      // is genuinely "not connected" rather than "try the other one".
      const store = fakeStore([
        makeConnection({ provider: "google", capability: "calendar", id: "g-cal" }),
      ]);
      const resolvers = createConnectorResolvers({ connectionsStore: store });

      const resolved = await resolvers.resolveCalendarConnector(supabaseReq(), "microsoft");

      expect(resolved).toBeNull();
    });

    it("provider=google returns null when only microsoft is connected (no silent fallback)", async () => {
      const store = fakeStore([
        makeConnection({ provider: "microsoft", capability: "calendar", id: "m-cal" }),
      ]);
      const resolvers = createConnectorResolvers({ connectionsStore: store });

      const resolved = await resolvers.resolveCalendarConnector(supabaseReq(), "google");

      expect(resolved).toBeNull();
    });
  });

  describe("auto-pick (no preference)", () => {
    it("auto-picks Microsoft when both providers are connected", async () => {
      const store = fakeStore([
        makeConnection({ provider: "google", capability: "calendar", id: "g-cal" }),
        makeConnection({ provider: "microsoft", capability: "calendar", id: "m-cal" }),
      ]);
      const resolvers = createConnectorResolvers({ connectionsStore: store });

      const resolved = await resolvers.resolveCalendarConnector(supabaseReq());

      expect(resolved).not.toBeNull();
      expect(resolved!.provider).toBe("microsoft");
    });

    it("falls back to Google when Microsoft is not connected", async () => {
      const store = fakeStore([
        makeConnection({ provider: "google", capability: "calendar", id: "g-cal" }),
      ]);
      const resolvers = createConnectorResolvers({ connectionsStore: store });

      const resolved = await resolvers.resolveCalendarConnector(supabaseReq());

      expect(resolved).not.toBeNull();
      expect(resolved!.provider).toBe("google");
    });

    it("returns null when neither provider is connected", async () => {
      const store = fakeStore([]);
      const resolvers = createConnectorResolvers({ connectionsStore: store });

      const resolved = await resolvers.resolveCalendarConnector(supabaseReq());

      expect(resolved).toBeNull();
    });
  });

  describe("ignores irrelevant rows", () => {
    it("does not pick an `identity` row even when its provider matches the preference", async () => {
      const store = fakeStore([
        makeConnection({ provider: "google", capability: "identity", id: "g-id" }),
      ]);
      const resolvers = createConnectorResolvers({ connectionsStore: store });

      const resolved = await resolvers.resolveCalendarConnector(supabaseReq(), "google");

      // Identity rows don't grant calendar access — the resolver
      // must scope its `listForUser` filter to `capability:"calendar"`.
      expect(resolved).toBeNull();
    });

    it("does not pick an `email` row for a calendar request", async () => {
      const store = fakeStore([
        makeConnection({ provider: "google", capability: "email", id: "g-em" }),
      ]);
      const resolvers = createConnectorResolvers({ connectionsStore: store });

      const resolved = await resolvers.resolveCalendarConnector(supabaseReq(), "google");

      expect(resolved).toBeNull();
    });
  });
});

describe("Email destination routing", () => {
  // Mirror of the calendar suite to lock the same routing rule
  // for the `/emails/scan?provider=` and `/emails/labels?provider=`
  // routes. Same fixture pattern; same no-silent-fallback guarantee.
  describe("explicit `?provider=` preference", () => {
    it("provider=google returns a GoogleEmailConnector when the google row exists", async () => {
      const store = fakeStore([
        makeConnection({ provider: "google", capability: "email", id: "g-em" }),
        makeConnection({ provider: "microsoft", capability: "email", id: "m-em" }),
      ]);
      const resolvers = createConnectorResolvers({ connectionsStore: store });

      const resolved = await resolvers.resolveEmailConnector(supabaseReq(), "google");

      expect(resolved).not.toBeNull();
      expect(resolved!.connector).toBeInstanceOf(GoogleEmailConnector);
      expect(resolved!.provider).toBe("google");
    });

    it("provider=microsoft returns a MicrosoftEmailConnector when the microsoft row exists", async () => {
      const store = fakeStore([
        makeConnection({ provider: "google", capability: "email", id: "g-em" }),
        makeConnection({ provider: "microsoft", capability: "email", id: "m-em" }),
      ]);
      const resolvers = createConnectorResolvers({ connectionsStore: store });

      const resolved = await resolvers.resolveEmailConnector(supabaseReq(), "microsoft");

      expect(resolved).not.toBeNull();
      expect(resolved!.connector).toBeInstanceOf(MicrosoftEmailConnector);
      expect(resolved!.provider).toBe("microsoft");
    });

    it("returns null when the preferred provider isn't connected (no silent fallback)", async () => {
      const store = fakeStore([
        makeConnection({ provider: "google", capability: "email", id: "g-em" }),
      ]);
      const resolvers = createConnectorResolvers({ connectionsStore: store });

      const resolved = await resolvers.resolveEmailConnector(supabaseReq(), "microsoft");

      expect(resolved).toBeNull();
    });
  });

  describe("auto-pick (no preference)", () => {
    it("auto-picks Microsoft when both providers are connected", async () => {
      const store = fakeStore([
        makeConnection({ provider: "google", capability: "email", id: "g-em" }),
        makeConnection({ provider: "microsoft", capability: "email", id: "m-em" }),
      ]);
      const resolvers = createConnectorResolvers({ connectionsStore: store });

      const resolved = await resolvers.resolveEmailConnector(supabaseReq());

      expect(resolved).not.toBeNull();
      expect(resolved!.provider).toBe("microsoft");
    });
  });
});
