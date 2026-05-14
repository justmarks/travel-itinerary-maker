/**
 * Domain type for an email scanned by the email-parse pipeline.
 * Stored alongside trip data so a future scan can dedupe against
 * earlier results.
 */
export interface ProcessedEmail {
  gmailMessageId: string;
  gmailThreadId?: string;
  subject?: string;
  fromAddress?: string;
  receivedAt?: string;
  parsedType?: string;
  segmentId?: string;
  tripId?: string;
  parseStatus: "pending" | "parsed" | "mapped" | "skipped" | "failed";
  rawParseResult?: unknown;
  /** Which provider's mailbox this email came from. Optional for
   *  back-compat with rows written before Phase 4b-2; new rows always
   *  set it. Defaults to "google" on the storage layer for legacy
   *  reads, so the field is effectively always populated downstream. */
  provider?: "google" | "microsoft";
  /** The mailbox address (e.g. "user@example.com") this email was
   *  scanned from. Empty for legacy rows; new rows take it from the
   *  resolved connection (or `req.userEmail` on the legacy Gmail
   *  path). Lets observability + multi-mailbox features
   *  distinguish identical messages across accounts. */
  accountEmail?: string;
  createdAt: string;
}
