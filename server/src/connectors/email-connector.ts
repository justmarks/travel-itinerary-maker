/**
 * Provider-agnostic email-scan API surface. Phase 4a of the
 * Drive→Supabase migration: the foundation for swapping Gmail out
 * for Microsoft Graph (or any future mail provider) without
 * touching route handlers.
 *
 * The two methods on the interface (`listLabels` + `scanEmails`)
 * mirror what `routes/emails.ts` actually calls on `GmailScanner`
 * today — keeping the foundation surface tight so the Microsoft
 * Graph adapter in Phase 4b has a focused target.
 *
 * Implementations today:
 *   - `GoogleEmailConnector` — wraps the existing `GmailScanner`
 *     class. Behaviour-identical to the pre-refactor code path.
 *
 * Coming in Phase 4b:
 *   - `MicrosoftEmailConnector` — `/me/messages` via Microsoft
 *     Graph. Microsoft uses folders + categories rather than labels,
 *     so the `listLabels` implementation maps Outlook folders to
 *     the same `EmailLabel` shape.
 *
 * Future shape: each connector may eventually own its own token
 * refresh logic (reading the encrypted refresh_token from the user's
 * `connections` row). Phase 4a keeps refresh at the route layer to
 * minimise the diff — the connector just receives an access token in
 * its constructor.
 */

import type { RawEmail, GmailScanOptions } from "../services/gmail-scanner";

export type { RawEmail } from "../services/gmail-scanner";

/**
 * Provider-agnostic label/folder summary. For Gmail this is a Gmail
 * label (system or user-created). For Microsoft Graph this is a
 * mail folder (Inbox, Travel, etc.).
 */
export interface EmailLabel {
  id: string;
  name: string;
  /**
   * `"system"` for provider-managed labels (Gmail's INBOX, STARRED,
   * etc.; Outlook's well-known folders). `"user"` for everything the
   * user created themselves.
   */
  type: "system" | "user";
}

/**
 * Subset of the existing `GmailScanOptions` that the connector
 * interface guarantees across providers. `labelFilter` may be a
 * Gmail label name OR a Microsoft folder name — each connector
 * resolves it against its own taxonomy.
 */
export interface EmailScanOptions {
  labelFilter?: GmailScanOptions["labelFilter"];
  maxResults?: GmailScanOptions["maxResults"];
  newerThanDays?: GmailScanOptions["newerThanDays"];
  logPrefix?: GmailScanOptions["logPrefix"];
}

export interface EmailConnector {
  listLabels(): Promise<EmailLabel[]>;
  scanEmails(options?: EmailScanOptions): Promise<RawEmail[]>;
}
