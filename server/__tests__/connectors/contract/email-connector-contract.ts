/**
 * Shared contract test suite for `EmailConnector` implementations.
 * Phase 4 of the migration plan: every concrete connector
 * (Gmail, Outlook, future) must pass these scenarios so a Gmail-only
 * feature drift gets caught the moment it lands.
 *
 * Scope:
 *  - This file does NOT contain `it(...)` runners outside of the
 *    function it exports — it's imported by per-impl `.contract.test.ts`
 *    files that provide a harness wiring up the implementation's
 *    mocks. The per-impl test calls `runEmailConnectorContractTests`
 *    which then declares `describe(...) { it(...) }` blocks.
 *  - Assertions stay SHAPE-LEVEL (id non-empty, type ∈ {system, user},
 *    etc.) so impls that legitimately diverge — e.g. Microsoft's
 *    `listLabels` marks everything `user` because Graph's mailFolder
 *    resource lacks `wellKnownName` — still pass without us masking
 *    real bugs. Detailed wire-level behaviour stays in each impl's
 *    own test file.
 */

import type { EmailConnector, EmailLabel } from "../../../src/connectors/email-connector";
import type { RawEmail } from "../../../src/services/gmail-scanner";
import { InvalidAuthError } from "../../../src/connectors/errors";

export interface EmailConnectorTestHarness {
  connector: EmailConnector;
  /**
   * Configure the next call to `connector.listLabels()` to resolve
   * with `labels`. Implementation-specific: for Gmail this stubs
   * `GmailScanner.listLabels`; for Outlook it queues a sequence of
   * Graph folder-listing fetch responses.
   */
  stubLabels: (labels: EmailLabel[]) => void;
  /**
   * Configure the next call to `connector.scanEmails(...)` to resolve
   * with `emails`. The options the connector receives are not
   * asserted in the shared contract — that's an impl detail — but
   * the harness should return the canned emails regardless of which
   * options are passed.
   */
  stubScan: (emails: RawEmail[]) => void;
  /**
   * Configure the next provider call (whichever fires first) to fail
   * with an HTTP 401 from the provider, so the contract can verify
   * the connector rethrows it as the provider-agnostic
   * `InvalidAuthError`. Implementations decide how to surface the
   * 401 — Gmail rejects the mocked scanner method with a
   * GaxiosError-shaped object (`{ code: 401 }`); Outlook queues a
   * 401 fetch response.
   */
  stubAuthFailure: () => void;
}

/**
 * Sample `RawEmail` used by contract scenarios that don't care about
 * the body content. Centralised so future scenarios can extend the
 * fixture without touching every per-impl test.
 */
export function sampleRawEmail(overrides: Partial<RawEmail> = {}): RawEmail {
  return {
    id: "msg-1",
    threadId: "thread-1",
    subject: "Your booking is confirmed",
    from: "noreply@airline.com",
    receivedAt: "2026-05-01T12:00:00Z",
    bodyText: "Confirmed",
    ...overrides,
  };
}

export function runEmailConnectorContractTests(
  name: string,
  makeHarness: () => EmailConnectorTestHarness,
): void {
  describe(`EmailConnector contract: ${name}`, () => {
    describe("listLabels", () => {
      it("returns the labels reported by the provider", async () => {
        const harness = makeHarness();
        harness.stubLabels([
          { id: "INBOX", name: "Inbox", type: "system" },
          { id: "label-travel", name: "Travel", type: "user" },
        ]);

        const labels = await harness.connector.listLabels();
        expect(labels.length).toBe(2);
      });

      it("returns labels with the EmailLabel shape (non-empty id+name, valid type)", async () => {
        const harness = makeHarness();
        harness.stubLabels([
          { id: "INBOX", name: "Inbox", type: "system" },
          { id: "label-travel", name: "Travel", type: "user" },
        ]);

        const labels = await harness.connector.listLabels();
        for (const label of labels) {
          expect(typeof label.id).toBe("string");
          expect(label.id.length).toBeGreaterThan(0);
          expect(typeof label.name).toBe("string");
          expect(label.name.length).toBeGreaterThan(0);
          expect(["system", "user"]).toContain(label.type);
        }
      });

      it("returns an empty array when the provider has no labels", async () => {
        const harness = makeHarness();
        harness.stubLabels([]);

        const labels = await harness.connector.listLabels();
        expect(labels).toEqual([]);
      });
    });

    describe("scanEmails", () => {
      it("returns the emails reported by the provider", async () => {
        const harness = makeHarness();
        harness.stubScan([
          sampleRawEmail({ id: "a", subject: "Flight to NRT" }),
          sampleRawEmail({ id: "b", subject: "Hotel reservation" }),
        ]);

        const emails = await harness.connector.scanEmails();
        expect(emails.length).toBe(2);
      });

      it("returns emails with the RawEmail shape (id, threadId, subject, from, receivedAt)", async () => {
        const harness = makeHarness();
        harness.stubScan([sampleRawEmail()]);

        const emails = await harness.connector.scanEmails();
        for (const email of emails) {
          expect(typeof email.id).toBe("string");
          expect(email.id.length).toBeGreaterThan(0);
          expect(typeof email.threadId).toBe("string");
          expect(typeof email.subject).toBe("string");
          expect(typeof email.from).toBe("string");
          expect(typeof email.receivedAt).toBe("string");
          // Body text can be empty for an empty email but the field
          // must be present (typeof string, not undefined).
          expect(typeof email.bodyText).toBe("string");
        }
      });

      it("returns an empty array when the provider returns no matching messages", async () => {
        const harness = makeHarness();
        harness.stubScan([]);

        const emails = await harness.connector.scanEmails();
        expect(emails).toEqual([]);
      });

      it("accepts an EmailScanOptions object without throwing (labelFilter)", async () => {
        const harness = makeHarness();
        harness.stubScan([]);

        await expect(
          harness.connector.scanEmails({ labelFilter: "Travel" }),
        ).resolves.toEqual([]);
      });

      it("accepts an EmailScanOptions object without throwing (maxResults + newerThanDays)", async () => {
        const harness = makeHarness();
        harness.stubScan([]);

        await expect(
          harness.connector.scanEmails({ maxResults: 10, newerThanDays: 30 }),
        ).resolves.toEqual([]);
      });
    });

    describe("auth failure", () => {
      it("listLabels rethrows provider 401 as InvalidAuthError", async () => {
        const harness = makeHarness();
        harness.stubAuthFailure();

        await expect(harness.connector.listLabels()).rejects.toBeInstanceOf(
          InvalidAuthError,
        );
      });

      it("scanEmails rethrows provider 401 as InvalidAuthError", async () => {
        const harness = makeHarness();
        harness.stubAuthFailure();

        await expect(harness.connector.scanEmails()).rejects.toBeInstanceOf(
          InvalidAuthError,
        );
      });

      it("rethrown InvalidAuthError carries the provider's HTTP status", async () => {
        const harness = makeHarness();
        harness.stubAuthFailure();

        try {
          await harness.connector.listLabels();
          throw new Error("expected listLabels to reject");
        } catch (err) {
          expect(err).toBeInstanceOf(InvalidAuthError);
          // Status comes through unchanged so routes can branch on
          // 401 vs 403 if they need to (e.g. emit different telemetry
          // for "token expired" vs "scopes missing").
          const status = (err as InvalidAuthError).status;
          expect([401, 403]).toContain(status);
        }
      });
    });
  });
}
