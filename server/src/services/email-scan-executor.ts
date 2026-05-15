/**
 * Background execution of an auto email-scan schedule.
 *
 * Runs OUT-OF-BAND of a user request — the cron-tick endpoint passes
 * the schedule + a userId-scoped StorageProvider, and this service
 * resolves the right `EmailConnector` from the user's `connections`
 * row, scans, parses, and persists the results into `processed_emails`
 * so the existing pending-review UI surfaces them on the user's next
 * visit.
 *
 * Why not auto-apply parsed segments to trips?
 *   Parsed segments need a human-in-the-loop review (the existing
 *   scan dialog's "review step" with status badges + action cycle).
 *   Background scans get the same treatment: results land in the
 *   pending queue and `usePendingEmails()` surfaces them via a banner
 *   the user clicks to triage. This keeps the failure modes identical
 *   between manual and scheduled scans — a misparse can't silently
 *   show up on the itinerary.
 *
 * Push notification fires only when the run found segments worth
 * reviewing (`newCount > 0`). A run that returns "no travel content"
 * for everything stays silent; otherwise the user gets a daily
 * "0 new" buzz which trains them to ignore the notification.
 */

import { generateId } from "@itinly/shared";
import type {
  EmailScanRun,
  EmailScanSchedule,
} from "@itinly/shared";
import type { StorageProvider } from "./storage";
import type { ConnectionsStore } from "./connections-store";
import { getActiveAccessToken } from "./connections-token";
import { GoogleEmailConnector } from "../connectors/google-email-connector";
import { MicrosoftEmailConnector } from "../connectors/microsoft-email-connector";
import type { EmailConnector } from "../connectors/email-connector";
import { EmailParser } from "./email-parser";
import { computeNextRunAt } from "./email-scan-schedule-cadence";
import type { ProcessedEmail } from "./processed-email";
import { NotificationSender } from "./notification-sender";
import { recordParseFailure } from "./email-telemetry";
import { reportError } from "./monitoring";

export interface EmailScanExecutorDeps {
  storage: StorageProvider;
  connectionsStore?: ConnectionsStore;
  anthropicApiKey?: string;
  notificationSender?: NotificationSender;
}

export interface ExecuteScheduleResult {
  run: EmailScanRun;
  /** New segments parsed (drives the push body + banner count). */
  newCount: number;
}

/**
 * Resolves the right email connector for a (userId, provider) pair by
 * looking up the user's `connections` row. Returns null when there's
 * no active connection — the caller should mark the run as failed
 * with a clear error so the settings UI can surface it.
 */
async function resolveConnectorForSchedule(
  schedule: EmailScanSchedule,
  connectionsStore: ConnectionsStore | undefined,
): Promise<EmailConnector | null> {
  if (!connectionsStore) return null;
  const resolved = await getActiveAccessToken(
    { store: connectionsStore },
    schedule.userId,
    schedule.provider,
    "email",
  );
  if (!resolved) return null;
  return schedule.provider === "microsoft"
    ? new MicrosoftEmailConnector(resolved.accessToken)
    : new GoogleEmailConnector(resolved.accessToken);
}

/**
 * Executes a single schedule. The lifecycle:
 *   1. Insert a `running` run record so the settings UI shows
 *      "scan in progress" immediately.
 *   2. Resolve the connector. No connection → run finishes as
 *      `failed` with a friendly error message.
 *   3. Scan via the connector (capped at 100 results — the same cap
 *      the manual scan dialog uses).
 *   4. Filter out already-processed messages by `gmailMessageId`.
 *   5. Parse each new message with `EmailParser` and write a
 *      `processed_emails` row per outcome (`parsed` / `skipped` /
 *      `failed`). Errors per-message are isolated — one bad parse
 *      doesn't fail the run.
 *   6. Update the schedule's `lastRunAt` + `nextRunAt`.
 *   7. Mark the run `succeeded` (or `failed` if the connector call
 *      itself threw) and persist it.
 *   8. Fire a push notification when newCount > 0.
 */
export async function executeSchedule(
  schedule: EmailScanSchedule,
  deps: EmailScanExecutorDeps,
): Promise<ExecuteScheduleResult> {
  const { storage, connectionsStore, anthropicApiKey, notificationSender } =
    deps;
  const runStartedAt = new Date();
  const run: EmailScanRun = {
    id: `${runStartedAt.getTime()}-${generateId()}`,
    scheduleId: schedule.id,
    userId: schedule.userId,
    startedAt: runStartedAt.toISOString(),
    status: "running",
    scannedCount: 0,
    newCount: 0,
  };
  // Persist `running` so the settings UI can render "currently scanning"
  // — important when the run is slow (Claude parses can take 10–20 s
  // per email).
  await storage.saveEmailScanRun(run);

  const logPrefix = `[auto-scan ${schedule.userId} ${schedule.provider}${schedule.labelFilter ? `/${schedule.labelFilter}` : ""}]`;

  const finishWith = async (
    status: "succeeded" | "failed",
    extras: { scannedCount?: number; newCount?: number; errorMessage?: string },
  ): Promise<ExecuteScheduleResult> => {
    const finished: EmailScanRun = {
      ...run,
      status,
      finishedAt: new Date().toISOString(),
      scannedCount: extras.scannedCount ?? run.scannedCount,
      newCount: extras.newCount ?? run.newCount,
      errorMessage: extras.errorMessage,
    };
    await storage.saveEmailScanRun(finished);

    // Bump the schedule's run-tracking columns regardless of
    // success/failure: failures count as "I tried" so we don't tight-
    // loop on a broken account, and the user sees the failure in the
    // run history. Cadence anchors on the run's start time so a long
    // scan doesn't bend the schedule.
    const updatedSchedule: EmailScanSchedule = {
      ...schedule,
      lastRunAt: run.startedAt,
      nextRunAt: computeNextRunAt(schedule.frequency, runStartedAt),
      updatedAt: new Date().toISOString(),
    };
    await storage.saveEmailScanSchedule(updatedSchedule);

    return { run: finished, newCount: finished.newCount };
  };

  if (!anthropicApiKey) {
    console.warn(`${logPrefix} skipping — ANTHROPIC_API_KEY not set`);
    return finishWith("failed", {
      errorMessage: "AI service not configured (ANTHROPIC_API_KEY missing).",
    });
  }

  // 1. Resolve connector for this user × provider.
  let connector: EmailConnector | null;
  try {
    connector = await resolveConnectorForSchedule(schedule, connectionsStore);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${logPrefix} connector resolve threw:`, err);
    reportError(err, { source: "auto_scan", phase: "connector-resolve" });
    return finishWith("failed", {
      errorMessage: `Couldn't resolve ${schedule.provider} mailbox connection: ${msg}`,
    });
  }
  if (!connector) {
    return finishWith("failed", {
      errorMessage: `${schedule.provider === "microsoft" ? "Outlook" : "Gmail"} isn't connected on this account. Reconnect it from Settings to resume scheduled scans.`,
    });
  }

  // 2. Scan the mailbox.
  let rawEmails;
  try {
    rawEmails = await connector.scanEmails({
      labelFilter: schedule.labelFilter,
      // Same cap the manual scan uses — keeps a single tick cheap and
      // bounded even when the user picks a noisy folder.
      maxResults: 100,
      // 30-day window is enough for a daily cadence to never miss an
      // email even with a few skipped runs. Weekly / monthly cadences
      // also tolerate it because already-processed messages are
      // filtered out before parsing.
      newerThanDays: 30,
      logPrefix,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${logPrefix} mailbox scan threw:`, err);
    reportError(err, { source: "auto_scan", phase: "scan" });
    return finishWith("failed", {
      errorMessage: `Couldn't read the mailbox: ${msg}`,
    });
  }
  run.scannedCount = rawEmails.length;

  // 3. Filter out emails the user has already triaged (status mapped
  // OR skipped). New emails and previously-failed ones are eligible
  // for re-parse on every run.
  const processed = await storage.getProcessedEmails();
  const processedMap = new Map(processed.map((p) => [p.gmailMessageId, p]));
  const DONE_STATUSES = new Set(["mapped", "skipped"]);
  const newEmails = rawEmails.filter((email) => {
    const prior = processedMap.get(email.id);
    if (!prior) return true;
    // Pull failed and parsed-but-pending ones back through so the
    // schedule eventually retries them (consistent with manual
    // `forceRescan` behaviour, but for the failed/parsed buckets).
    return !DONE_STATUSES.has(prior.parseStatus);
  });

  if (newEmails.length === 0) {
    return finishWith("succeeded", { scannedCount: rawEmails.length, newCount: 0 });
  }

  // 4. Parse each new email and write a processed_emails row per
  // outcome. Per-email errors are isolated — a single broken parse
  // doesn't fail the whole run.
  const parser = new EmailParser({ apiKey: anthropicApiKey });
  const newProcessedRows: ProcessedEmail[] = [];
  let newCount = 0;
  for (const email of newEmails) {
    try {
      const { segments, invalidCount, rawItemCount } = await parser.parseEmail({
        subject: email.subject,
        from: email.from,
        body: email.bodyText,
        receivedAt: email.receivedAt,
      });
      const hasTravel = segments.length > 0;
      const validationFailedEverything =
        !hasTravel && rawItemCount > 0 && invalidCount > 0;

      const scanResult = hasTravel || validationFailedEverything
        ? {
            emailId: email.id,
            subject: email.subject,
            from: email.from,
            receivedAt: email.receivedAt,
            // No trip matching here — the existing pending-review
            // pipeline re-matches against current trips when the user
            // opens the dialog, so we keep the stored result lean.
            parsedSegments: segments.map((seg) => ({ ...seg })),
            parseStatus: hasTravel
              ? ("success" as const)
              : ("failed" as const),
            ...(validationFailedEverything
              ? {
                  error: `Claude returned ${rawItemCount} item(s) but none passed schema validation.`,
                }
              : {}),
          }
        : undefined;

      // Replace the prior processed row for this message id so a
      // retried failure transitions cleanly. The storage layer's
      // saveProcessedEmails de-dupes by gmailMessageId already, but
      // we splice for clarity.
      const priorIdx = processed.findIndex((p) => p.gmailMessageId === email.id);
      if (priorIdx !== -1) processed.splice(priorIdx, 1);
      newProcessedRows.push({
        gmailMessageId: email.id,
        gmailThreadId: email.threadId,
        subject: email.subject,
        fromAddress: email.from,
        receivedAt: email.receivedAt,
        parsedType: hasTravel ? segments[0].type : undefined,
        parseStatus: hasTravel
          ? "parsed"
          : validationFailedEverything
            ? "failed"
            : "skipped",
        rawParseResult: scanResult,
        provider: schedule.provider,
        accountEmail: "", // best-effort — the manual flow falls back to userEmail
        createdAt: new Date().toISOString(),
      });

      if (hasTravel) newCount += segments.length;

      if (invalidCount > 0) {
        recordParseFailure({
          outcome: hasTravel ? "parsed_with_invalid" : "failed",
          source: "gmail_scan",
          subject: email.subject,
          from: email.from,
          receivedAt: email.receivedAt,
          bodyLength: email.bodyText.length,
          rawItemCount,
          invalidCount,
        });
      }
    } catch (err: unknown) {
      // Per-email failure: log + telemetry, but keep going. The next
      // scheduled run will retry this email (it's not in DONE_STATUSES).
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${logPrefix} parse failed for "${email.subject}":`, err);
      recordParseFailure({
        outcome: "exception",
        source: "gmail_scan",
        subject: email.subject,
        from: email.from,
        receivedAt: email.receivedAt,
        bodyLength: email.bodyText.length,
        errorMessage: msg,
      });
      reportError(err, { source: "auto_scan", phase: "parse-email" });
    }
  }

  // 5. Persist the merged processed_emails list.
  await storage.saveProcessedEmails([...processed, ...newProcessedRows]);

  // 6. Fire a push when there's something worth reviewing.
  if (newCount > 0 && notificationSender) {
    try {
      await notificationSender.sendToUser(schedule.userId, {
        title: "New travel found",
        body: newCount === 1
          ? "1 new booking is ready to review."
          : `${newCount} new bookings are ready to review.`,
        // `/m` shows the auto-scan banner that opens the review sheet.
        url: "/m",
        tag: "auto-scan",
        data: { kind: "auto-scan", scheduleId: schedule.id, newCount },
      });
    } catch (err) {
      // Notification failure shouldn't fail the run — the banner still
      // works from the processed_emails row.
      console.warn(`${logPrefix} push failed:`, err);
    }
  }

  console.log(
    `${logPrefix} done — scanned ${rawEmails.length}, parsed ${newProcessedRows.length}, ${newCount} new segment(s)`,
  );

  return finishWith("succeeded", {
    scannedCount: rawEmails.length,
    newCount,
  });
}
