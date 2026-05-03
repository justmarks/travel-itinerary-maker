import { createHash } from "crypto";
import { reportMessage } from "./monitoring";

/**
 * Telemetry for the email-parse pipeline.
 *
 * The goal is enough signal in Sentry to debug aggregate parse failures
 * (which senders / outcomes / models are most affected) without shipping
 * email content. Tags are searchable; extras are free-form. We never log
 * the subject, recipient, body, addresses, or confirmation numbers.
 */

export type ParseOutcome =
  | "failed"
  | "no_travel_content"
  | "exception"
  | "parsed_with_invalid";

export type ParseSource = "gmail_scan" | "html_import" | "eml_import";

export interface ParseTelemetryContext {
  outcome: ParseOutcome;
  source: ParseSource;
  /** Full subject — hashed before reporting. */
  subject?: string;
  /** Full from header — only the domain portion is reported. */
  from?: string;
  receivedAt?: string;
  bodyLength?: number;
  rawItemCount?: number;
  invalidCount?: number;
  /**
   * First few Zod issue codes when validation failed — useful for grouping
   * similar failures without leaking field values.
   */
  issueCodes?: string[];
  /** Anthropic model name (e.g. "claude-sonnet-4-..."). */
  model?: string;
  /** Optional error message (already free of body content). */
  errorMessage?: string;
}

/**
 * SHA-256 of the subject, truncated. Lets us group repeated failures from
 * the same template without exposing the subject text in Sentry. Empty /
 * undefined input returns "unknown".
 */
export function hashSubject(subject: string | undefined): string {
  const trimmed = (subject ?? "").trim();
  if (!trimmed) return "unknown";
  return createHash("sha256").update(trimmed).digest("hex").slice(0, 12);
}

/**
 * Extract just the host portion of a `From:` header. Handles the common
 * formats: bare "user@example.com", display-name "Foo <user@example.com>",
 * and tolerates surrounding whitespace. Returns "unknown" when nothing
 * usable can be parsed — never throws.
 */
export function senderDomain(from: string | undefined): string {
  if (!from) return "unknown";
  const angle = from.match(/<([^>]+)>/);
  const candidate = (angle ? angle[1] : from).trim();
  const at = candidate.lastIndexOf("@");
  if (at < 0 || at === candidate.length - 1) return "unknown";
  const domain = candidate.slice(at + 1).trim().toLowerCase();
  // Strip any stray quoting / trailing punctuation.
  return domain.replace(/[>"'\s].*$/, "") || "unknown";
}

/**
 * Emit a Sentry message describing a parse failure. Safe to call whether or
 * not Sentry is initialised. Never logs PII — only counts, hashes, domains,
 * and bookkeeping fields.
 */
export function recordParseFailure(ctx: ParseTelemetryContext): void {
  const tags: Record<string, string> = {
    "email.outcome": ctx.outcome,
    "email.source": ctx.source,
    "email.sender_domain": senderDomain(ctx.from),
  };
  if (ctx.model) tags["email.model"] = ctx.model;

  const context: Record<string, unknown> = {
    outcome: ctx.outcome,
    source: ctx.source,
    subjectHash: hashSubject(ctx.subject),
    senderDomain: senderDomain(ctx.from),
    receivedAt: ctx.receivedAt,
    bodyLength: ctx.bodyLength,
    rawItemCount: ctx.rawItemCount,
    invalidCount: ctx.invalidCount,
    issueCodes: ctx.issueCodes,
    model: ctx.model,
  };
  if (ctx.errorMessage) context.errorMessage = ctx.errorMessage;

  reportMessage(`email-parse:${ctx.outcome}`, {
    level: ctx.outcome === "no_travel_content" ? "info" : "warning",
    tags,
    context,
  });
}
