import { google, type gmail_v1 } from "googleapis";
import { convert } from "html-to-text";

export interface RawEmail {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  receivedAt: string;
  bodyText: string;
}

export interface GmailScanOptions {
  labelFilter?: string;
  maxResults?: number;
  newerThanDays?: number;
}

// ─── Pure helpers (exported for unit testing) ──────────────────────────────
//
// The logic that matters for behaviour — label name resolution, MIME body
// extraction, base64url decoding — is pulled out of the class so tests can
// hit it directly without constructing a Gmail client. The `GmailScanner`
// class below is a thin transport wrapper around these.

/**
 * System Gmail labels that pass through label resolution unchanged.
 * Users can refer to these by their canonical uppercase names.
 */
export const GMAIL_SYSTEM_LABELS = new Set([
  "INBOX", "STARRED", "SENT", "IMPORTANT", "TRASH", "SPAM",
  "DRAFT", "UNREAD", "CATEGORY_PERSONAL", "CATEGORY_SOCIAL",
  "CATEGORY_PROMOTIONS", "CATEGORY_UPDATES", "CATEGORY_FORUMS",
]);

export interface GmailLabelSummary {
  id: string;
  name: string;
  type?: string;
}

/**
 * Resolve a label filter (name, nested path, system label, or raw ID) to a
 * concrete Gmail label ID. Returns null if no match is found.
 *
 * System labels (INBOX, STARRED, …) and IDs that already look like Gmail
 * IDs (`Label_…`) pass through unchanged. For anything else, match by name
 * case-insensitively, with a fallback that matches the trailing segment of
 * a nested label (so "Travel" matches "Work/Travel").
 */
export function resolveLabelId(
  labelFilter: string,
  labels: GmailLabelSummary[],
): string | null {
  if (GMAIL_SYSTEM_LABELS.has(labelFilter) || labelFilter.startsWith("Label_")) {
    return labelFilter;
  }
  const lower = labelFilter.trim().toLowerCase();
  const match =
    labels.find((l) => l.name.toLowerCase() === lower) ||
    labels.find((l) => l.name.toLowerCase().endsWith("/" + lower));
  return match ? match.id : null;
}

/** Decode a base64url-encoded string (the encoding Gmail uses for body data) */
export function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

/** Strip HTML markup to plain text using the same rules as the Gmail scanner. */
export function htmlToText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "a", options: { ignoreHref: true } },
    ],
  });
}

/**
 * Walk a Gmail MIME payload tree and return the best text body we can
 * reconstruct. Prefers `text/plain`; falls back to HTML (converted to text)
 * only when the plain-text parts are missing or whitespace — marketing
 * emails commonly ship a blank plain-text fallback alongside the real HTML.
 */
export function extractBody(payload: gmail_v1.Schema$MessagePart): string {
  const parts: { plain: string[]; html: string[] } = { plain: [], html: [] };
  collectTextParts(payload, parts);

  const joinedPlain = parts.plain.join("\n").trim();
  if (joinedPlain.length > 0) return parts.plain.join("\n");
  if (parts.html.length > 0) return htmlToText(parts.html.join("\n"));
  return "";
}

function collectTextParts(
  payload: gmail_v1.Schema$MessagePart,
  result: { plain: string[]; html: string[] },
): void {
  if (payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    if (payload.mimeType === "text/plain") result.plain.push(decoded);
    else if (payload.mimeType === "text/html") result.html.push(decoded);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      collectTextParts(part, result);
    }
  }
}

/**
 * Scans Gmail for travel-related emails and returns raw content
 * for parsing by the AI service.
 */
export class GmailScanner {
  private gmail: gmail_v1.Gmail;

  constructor(accessToken: string) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    this.gmail = google.gmail({ version: "v1", auth });
  }

  /** List available Gmail labels for the user */
  async listLabels(): Promise<{ id: string; name: string; type: string }[]> {
    const res = await this.gmail.users.labels.list({ userId: "me" });
    return (res.data.labels || []).map((l) => ({
      id: l.id!,
      name: l.name!,
      type: l.type || "user",
    }));
  }

  /**
   * Resolve a label filter to a Gmail label ID. Fetches the user's label list
   * only when the filter isn't already a system label or raw `Label_…` ID.
   * See `resolveLabelId` (module-level) for the matching rules.
   */
  private async resolveLabelId(labelFilter: string): Promise<string | null> {
    if (GMAIL_SYSTEM_LABELS.has(labelFilter) || labelFilter.startsWith("Label_")) {
      return labelFilter;
    }
    const all = await this.listLabels();
    return resolveLabelId(labelFilter, all);
  }

  /** Search for travel confirmation emails */
  async scanEmails(options: GmailScanOptions = {}): Promise<RawEmail[]> {
    const { labelFilter, maxResults = 100, newerThanDays = 365 } = options;

    const age = `newer_than:${newerThanDays}d`;
    const listParams: gmail_v1.Params$Resource$Users$Messages$List = {
      userId: "me",
      maxResults,
    };

    if (labelFilter) {
      // Resolve the label to an ID and use the labelIds parameter instead of
      // baking it into the query string. This is the only reliable way to
      // match labels with spaces, slashes, or other special characters.
      const labelId = await this.resolveLabelId(labelFilter);
      if (!labelId) {
        console.warn(
          `Gmail scanner: label "${labelFilter}" not found in user's Gmail labels. Returning 0 emails.`,
        );
        return [];
      }
      listParams.labelIds = [labelId];
      listParams.q = age; // still constrain by age, but no subject/sender filter
      console.log(
        `Gmail search: labelIds=[${labelId}] (resolved from "${labelFilter}"), q="${age}"`,
      );
    } else {
      // Exclude obvious non-travel receipts that crowd out real travel emails.
      const excludes =
        "-from:(amazon.com OR uber.com OR lyft.com OR doordash.com OR grubhub.com OR instacart.com OR paypal.com OR venmo.com)";
      // Subject keywords OR known travel sender domains — catches emails like
      // Hawaiian Airlines even when their subject is a generic "receipt".
      const subjectTerms =
        "subject:(confirmation OR booking OR reservation OR itinerary OR e-ticket OR eticket OR \"boarding pass\" OR flight OR hotel OR check-in)";
      const travelSenders =
        "from:(airlines OR airline OR flight OR hotel OR marriott OR hilton OR hyatt OR airbnb OR vrbo OR expedia OR booking.com OR kayak OR united OR delta OR american OR southwest OR alaska OR hawaiian OR jetblue OR frontier OR spirit OR lufthansa OR klm OR british-airways OR airfrance OR emirates OR qatar)";
      listParams.q = `(${subjectTerms} OR ${travelSenders}) ${excludes} ${age}`;
      console.log(`Gmail search query: ${listParams.q}`);
    }

    const listRes = await this.gmail.users.messages.list(listParams);

    const messageIds = listRes.data.messages || [];
    console.log(
      `Gmail messages.list returned ${messageIds.length} message IDs` +
        (listRes.data.resultSizeEstimate !== undefined
          ? ` (resultSizeEstimate=${listRes.data.resultSizeEstimate})`
          : ""),
    );

    const emails: RawEmail[] = [];

    for (const msg of messageIds) {
      try {
        const email = await this.fetchEmail(msg.id!);
        if (email) emails.push(email);
      } catch (err) {
        console.error(`Failed to fetch email ${msg.id}:`, err);
      }
    }

    // Log every email subject we pulled so skipped/missing ones are obvious.
    for (const e of emails) {
      console.log(`  FOUND: "${e.subject}" from ${e.from} (${e.receivedAt})`);
    }

    return emails;
  }

  /** Fetch and parse a single email message */
  private async fetchEmail(messageId: string): Promise<RawEmail | null> {
    const res = await this.gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });

    const msg = res.data;
    if (!msg.payload) {
      console.log(`SKIP: email ${messageId} (no MIME payload)`);
      return null;
    }

    const headers = msg.payload.headers || [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

    const subject = getHeader("Subject");
    const from = getHeader("From");
    const date = getHeader("Date");

    const bodyText = extractBody(msg.payload);
    if (!bodyText.trim()) {
      console.log(
        `SKIP: "${subject}" from ${from} (empty body — no text/plain or text/html content)`,
      );
      return null;
    }

    return {
      id: msg.id!,
      threadId: msg.threadId!,
      subject,
      from,
      receivedAt: date ? new Date(date).toISOString() : new Date().toISOString(),
      bodyText: bodyText.slice(0, 10000), // Cap at 10k chars to control token usage
    };
  }

}
