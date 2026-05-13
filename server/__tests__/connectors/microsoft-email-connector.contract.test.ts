/**
 * Runs the shared `EmailConnector` contract scenarios against
 * `MicrosoftEmailConnector`. Mocks `global.fetch` because the
 * Outlook connector hits Microsoft Graph directly (no SDK to mock).
 *
 * The harness's `stubLabels` and `stubScan` queue the sequence of
 * fetch responses the connector's internal walk needs:
 *  - `listLabels`: a top-level folder listing + one empty
 *    `childFolders` response per top-level entry.
 *  - `scanEmails`: the inbox-folder lookup + empty children + the
 *    messages listing.
 */

import { MicrosoftEmailConnector } from "../../src/connectors/microsoft-email-connector";
import type { EmailLabel } from "../../src/connectors/email-connector";
import type { RawEmail } from "../../src/services/gmail-scanner";
import {
  runEmailConnectorContractTests,
  type EmailConnectorTestHarness,
} from "./contract/email-connector-contract";

type FetchMock = jest.Mock<Promise<Response>, [string | URL, RequestInit?]>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Silence the connector's "Failed to list folders" console.warn that
// fires when a labelFilter contract scenario runs against the basic
// inbox-only stub queue. The contract only asserts the scan resolves
// to `[]` without throwing — the warn is non-fatal noise and per-impl
// option-forwarding lives in `microsoft-email-connector.test.ts`.
beforeAll(() => {
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterAll(() => {
  (console.warn as jest.Mock).mockRestore();
});

function makeHarness(): EmailConnectorTestHarness {
  const fetchMock = jest.fn() as FetchMock;
  global.fetch = fetchMock as unknown as typeof fetch;

  const connector = new MicrosoftEmailConnector("ms-graph-token");

  return {
    connector,
    stubLabels(labels: EmailLabel[]) {
      // 1. Top-level folder listing.
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          value: labels.map((l) => ({
            id: l.id,
            displayName: l.name,
          })),
        }),
      );
      // 2. One empty `childFolders` response per top-level entry —
      //    the connector's BFS walk needs this to terminate.
      for (let i = 0; i < labels.length; i += 1) {
        fetchMock.mockResolvedValueOnce(jsonResponse({ value: [] }));
      }
    },
    stubScan(emails: RawEmail[]) {
      // 1. Inbox folder lookup (well-known name → folder id).
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ id: "inbox-folder-id", displayName: "Inbox" }),
      );
      // 2. Inbox children (empty so the BFS terminates).
      fetchMock.mockResolvedValueOnce(jsonResponse({ value: [] }));
      // 3. Messages listing with the canned emails shaped into the
      //    Graph response format the connector parses.
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          value: emails.map((e) => ({
            id: e.id,
            conversationId: e.threadId,
            subject: e.subject,
            from: { emailAddress: { name: "", address: e.from } },
            receivedDateTime: e.receivedAt,
            body: { contentType: "text", content: e.bodyText },
          })),
        }),
      );
    },
  };
}

runEmailConnectorContractTests("MicrosoftEmailConnector", makeHarness);
