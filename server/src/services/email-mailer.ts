import { createTransport, type Transporter } from "nodemailer";
import { config } from "../config/env";
import { reportError, reportMessage } from "./monitoring";
import type { ParseReportReason } from "@travel-app/shared";

/**
 * Outbound mailer for parse-failure reports submitted by users via
 * POST /api/v1/emails/report. Build is gated on `SMTP_HOST`: when unset
 * we skip transport setup entirely and the route falls back to capturing
 * the report via Sentry. That keeps dev / CI silent and means a missing
 * SMTP secret in production degrades to "we still see the report" rather
 * than failing the user-facing request.
 */

let transporter: Transporter | null = null;
let initialised = false;

function getTransporter(): Transporter | null {
  if (initialised) return transporter;
  initialised = true;
  if (!config.smtp.host) return null;
  transporter = createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth:
      config.smtp.user && config.smtp.pass
        ? { user: config.smtp.user, pass: config.smtp.pass }
        : undefined,
  });
  return transporter;
}

export interface ParseFailureReport {
  reason: ParseReportReason;
  reporterEmail: string;
  reporterUserId?: string;
  emailId: string;
  userNote?: string;
  expectedOutcome?: string;
  /**
   * Source of the email content. "gmail" means we re-fetched it from the
   * user's Gmail; "inline" means the client sent the raw source (HTML/EML
   * import). "metadata-only" means we couldn't recover the body at all.
   */
  source: "gmail" | "inline" | "metadata-only";
  originalSubject?: string;
  originalFrom?: string;
  originalReceivedAt?: string;
  originalBody?: string;
}

export interface SendResult {
  /** True if SMTP is configured and the message was accepted by the server. */
  delivered: boolean;
  /** True if Sentry captured the report (always true when monitoring is on). */
  reportedToSentry: boolean;
  /** Reason we didn't deliver, when delivered=false. */
  fallbackReason?: "smtp_disabled" | "smtp_error";
}

/** Reset the cached transporter so tests can swap config between runs. */
export function __resetMailerForTests(): void {
  transporter = null;
  initialised = false;
}

const REASON_LABEL: Record<ParseReportReason, string> = {
  failed: "Parser failed",
  no_travel_content: "Parser said: no travel content",
  parsed_wrong: "Parser extracted wrong data",
};

function buildSubject(report: ParseFailureReport): string {
  const label = REASON_LABEL[report.reason];
  const sender = report.originalFrom ? ` — ${report.originalFrom}` : "";
  return `[parse-report] ${label}${sender}`;
}

function buildBody(report: ParseFailureReport): string {
  const lines: string[] = [];
  lines.push(`Reason: ${REASON_LABEL[report.reason]}`);
  lines.push(`Reporter: ${report.reporterEmail}`);
  if (report.reporterUserId) lines.push(`User ID: ${report.reporterUserId}`);
  lines.push(`Email ID: ${report.emailId}`);
  lines.push(`Source: ${report.source}`);
  lines.push("");
  if (report.userNote) {
    lines.push("--- User note ---");
    lines.push(report.userNote);
    lines.push("");
  }
  if (report.expectedOutcome) {
    lines.push("--- Expected outcome ---");
    lines.push(report.expectedOutcome);
    lines.push("");
  }
  lines.push("--- Original email ---");
  if (report.originalSubject) lines.push(`Subject: ${report.originalSubject}`);
  if (report.originalFrom) lines.push(`From: ${report.originalFrom}`);
  if (report.originalReceivedAt) lines.push(`Received: ${report.originalReceivedAt}`);
  lines.push("");
  if (report.originalBody) {
    lines.push(report.originalBody);
  } else {
    lines.push("(body unavailable — could not refetch from Gmail)");
  }
  return lines.join("\n");
}

/**
 * Forward a parse-failure report to the operator inbox. Always also
 * captures a Sentry message so we have a centrally-searchable record
 * even when SMTP isn't configured.
 */
export async function sendParseFailureReport(
  report: ParseFailureReport,
): Promise<SendResult> {
  // Always tell Sentry — gives us aggregate visibility independent of
  // whether SMTP delivery succeeded.
  reportMessage(`email-parse-report:${report.reason}`, {
    level: "warning",
    tags: {
      "report.reason": report.reason,
      "report.source": report.source,
    },
    context: {
      emailId: report.emailId,
      reporterEmail: report.reporterEmail,
      reporterUserId: report.reporterUserId,
      originalSubject: report.originalSubject,
      originalFrom: report.originalFrom,
      hasUserNote: Boolean(report.userNote),
      hasExpectedOutcome: Boolean(report.expectedOutcome),
    },
  });

  const t = getTransporter();
  if (!t) {
    console.warn(
      `[email-mailer] SMTP_HOST not set — skipping delivery of parse-failure report from ${report.reporterEmail} (emailId=${report.emailId}). Captured to Sentry instead.`,
    );
    return {
      delivered: false,
      reportedToSentry: true,
      fallbackReason: "smtp_disabled",
    };
  }

  try {
    await t.sendMail({
      from: config.smtp.from,
      to: config.emailReportTo,
      replyTo: report.reporterEmail,
      subject: buildSubject(report),
      text: buildBody(report),
    });
    return { delivered: true, reportedToSentry: true };
  } catch (err) {
    reportError(err, {
      emailReportTo: config.emailReportTo,
      reporterEmail: report.reporterEmail,
      emailId: report.emailId,
    });
    console.error(
      `[email-mailer] failed to deliver parse-failure report (emailId=${report.emailId}):`,
      err,
    );
    return {
      delivered: false,
      reportedToSentry: true,
      fallbackReason: "smtp_error",
    };
  }
}
