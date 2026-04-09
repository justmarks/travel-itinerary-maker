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

  /** Search for travel confirmation emails */
  async scanEmails(options: GmailScanOptions = {}): Promise<RawEmail[]> {
    const { labelFilter, maxResults = 25, newerThanDays = 365 } = options;

    const age = `newer_than:${newerThanDays}d`;
    let query: string;
    if (labelFilter) {
      query = `label:${labelFilter} ${age}`;
    } else {
      query = `subject:(confirmation OR booking OR reservation OR itinerary OR e-ticket OR receipt) ${age}`;
    }

    const listRes = await this.gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults,
    });

    const messageIds = listRes.data.messages || [];
    const emails: RawEmail[] = [];

    for (const msg of messageIds) {
      try {
        const email = await this.fetchEmail(msg.id!);
        if (email) emails.push(email);
      } catch (err) {
        console.error(`Failed to fetch email ${msg.id}:`, err);
      }
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
    if (!msg.payload) return null;

    const headers = msg.payload.headers || [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

    const subject = getHeader("Subject");
    const from = getHeader("From");
    const date = getHeader("Date");

    const bodyText = this.extractBody(msg.payload);
    if (!bodyText.trim()) return null;

    return {
      id: msg.id!,
      threadId: msg.threadId!,
      subject,
      from,
      receivedAt: date ? new Date(date).toISOString() : new Date().toISOString(),
      bodyText: bodyText.slice(0, 10000), // Cap at 10k chars to control token usage
    };
  }

  /** Collect all text/plain and text/html parts from a MIME tree */
  private collectTextParts(
    payload: gmail_v1.Schema$MessagePart,
    result: { plain: string[]; html: string[] },
  ): void {
    if (payload.body?.data) {
      const decoded = this.decodeBase64Url(payload.body.data);
      if (payload.mimeType === "text/plain") result.plain.push(decoded);
      else if (payload.mimeType === "text/html") result.html.push(decoded);
    }
    if (payload.parts) {
      for (const part of payload.parts) {
        this.collectTextParts(part, result);
      }
    }
  }

  /** Extract plain text body from MIME payload */
  private extractBody(payload: gmail_v1.Schema$MessagePart): string {
    const parts: { plain: string[]; html: string[] } = { plain: [], html: [] };
    this.collectTextParts(payload, parts);

    // Prefer plain text, fall back to HTML conversion
    if (parts.plain.length > 0) return parts.plain.join("\n");
    if (parts.html.length > 0) return this.htmlToText(parts.html.join("\n"));
    return "";
  }

  /** Decode base64url-encoded string */
  private decodeBase64Url(data: string): string {
    const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(base64, "base64").toString("utf-8");
  }

  /** Convert HTML to plain text */
  private htmlToText(html: string): string {
    return convert(html, {
      wordwrap: false,
      selectors: [
        { selector: "img", format: "skip" },
        { selector: "a", options: { ignoreHref: true } },
      ],
    });
  }
}
