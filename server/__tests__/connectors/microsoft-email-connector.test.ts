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

  /**
   * Queues fetch mocks for a top-level folder listing plus one
   * empty-`childFolders` response per top-level folder. The connector's
   * `listAllFolders` recursively walks `childFolders` so every test
   * that exercises folder enumeration needs to satisfy the per-folder
   * calls even when no nesting is intentionally exercised.
   */
  const mockTopLevelFoldersWithNoChildren = (
    folders: Array<{ id: string; displayName: string }>,
  ): void => {
    fetchMock.mockResolvedValueOnce(makeJsonResponse(200, { value: folders }));
    for (const _ of folders) {
      fetchMock.mockResolvedValueOnce(makeJsonResponse(200, { value: [] }));
    }
  };

  /**
   * Queues the two-call chain `listInboxTreeIds` makes for a mailbox
   * whose Inbox has no nested folders:
   *  1. `GET /me/mailFolders/inbox` → returns the inbox folder ID.
   *  2. `GET /me/mailFolders/{inboxId}/childFolders` → returns [].
   * Used for default-scan tests where the test isn't trying to
   * exercise nested folders.
   */
  const mockInboxTreeNoChildren = (inboxId = "inbox-id"): void => {
    fetchMock.mockResolvedValueOnce(
      makeJsonResponse(200, { id: inboxId, displayName: "Inbox" }),
    );
    fetchMock.mockResolvedValueOnce(makeJsonResponse(200, { value: [] }));
  };

  describe("listLabels", () => {
    it("returns all folders as type=user (Graph mailFolder lacks wellKnownName)", async () => {
      // Graph's mailFolder resource doesn't expose a wellKnownName
      // property — querying with $select=wellKnownName 400s with
      // 'Could not find a property named wellKnownName'. So the
      // connector lists folders without that field and classifies
      // them all as "user." The well-known folders (Inbox, Drafts,
      // ...) still appear in the picker by their localised display
      // names; the user just doesn't see a "system" badge on them.
      mockTopLevelFoldersWithNoChildren([
        { id: "inbox-id", displayName: "Inbox" },
        { id: "drafts-id", displayName: "Drafts" },
        { id: "travel-id", displayName: "Travel" },
        { id: "trips-id", displayName: "Trips" },
      ]);

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

    it("walks childFolders so nested folders appear in the listing", async () => {
      // The user's "Travel" folder under Inbox was invisible to the
      // picker before — Graph's /me/mailFolders only returns the
      // root level. Now we walk childFolders breadth-first so
      // nested folders surface with their full path as the display
      // name ("Inbox/Travel"), keeping leaves under different
      // parents distinguishable.
      fetchMock
        // Top-level mailFolders listing.
        .mockResolvedValueOnce(
          makeJsonResponse(200, {
            value: [
              { id: "inbox-id", displayName: "Inbox" },
              { id: "archive-id", displayName: "Archive" },
            ],
          }),
        )
        // childFolders(inbox-id) — Inbox has a nested Travel.
        .mockResolvedValueOnce(
          makeJsonResponse(200, {
            value: [{ id: "inbox-travel-id", displayName: "Travel" }],
          }),
        )
        // childFolders(archive-id) — none.
        .mockResolvedValueOnce(makeJsonResponse(200, { value: [] }))
        // childFolders(inbox-travel-id) — leaf, no kids.
        .mockResolvedValueOnce(makeJsonResponse(200, { value: [] }));

      const conn = new MicrosoftEmailConnector(ACCESS_TOKEN);
      const labels = await conn.listLabels();

      expect(labels).toEqual([
        { id: "inbox-id", name: "Inbox", type: "user" },
        { id: "archive-id", name: "Archive", type: "user" },
        { id: "inbox-travel-id", name: "Inbox/Travel", type: "user" },
      ]);
    });

    it("keeps listing even when one childFolders call fails", async () => {
      // One bad subtree shouldn't blank out the entire picker — the
      // connector swallows childFolders errors and continues. Useful
      // because Graph occasionally 5xx's on rarely-accessed folders
      // (Recoverable Items, etc.) and a flaky failure shouldn't
      // prevent the user from scanning their actual inbox.
      fetchMock
        .mockResolvedValueOnce(
          makeJsonResponse(200, {
            value: [
              { id: "inbox-id", displayName: "Inbox" },
              { id: "junk-id", displayName: "Junk" },
            ],
          }),
        )
        .mockResolvedValueOnce(makeJsonResponse(200, { value: [] }))
        .mockResolvedValueOnce(makeJsonResponse(500, { error: "transient" }));

      const conn = new MicrosoftEmailConnector(ACCESS_TOKEN);
      const labels = await conn.listLabels();

      expect(labels.map((l) => l.name)).toEqual(["Inbox", "Junk"]);
    });
  });

  describe("scanEmails", () => {
    it("scans the inbox tree and maps each result", async () => {
      // Default scan (no labelFilter) → listInboxTreeIds resolves the
      // inbox + walks childFolders, then we fetch /messages from each
      // folder in the tree. Inbox-with-no-subfolders case: 3 mocks
      // (inbox resolve, empty childFolders, messages).
      mockInboxTreeNoChildren("inbox-id");
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

      // The final /messages call is the third request (after inbox
      // resolve + childFolders). It carries the orderby/top defaults
      // and is scoped to the inbox folder ID.
      const lastUrl =
        fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0].toString();
      expect(lastUrl).toContain("/me/mailFolders/inbox-id/messages");
      expect(lastUrl).toContain("%24orderby=receivedDateTime+desc");
      expect(lastUrl).toContain("%24top=100");
      expect(lastUrl).not.toContain("%24filter");
    });

    it("merges messages across the inbox tree and trims to maxResults", async () => {
      // The whole point of the inbox-tree scan: a "Travel" folder
      // filed *under* Inbox was being missed before because we hit
      // `/me/mailFolders/inbox/messages` which isn't recursive. Now
      // the connector fetches messages from each folder in the tree
      // and merges + sorts + trims so newer messages from nested
      // folders interleave with older ones from the parent.
      fetchMock
        // Step 1: resolve inbox folder ID.
        .mockResolvedValueOnce(
          makeJsonResponse(200, { id: "inbox-id", displayName: "Inbox" }),
        )
        // Step 2: childFolders(inbox) — one nested "Travel" folder.
        .mockResolvedValueOnce(
          makeJsonResponse(200, {
            value: [{ id: "travel-id", displayName: "Travel" }],
          }),
        )
        // Step 3: childFolders(travel) — leaf.
        .mockResolvedValueOnce(makeJsonResponse(200, { value: [] }))
        // Step 4 + 5: per-folder messages calls (parallel). Order of
        // resolution doesn't matter since the connector merges + sorts.
        .mockResolvedValueOnce(
          makeJsonResponse(200, {
            value: [
              {
                id: "inbox-msg",
                subject: "Older inbox message",
                bodyPreview: "in inbox",
                from: { emailAddress: { address: "a@example.com" } },
                receivedDateTime: "2026-06-10T08:00:00Z",
              },
            ],
          }),
        )
        .mockResolvedValueOnce(
          makeJsonResponse(200, {
            value: [
              {
                id: "travel-msg",
                subject: "Newer travel confirmation",
                bodyPreview: "in travel folder",
                from: { emailAddress: { address: "b@example.com" } },
                receivedDateTime: "2026-06-12T08:00:00Z",
              },
            ],
          }),
        );

      const conn = new MicrosoftEmailConnector(ACCESS_TOKEN);
      const emails = await conn.scanEmails();

      // Both messages surface, sorted newest first.
      expect(emails).toHaveLength(2);
      expect(emails[0].id).toBe("travel-msg");
      expect(emails[1].id).toBe("inbox-msg");
    });

    it("translates HTML bodies through htmlToText", async () => {
      mockInboxTreeNoChildren("inbox-id");
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
      mockInboxTreeNoChildren("inbox-id");
      fetchMock.mockResolvedValueOnce(
        makeJsonResponse(200, { value: [] }),
      );

      const conn = new MicrosoftEmailConnector(ACCESS_TOKEN);
      await conn.scanEmails({ newerThanDays: 7 });

      const lastUrl =
        fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0].toString();
      // URLSearchParams encodes `$filter`'s value:
      //   ge → ge (intact)
      //   ISO date colons → %3A
      // We just check the directive is present + the comparison op shows up.
      expect(lastUrl).toContain("%24filter=receivedDateTime+ge+");
    });

    it("expands labelFilter='Inbox' to the inbox tree (not just the inbox folder)", async () => {
      // labelFilter='Inbox' resolves to the well-known 'inbox' name,
      // which we then expand into Inbox + descendants — same as the
      // default no-filter scan. Three Graph chains in sequence:
      //  1. listAllFolders to resolve the labelFilter
      //  2. listInboxTreeIds (inbox + descendants — only inbox here)
      //  3. per-folder messages fetch
      mockTopLevelFoldersWithNoChildren([
        { id: "inbox-id", displayName: "Inbox" },
        { id: "travel-id", displayName: "Travel" },
      ]);
      mockInboxTreeNoChildren("inbox-id");
      fetchMock.mockResolvedValueOnce(
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

      const lastUrl = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0].toString();
      expect(lastUrl).toContain("/me/mailFolders/inbox-id/messages");
    });

    it("scans inside a user folder by display name", async () => {
      mockTopLevelFoldersWithNoChildren([
        { id: "inbox-id", displayName: "Inbox" },
        { id: "travel-id-abc", displayName: "Travel" },
      ]);
      fetchMock.mockResolvedValueOnce(makeJsonResponse(200, { value: [] }));

      const conn = new MicrosoftEmailConnector(ACCESS_TOKEN);
      await conn.scanEmails({ labelFilter: "Travel" });
      const lastUrl = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0].toString();
      expect(lastUrl).toContain("/me/mailFolders/travel-id-abc/messages");
    });

    it("scans inside a nested folder when labelFilter matches a path leaf", async () => {
      // Bug fix: user's "Travel" lived under "Inbox" — resolveFolderId
      // suffix-matches "/travel" against the flattened "Inbox/Travel"
      // display name so passing just "Travel" still routes to the
      // right folder ID.
      fetchMock
        .mockResolvedValueOnce(
          makeJsonResponse(200, {
            value: [{ id: "inbox-id", displayName: "Inbox" }],
          }),
        )
        // childFolders(inbox-id) — the nested Travel folder.
        .mockResolvedValueOnce(
          makeJsonResponse(200, {
            value: [{ id: "nested-travel-id", displayName: "Travel" }],
          }),
        )
        // childFolders(nested-travel-id) — leaf.
        .mockResolvedValueOnce(makeJsonResponse(200, { value: [] }))
        // The messages call we expect.
        .mockResolvedValueOnce(makeJsonResponse(200, { value: [] }));

      const conn = new MicrosoftEmailConnector(ACCESS_TOKEN);
      await conn.scanEmails({ labelFilter: "Travel" });
      const lastUrl = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0].toString();
      expect(lastUrl).toContain("/me/mailFolders/nested-travel-id/messages");
    });

    it("falls back to inbox tree when the labelFilter doesn't match anything", async () => {
      // listAllFolders → resolveFolderId returns null → fall through to
      // listInboxTreeIds (same path as default scan).
      mockTopLevelFoldersWithNoChildren([
        { id: "inbox-id", displayName: "Inbox" },
      ]);
      mockInboxTreeNoChildren("inbox-id");
      fetchMock.mockResolvedValueOnce(makeJsonResponse(200, { value: [] }));

      const conn = new MicrosoftEmailConnector(ACCESS_TOKEN);
      await conn.scanEmails({ labelFilter: "Nope" });
      const lastUrl = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0].toString();
      expect(lastUrl).toContain("/me/mailFolders/inbox-id/messages");
    });

    it("handles missing from gracefully", async () => {
      mockInboxTreeNoChildren("inbox-id");
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
