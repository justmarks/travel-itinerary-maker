/**
 * Gmail implementation of `EmailConnector`. Thin wrapper around
 * the existing `GmailScanner` class — created during Phase 4a so
 * route handlers can target the provider-agnostic interface without
 * behavioural drift.
 *
 * Token: the Gmail OAuth client (the one configured via
 * `GOOGLE_CLIENT_ID_GMAIL` / `GOOGLE_CLIENT_SECRET_GMAIL`) is
 * separate from the primary Google client so the primary stays off
 * the CASA-restricted path. The access token passed here is the
 * Gmail-specific token, sourced today by the `requireGmailAuth`
 * middleware reading the encrypted refresh_token from
 * `TokenStore` (Redis) and refreshing it against the Gmail client.
 * Phase 4a-2 will migrate that lookup to the `connections` table.
 */

import { GmailScanner } from "../services/gmail-scanner";
import type {
  EmailConnector,
  EmailLabel,
  EmailScanOptions,
} from "./email-connector";
import type { RawEmail } from "../services/gmail-scanner";

export class GoogleEmailConnector implements EmailConnector {
  private readonly scanner: GmailScanner;

  constructor(accessToken: string) {
    this.scanner = new GmailScanner(accessToken);
  }

  async listLabels(): Promise<EmailLabel[]> {
    const raw = await this.scanner.listLabels();
    // `type` on Gmail is "system" | "user". Coerce defensively in
    // case Gmail ever returns something unexpected — every non-
    // "system" value becomes "user" so feature-gating that splits on
    // user-vs-system stays robust.
    return raw.map((l) => ({
      id: l.id,
      name: l.name,
      type: l.type === "system" ? "system" : "user",
    }));
  }

  scanEmails(options: EmailScanOptions = {}): Promise<RawEmail[]> {
    return this.scanner.scanEmails(options);
  }
}
