/**
 * Runs the shared `EmailConnector` contract scenarios against
 * `GoogleEmailConnector`. The connector is a thin wrapper over
 * `GmailScanner`; we mock the class so every `new` returns shared
 * `mock*` jest fns the harness drives directly.
 *
 * Detailed wire-level behaviour (label-id resolution, Gmail API
 * pagination, MIME body extraction) stays covered by
 * `gmail-scanner.test.ts` and the route-level tests — this file
 * only enforces the cross-impl contract.
 */

import { GmailScanner } from "../../src/services/gmail-scanner";
import { GoogleEmailConnector } from "../../src/connectors/google-email-connector";
import type { EmailLabel } from "../../src/connectors/email-connector";
import type { RawEmail } from "../../src/services/gmail-scanner";
import {
  runEmailConnectorContractTests,
  type EmailConnectorTestHarness,
} from "./contract/email-connector-contract";

// Jest's `jest.mock` factory only allows references to variables
// whose name starts with `mock`. Holding the method stubs at module
// scope means every `new GmailScanner(...)` returns objects backed
// by the SAME jest.fns — the harness resets and queues responses
// against them directly, no `mock.instances` indexing required.
const mockListLabels = jest.fn();
const mockScanEmails = jest.fn();

jest.mock("../../src/services/gmail-scanner", () => {
  const actual = jest.requireActual("../../src/services/gmail-scanner");
  return {
    ...actual,
    GmailScanner: jest.fn().mockImplementation(() => ({
      listLabels: mockListLabels,
      scanEmails: mockScanEmails,
    })),
  };
});

function makeHarness(): EmailConnectorTestHarness {
  // Fresh queue per test — `mockReset` clears both implementation
  // and queued return values.
  mockListLabels.mockReset();
  mockScanEmails.mockReset();
  (GmailScanner as unknown as jest.Mock).mockClear();

  return {
    connector: new GoogleEmailConnector("gmail-token"),
    stubLabels(labels: EmailLabel[]) {
      // `GoogleEmailConnector.listLabels` maps the scanner's raw
      // shape (`{ id, name, type: string }[]`) to `EmailLabel[]`,
      // coercing any non-"system" `type` to `"user"`. Passing the
      // canned labels straight through preserves that mapping.
      mockListLabels.mockResolvedValueOnce(
        labels.map((l) => ({ id: l.id, name: l.name, type: l.type })),
      );
    },
    stubScan(emails: RawEmail[]) {
      mockScanEmails.mockResolvedValueOnce(emails);
    },
    stubAuthFailure() {
      // Gmail's `googleapis` surfaces auth failures as GaxiosError
      // with `code` = HTTP status. The connector reads `code`
      // first, so mocking the scanner method to reject with a
      // `code: 401` object is the smallest faithful failure shape.
      // Queue on BOTH methods so the contract's listLabels AND
      // scanEmails scenarios each find their stubbed rejection.
      const gaxiosLike = Object.assign(new Error("Invalid Credentials"), {
        code: 401,
      });
      mockListLabels.mockRejectedValueOnce(gaxiosLike);
      mockScanEmails.mockRejectedValueOnce(gaxiosLike);
    },
  };
}

runEmailConnectorContractTests("GoogleEmailConnector", makeHarness);
