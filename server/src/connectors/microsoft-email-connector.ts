/**
 * Microsoft Graph implementation of `EmailConnector`. Phase 4b-1b
 * of the migration.
 *
 * Maps Outlook's folder + message model onto our provider-agnostic
 * `EmailLabel` / `RawEmail` shapes:
 *  - Outlook **mail folders** map to Gmail-style labels. The
 *    well-known folders (Inbox, Drafts, Sent, etc.) are reported
 *    with `type: "system"`; user-created folders are `type: "user"`.
 *  - Outlook **messages** map to `RawEmail` after dropping HTML
 *    formatting (`htmlToText` from the Gmail scanner — same library,
 *    same behaviour, so segments parsed from Outlook mail look
 *    identical to those from Gmail downstream).
 *
 * Not used by route handlers yet — Phase 4b-2 will teach the
 * resolver to pick this when a user has `provider=microsoft,
 * capability=email` in `connections`.
 */

import { htmlToText } from "../services/gmail-scanner";
import { graphPaginate, graphRequest } from "../services/microsoft-graph";
import type {
  EmailConnector,
  EmailLabel,
  EmailScanOptions,
} from "./email-connector";
import type { RawEmail } from "../services/gmail-scanner";

interface MsMailFolder {
  id: string;
  displayName: string;
}

/**
 * Microsoft Graph's well-known mail-folder shortcut names. When the
 * user passes one of these as a `labelFilter`, we route directly to
 * `/me/mailFolders/<name>/messages` — Graph accepts these as URL
 * path segments. For other folders, we look up the user-created
 * folder by displayName.
 *
 * Microsoft Graph's `mailFolder` resource does NOT expose a
 * `wellKnownName` property (despite what the docs / earlier beta
 * APIs suggested), so we can't distinguish system vs user folders
 * from a `/me/mailFolders` listing alone. Hard-coded list is
 * accurate enough — these names don't change.
 */
const MS_WELL_KNOWN_FOLDER_NAMES = new Set([
  "inbox",
  "drafts",
  "sentitems",
  "deleteditems",
  "outbox",
  "junkemail",
  "archive",
  "scheduled",
  "msgfolderroot",
  "searchfolders",
  "conversationhistory",
  "recoverableitemsdeletions",
]);

interface MsMessageBody {
  contentType: "text" | "html";
  content: string;
}

interface MsMessage {
  id: string;
  subject?: string;
  bodyPreview?: string;
  body?: MsMessageBody;
  from?: {
    emailAddress?: {
      name?: string;
      address?: string;
    };
  };
  receivedDateTime?: string;
  conversationId?: string;
}

/**
 * Builds an RFC-822-ish `From` string from the Graph message envelope:
 * `Name <email@example.com>`. Falls back to just the email when no
 * name is set; empty string when even the email is missing.
 */
function formatFrom(message: MsMessage): string {
  const addr = message.from?.emailAddress;
  const address = addr?.address ?? "";
  const name = addr?.name ?? "";
  if (name && address) return `${name} <${address}>`;
  if (address) return address;
  return name;
}

/**
 * Extracts a text body from the Graph message. Outlook serves message
 * bodies in either `text` or `html` form — we run HTML through the
 * same `htmlToText` converter the Gmail scanner uses so downstream
 * parsers see consistently shaped text regardless of provider.
 */
function extractBody(message: MsMessage): string {
  const body = message.body;
  if (!body?.content) {
    return message.bodyPreview ?? "";
  }
  if (body.contentType === "text") {
    return body.content;
  }
  return htmlToText(body.content);
}

function messageToRawEmail(message: MsMessage): RawEmail {
  return {
    id: message.id,
    threadId: message.conversationId ?? message.id,
    subject: message.subject ?? "",
    from: formatFrom(message),
    receivedAt: message.receivedDateTime ?? "",
    bodyText: extractBody(message),
  };
}

/**
 * The fields we ask Graph to return on every `/me/messages` call.
 * Keeping `$select` tight cuts response size meaningfully — Graph's
 * default response includes a lot of mailbox-specific metadata we
 * don't care about (categories, importance, internetMessageHeaders…)
 * and the cumulative weight blows scan latency budgets quickly.
 */
const MESSAGE_SELECT_FIELDS = [
  "id",
  "subject",
  "bodyPreview",
  "body",
  "from",
  "receivedDateTime",
  "conversationId",
].join(",");

/**
 * Looks up a folder ID by name OR returns the input unchanged if it
 * already looks like a Graph folder ID. Mirrors `resolveLabelId` from
 * the Gmail scanner.
 *
 * Outlook well-known folder names (`inbox`, `drafts`, `sentitems`,
 * etc., case-insensitive) are accepted in addition to user-created
 * folder display names.
 */
function resolveFolderId(
  filter: string,
  folders: MsMailFolder[],
): string | null {
  const lower = filter.trim().toLowerCase();
  // Graph well-known folder names work as direct URL segments.
  if (MS_WELL_KNOWN_FOLDER_NAMES.has(lower)) {
    return lower;
  }
  // Match user folders by display name (case-insensitive). Suffix
  // match supports nested folders like `Work/Travel` finding `Travel`.
  const exact = folders.find((f) => f.displayName.toLowerCase() === lower);
  if (exact) return exact.id;
  const suffix = folders.find((f) =>
    f.displayName.toLowerCase().endsWith("/" + lower),
  );
  if (suffix) return suffix.id;
  // Graph folder IDs are opaque base64-ish strings ~120 chars long.
  // If the filter looks like that, treat it as an ID and let Graph
  // resolve it (or fail with 404, which is informative either way).
  if (filter.length > 80) return filter;
  return null;
}

export class MicrosoftEmailConnector implements EmailConnector {
  constructor(private readonly accessToken: string) {}

  async listLabels(): Promise<EmailLabel[]> {
    const folders = await graphPaginate<MsMailFolder>(
      this.accessToken,
      "/me/mailFolders",
      { query: { $select: "id,displayName", $top: "100" } },
    );
    // We can't distinguish system vs user folders from the
    // /me/mailFolders listing alone (Graph's mailFolder resource
    // doesn't expose a wellKnownName field). Mark all as "user" —
    // the well-known folders (Inbox, Drafts, etc.) still appear in
    // the list with their localised display names and the user
    // picks whichever they want.
    return folders.map((f) => ({
      id: f.id,
      name: f.displayName,
      type: "user" as const,
    }));
  }

  async scanEmails(options: EmailScanOptions = {}): Promise<RawEmail[]> {
    const { labelFilter, maxResults = 100, newerThanDays, logPrefix } = options;
    const top = String(Math.max(1, Math.min(maxResults, 500)));

    const query: Record<string, string> = {
      $select: MESSAGE_SELECT_FIELDS,
      $top: top,
      $orderby: "receivedDateTime desc",
    };

    if (typeof newerThanDays === "number" && newerThanDays > 0) {
      const cutoff = new Date(Date.now() - newerThanDays * 24 * 60 * 60 * 1000);
      query.$filter = `receivedDateTime ge ${cutoff.toISOString()}`;
    }

    // Default to the Inbox folder when no filter is provided.
    // `/me/messages` returns mail from ALL folders (Sent, Drafts,
    // Deleted, Junk, ...) — almost never what a user wants when they
    // click "scan emails." Gmail's default scope is similarly the
    // INBOX label via the underlying label-filter resolver; this
    // matches that intent for Outlook.
    let path = "/me/mailFolders/inbox/messages";
    if (labelFilter) {
      const folders = await graphPaginate<MsMailFolder>(
        this.accessToken,
        "/me/mailFolders",
        { query: { $select: "id,displayName", $top: "100" } },
      );
      const folderId = resolveFolderId(labelFilter, folders);
      if (!folderId) {
        if (logPrefix) {
          console.warn(`${logPrefix} folder "${labelFilter}" not found — falling back to inbox`);
        }
        path = "/me/mailFolders/inbox/messages";
      } else {
        path = `/me/mailFolders/${folderId}/messages`;
      }
    }

    const messages = await graphRequest<{ value: MsMessage[] }>(
      this.accessToken,
      path,
      { query },
    );
    if (!messages?.value) return [];
    return messages.value.map(messageToRawEmail);
  }
}
