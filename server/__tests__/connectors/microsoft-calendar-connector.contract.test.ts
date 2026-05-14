/**
 * Runs the shared `CalendarConnector` contract scenarios against
 * `MicrosoftCalendarConnector`. Mocks `global.fetch` because the
 * Outlook calendar connector hits Microsoft Graph directly.
 *
 * For the trip-shaped scenarios (`syncTrip` / `unsyncTrip`) the
 * contract uses a zero-days trip, so the connector makes ZERO fetch
 * calls — no stubbing needed. Only `listCalendars` queues a fetch
 * response.
 */

import { MicrosoftCalendarConnector } from "../../src/connectors/microsoft-calendar-connector";
import type { CalendarEntry } from "../../src/connectors/calendar-connector";
import {
  runCalendarConnectorContractTests,
  type CalendarConnectorTestHarness,
} from "./contract/calendar-connector-contract";

type FetchMock = jest.Mock<Promise<Response>, [string | URL, RequestInit?]>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Silence the connector's chatty "Done: N created…" log per sync/unsync
// call — the contract scenarios don't care about the messages, and
// per-impl log-shape testing belongs in `microsoft-calendar-connector.test.ts`.
beforeAll(() => {
  jest.spyOn(console, "log").mockImplementation(() => undefined);
});
afterAll(() => {
  (console.log as jest.Mock).mockRestore();
});

function makeHarness(): CalendarConnectorTestHarness {
  const fetchMock = jest.fn() as FetchMock;
  global.fetch = fetchMock as unknown as typeof fetch;

  return {
    connector: new MicrosoftCalendarConnector("ms-graph-cal-token"),
    stubCalendars(entries: CalendarEntry[]) {
      // GET /me/calendars — Graph's response shape is `{ value: [...] }`.
      // The connector maps `isDefaultCalendar` → `primary` and
      // `name` → `summary`.
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          value: entries.map((e) => ({
            id: e.id,
            name: e.summary,
            isDefaultCalendar: e.primary,
          })),
        }),
      );
    },
  };
}

runCalendarConnectorContractTests("MicrosoftCalendarConnector", makeHarness);
