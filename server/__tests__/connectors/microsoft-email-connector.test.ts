/**
 * Tests for `MicrosoftEmailConnector`. Uses a mocked `global.fetch`
 * so the suite never hits real Microsoft Graph endpoints.
 *
 * Coverage:
 *  - `listLabels` maps Outlook folders → EmailLabel[] with the
 *    well-known-name → "system" / user-created → "user" rule.
 *  - `scanEmails` builds the right Graph URL for default + label-
 *    filtered queries, applies the `newerThanDays` filter, and
 *    translates Graph message shape to `RawEmail`.
 *  - HTML body content gets passed through `htmlToText`.
 *  - `from` formatting handles name + email, email-only, and
 *    missing-from cases.
 */

import { MicrosoftEmailConnector } from "../../src/connectors/microsoft-email-connector";

type FetchMock = jest.Mock<Promise<Response>, [string | URL, RequestInit?]>;

function makeJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ACCESS_TOKEN = "ms-graph-mail-token";

describe("MicrosoftEmailConnector", () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = jest.fn() as FetchMock;
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  describe("listLabels", () => {
    it("returns all folders as type=user (Graph mailFolder lacks wellKnownName)", async () => {
      // Graph's mailFolder resource doesn't expose a wellKnownName
      // property — querying with $select=wellKnownName 400s with
      // 'Could not find a property named wellKnownName'. So the
      // connector lists folders without that field and classifies
      // them all as "user." The well-known folders (Inbox, Drafts,
      // ...) still appear in the picker by their localised display
      // names; the user just doesn't see a "system" badge on them.
      fetchMock.mockResolvedValueOnce(
        makeJsonResponse(200, {
          value: [
            { id: "inbox-id", displayName: "Inbox" },
            { id: "drafts-id", displayName: "Drafts" },
            { id: "travel-id", displayName: "Travel" },
            { id: "trips-id", displayName: "Trips" },
          ],
        }),
      );

      const conn = new MicrosoftEmailConnector(ACCESS_TOKEN);
      const labels = await conn.listLabels();

      expect(labels).toEqual([
        { id: "inbox-id", name: "Inbox", type: "user" },
        { id: "drafts-id", name: "Drafts", type: "user" },
        { id: "travel-id", name: "Travel", type: "user" },
        { id: "trips-id", name: "Trips", type: "user" },
      ]);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url.toString()).toContain("/me/mailFolders");
      expect(init?.headers).toMatchObject({
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      });
    });
  });

  describe("scanEmails", () => {
    it("queries /me/messages with $orderby + $top defaults and maps the result", async () => {
      fetchMock.mockResolvedValueOnce(
        makeJsonResponse(200, {
          value: [
            {
              id: "msg-1",
              subject: "Confirmation",
              body: { contentType: "text", content: "Your booking is confirmed." },
              from: { emailAddress: { name: "Airline", address: "noreply@air.com" } },
              receivedDateTime: "2026-06-10T08:00:00Z",
              conversationId: "thread-1",
            },
          ],
        }),
      );

      const conn = new MicrosoftEmailConnector(ACCESS_TOKEN);
      const emails = await conn.scanEmails();

      expect(emails).toHaveLength(1);
      expect(emails[0]).toEqual({
        id: "msg-1",
        threadId: "thread-1",
        subject: "Confirmation",
        from: "Airline <noreply@air.com>",
        receivedAt: "2026-06-10T08:00:00Z",
        bodyText: "Your booking is confirmed.",
      });

      const [url] = fetchMock.mock.calls[0];
      const str = url.toString();
      expect(str).toContain("/me/mailFolders/inbox/messages");
      expect(str).toContain("%24orderby=receivedDateTime+desc");
      expect(str).toContain("%24top=100");
      expect(str).not.toContain("%24filter");
    });

    it("translates HTML bodies through htmlToText", async () => {
      fetchMock.mockResolvedValueOnce(
        makeJsonResponse(200, {
          value: [
            {
              id: "msg-html",
              subject: "Hotel booking",
              body: {
                contentType: "html",
                content: "<p>Welcome <b>Alice</b>!</p><p>Your stay is confirmed.</p>",
              },
              from: { emailAddress: { address: "hotel@example.com" } },
              receivedDateTime: "2026-06-10T08:00:00Z",
              conversationId: "thread-x",
            },
          ],
        }),
      );

      const conn = new MicrosoftEmailConnector(ACCESS_TOKEN);
      const emails = await conn.scanEmails();
      // htmlToText keeps the text, drops tags. Don't assert exact
      // whitespace — the converter formats paragraphs with blank
      // lines that are easy to misalign.
      expect(emails[0].bodyText).toContain("Welcome Alice!");
      expect(emails[0].bodyText).toContain("Your stay is confirmed.");
      expect(emails[0].from).toBe("hotel@example.com");
    });

    it("applies the newerThanDays filter as $filter receivedDateTime ge ...", async () => {
      fetchMock.mockResolvedValueOnce(
        makeJsonResponse(200, { value: [] }),
      );

      const conn = new MicrosoftEmailConnector(ACCESS_TOKEN);
      await conn.scanEmails({ newerThanDays: 7 });

      const [url] = fetchMock.mock.calls[0];
      const str = url.toString();
      // URLSearchParams encodes `$filter`'s value:
      //   ge → ge (intact)
      //   ISO date colons → %3A
      // We just check the directive is present + the comparison op shows up.
      expect(str).toContain("%24filter=receivedDateTime+ge+");
    });

    it("scans inside a specific folder when labelFilter matches a well-known folder", async () => {
      fetchMock
        // First call: list folders to resolve the labelFilter.
        .mockResolvedValueOnce(
          makeJsonResponse(200, {
            value: [
              { id: "inbox-id", displayName: "Inbox", wellKnownName: "inbox" },
              { id: "travel-id", displayName: "Travel" },
            ],
          }),
        )
        // Second call: the actual messages endpoint scoped to inbox.
        .mockResolvedValueOnce(
          makeJsonResponse(200, {
            value: [
              {
                id: "msg-in",
                subject: "Inbox msg",
                bodyPreview: "Preview text",
                from: { emailAddress: { address: "x@example.com" } },
                receivedDateTime: "2026-06-10T08:00:00Z",
              },
            ],
          }),
        );

      const conn = new MicrosoftEmailConnector(ACCESS_TOKEN);
      const emails = await conn.scanEmails({ labelFilter: "Inbox" });
      expect(emails).toHaveLength(1);
      expect(emails[0].id).toBe("msg-in");

      const secondUrl = fetchMock.mock.calls[1][0].toString();
      expect(secondUrl).toContain("/me/mailFolders/inbox/messages");
    });

    it("scans inside a user folder by display name", async () => {
      fetchMock
        .mockResolvedValueOnce(
          makeJsonResponse(200, {
            value: [
              { id: "inbox-id", displayName: "Inbox", wellKnownName: "inbox" },
              { id: "travel-id-abc", displayName: "Travel" },
            ],
          }),
        )
        .mockResolvedValueOnce(makeJsonResponse(200, { value: [] }));

      const conn = new MicrosoftEmailConnector(ACCESS_TOKEN);
      await conn.scanEmails({ labelFilter: "Travel" });
      const secondUrl = fetchMock.mock.calls[1][0].toString();
      expect(secondUrl).toContain("/me/mailFolders/travel-id-abc/messages");
    });

    it("falls back to inbox when the labelFilter doesn't match anything", async () => {
      fetchMock
        .mockResolvedValueOnce(
          makeJsonResponse(200, {
            value: [{ id: "inbox-id", displayName: "Inbox", wellKnownName: "inbox" }],
          }),
        )
        .mockResolvedValueOnce(makeJsonResponse(200, { value: [] }));

      const conn = new MicrosoftEmailConnector(ACCESS_TOKEN);
      await conn.scanEmails({ labelFilter: "Nope" });
      const secondUrl = fetchMock.mock.calls[1][0].toString();
      expect(secondUrl).toContain("/me/mailFolders/inbox/messages");
    });

    it("handles missing from gracefully", async () => {
      fetchMock.mockResolvedValueOnce(
        makeJsonResponse(200, {
          value: [
            {
              id: "msg-nofrom",
              subject: "(no sender)",
              bodyPreview: "Just a preview",
              receivedDateTime: "2026-06-10T08:00:00Z",
            },
          ],
        }),
      );

      const conn = new MicrosoftEmailConnector(ACCESS_TOKEN);
      const emails = await conn.scanEmails();
      expect(emails[0].from).toBe("");
      expect(emails[0].bodyText).toBe("Just a preview");
      expect(emails[0].threadId).toBe("msg-nofrom"); // falls back to id
    });
  });
});
