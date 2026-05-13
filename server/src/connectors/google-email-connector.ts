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
import { InvalidAuthError, isAuthFailureStatus } from "./errors";

/**
 * Native Gmail errors come back as `GaxiosError`s with `code` (HTTP
 * status) or sometimes `response.status` depending on which
 * `googleapis` layer threw. Both shapes get normalised here so the
 * auth-failure classification stays predictable across the call
 * sites.
 */
function gmailErrorStatus(err: unknown): number | undefined {
  if (err && typeof err === "object") {
    const e = err as {
      code?: unknown;
      status?: unknown;
      response?: { status?: unknown };
    };
    if (typeof e.code === "number") return e.code;
    if (typeof e.status === "number") return e.status;
    if (e.response && typeof e.response.status === "number") {
      return e.response.status;
    }
  }
  return undefined;
}

function rethrowAuthFailures(err: unknown): never {
  const status = gmailErrorStatus(err);
  if (isAuthFailureStatus(status)) {
    throw new InvalidAuthError(
      status as number,
      err instanceof Error ? err.message : "Gmail rejected the access token",
      err,
    );
  }
  // Non-auth errors keep their native shape — the route's existing
  // `status` extraction still works for them.
  throw err;
}

export class GoogleEmailConnector implements EmailConnector {
  private readonly scanner: GmailScanner;

  constructor(accessToken: string) {
    this.scanner = new GmailScanner(accessToken);
  }

  async listLabels(): Promise<EmailLabel[]> {
    try {
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
    } catch (err) {
      rethrowAuthFailures(err);
    }
  }

  async scanEmails(options: EmailScanOptions = {}): Promise<RawEmail[]> {
    try {
      return await this.scanner.scanEmails(options);
    } catch (err) {
      rethrowAuthFailures(err);
    }
  }
}
