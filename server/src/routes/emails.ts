import { Router, type Request, type Response } from "express";
import {
  emailScanRequestSchema,
  htmlImportRequestSchema,
  applyParsedSegmentsSchema,
  generateId,
  isDateInRange,
  applyCruisePortsToDayCities,
  type EmailScanResult,
  type ParsedSegment,
  type Segment,
  type SegmentMatch,
  type SegmentFieldDiff,
  type Trip,
} from "@travel-app/shared";
import type { StorageProvider, StorageResolver } from "../services/storage";
import type { ProcessedEmail } from "../services/google-drive/drive-storage";
import { GmailScanner } from "../services/gmail-scanner";
import { EmailParser } from "../services/email-parser";
import { createEmailScanRateLimiter } from "../middleware/rate-limit";
import { recordParseFailure } from "../services/email-telemetry";
import { reportError } from "../services/monitoring";
import { debugEmailScan } from "../utils/debug-log";
import { config } from "../config/env";

export interface EmailRoutesOptions {
  resolveStorage: StorageResolver | StorageProvider;
}

/**
 * Generate a dedup key for a parsed segment.
 * Segments with the same key are considered duplicates to be merged.
 */
function segmentDedupeKey(seg: ParsedSegment): string {
  // Flights: same route + date
  if (seg.type === "flight" && seg.routeCode) {
    return `flight:${seg.date}:${seg.routeCode}`;
  }
  if (seg.type === "flight" && seg.departureAirport && seg.arrivalAirport) {
    return `flight:${seg.date}:${seg.departureAirport}-${seg.arrivalAirport}`;
  }
  if (seg.type === "flight" && seg.departureCity && seg.arrivalCity) {
    return `flight:${seg.date}:${seg.departureCity}-${seg.arrivalCity}`;
  }
  // Confirmation code match: same type + date + confirmation
  if (seg.confirmationCode) {
    return `${seg.type}:${seg.confirmationCode}`;
  }
  // Same type + date + title (fuzzy)
  return `${seg.type}:${seg.date}:${seg.title.toLowerCase().replace(/\s+/g, "")}`;
}

/**
 * Merge two duplicate segments, combining data from both.
 * The "winner" keeps its fields; the "donor" fills in blanks and appends seat numbers.
 */
function mergeSegments(
  a: ParsedSegment & { emailId?: string },
  b: ParsedSegment & { emailId?: string },
): ParsedSegment & { emailId?: string } {
  const merged = { ...a };

  // Combine seat numbers
  if (b.seatNumber) {
    const existingSeats = new Set((a.seatNumber || "").split(",").map((s) => s.trim()).filter(Boolean));
    const newSeats = b.seatNumber.split(",").map((s) => s.trim()).filter(Boolean);
    for (const s of newSeats) existingSeats.add(s);
    merged.seatNumber = [...existingSeats].join(", ");
  }

  // Take higher party size
  if (b.partySize && (!a.partySize || b.partySize > a.partySize)) {
    merged.partySize = b.partySize;
  }

  // Fill in missing fields from b
  const fillFields = [
    "city", "venueName", "address", "confirmationCode", "provider",
    "carrier", "routeCode", "departureCity", "arrivalCity", "phone",
    "url", "startTime", "endTime", "endDate", "breakfastIncluded", "cabinClass", "baggageInfo",
  ] as const;
  for (const field of fillFields) {
    if (!merged[field] && b[field] !== undefined) {
      (merged as Record<string, unknown>)[field] = b[field];
    }
  }

  // Merge cost — for flights (per-person tickets like Delta), SUM the amounts.
  // For other types, prefer the one with details or the higher amount.
  if (b.cost && !a.cost) {
    merged.cost = b.cost;
  } else if (b.cost && a.cost) {
    const isFlightType = a.type === "flight";
    const details = [a.cost.details, b.cost.details].filter(Boolean).join("; ");
    merged.cost = {
      amount: isFlightType
        ? a.cost.amount + b.cost.amount   // Sum per-person ticket prices
        : Math.max(a.cost.amount, b.cost.amount),
      currency: a.cost.currency,
      ...(details ? { details } : {}),
    };
  }

  // Take higher confidence
  const confRank = { high: 3, medium: 2, low: 1 };
  if (confRank[b.confidence] > confRank[a.confidence]) {
    merged.confidence = b.confidence;
  }

  return merged;
}

/** Normalize a string for fuzzy comparison: lowercase, alnum only */
function normStr(s: string | undefined): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Fields compared between a parsed segment and an existing itinerary segment.
 * Keys with meaningful values on either side drive the enrichment/conflict logic.
 */
const COMPARABLE_FIELDS = [
  "title",
  "startTime",
  "endTime",
  "venueName",
  "address",
  "city",
  "url",
  "confirmationCode",
  "provider",
  "departureCity",
  "arrivalCity",
  "departureAirport",
  "arrivalAirport",
  "carrier",
  "routeCode",
  "partySize",
  "creditCardHold",
  "phone",
  "endDate",
  "breakfastIncluded",
  "seatNumber",
  "cabinClass",
  "baggageInfo",
  "contactName",
] as const;

type ComparableField = (typeof COMPARABLE_FIELDS)[number];

/** Decide if two field values should be considered "the same". */
function fieldValuesEqual(
  field: ComparableField,
  a: unknown,
  b: unknown,
): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  // Strings: loose match (whitespace/case/punct insensitive)
  if (typeof a === "string" && typeof b === "string") {
    if (field === "startTime" || field === "endTime") {
      // Compare HH:MM portion only, regardless of seconds
      return a.slice(0, 5) === b.slice(0, 5);
    }
    return normStr(a) === normStr(b);
  }
  return false;
}

/** Does this existing segment look like the same booking as the parsed one? */
function isCandidateMatch(existing: Segment, parsed: ParsedSegment, existingDate: string): boolean {
  // Must be same type
  if (existing.type !== parsed.type) return false;

  // Confirmation code match is strongest signal, regardless of date/title.
  if (
    parsed.confirmationCode &&
    existing.confirmationCode &&
    normStr(parsed.confirmationCode) === normStr(existing.confirmationCode)
  ) {
    return true;
  }

  // Flights: same date + same route code, OR same date + same departure/arrival.
  if (parsed.type === "flight") {
    if (existingDate !== parsed.date) return false;
    if (
      parsed.routeCode &&
      existing.routeCode &&
      normStr(parsed.routeCode) === normStr(existing.routeCode)
    ) {
      return true;
    }
    if (
      parsed.departureCity &&
      parsed.arrivalCity &&
      existing.departureCity &&
      existing.arrivalCity &&
      normStr(parsed.departureCity) === normStr(existing.departureCity) &&
      normStr(parsed.arrivalCity) === normStr(existing.arrivalCity)
    ) {
      return true;
    }
    return false;
  }

  // Hotels: match by venueName (fuzzy). Date may differ because parsed uses
  // check-in and existing could be stored on any of the nights.
  if (parsed.type === "hotel") {
    if (!parsed.venueName || !existing.venueName) return false;
    return normStr(parsed.venueName) === normStr(existing.venueName);
  }

  // Car rentals: match by provider + date (pickup OR dropoff day).
  if (parsed.type === "car_rental") {
    if (existingDate !== parsed.date) return false;
    if (
      parsed.provider &&
      existing.provider &&
      normStr(parsed.provider) === normStr(existing.provider)
    ) {
      return true;
    }
    // Fallback: same title (e.g. "National - Lihue")
    return normStr(parsed.title) === normStr(existing.title);
  }

  // Restaurants / activities / tours: same date + fuzzy venue or title.
  if (existingDate !== parsed.date) return false;
  if (
    parsed.venueName &&
    existing.venueName &&
    normStr(parsed.venueName) === normStr(existing.venueName)
  ) {
    return true;
  }
  return normStr(parsed.title) === normStr(existing.title);
}

/**
 * Match a parsed segment against the existing segments in a trip.
 * Returns a classification (new/duplicate/enrichment/conflict) + diffs.
 */
function matchParsedAgainstTrip(
  parsed: ParsedSegment,
  trip: Trip,
): SegmentMatch {
  for (const day of trip.days) {
    for (const existing of day.segments) {
      if (!isCandidateMatch(existing, parsed, day.date)) continue;

      const newFields: string[] = [];
      const conflictFields: SegmentFieldDiff[] = [];

      for (const field of COMPARABLE_FIELDS) {
        const pVal = (parsed as unknown as Record<string, unknown>)[field];
        const eVal = (existing as unknown as Record<string, unknown>)[field];
        const pEmpty = pVal === undefined || pVal === null || pVal === "";
        const eEmpty = eVal === undefined || eVal === null || eVal === "";

        if (pEmpty) continue;
        if (eEmpty) {
          newFields.push(field);
          continue;
        }
        if (!fieldValuesEqual(field, pVal, eVal)) {
          conflictFields.push({
            field,
            existing: eVal as string | number | boolean,
            parsed: pVal as string | number | boolean,
          });
        }
      }

      // Compare cost amount separately (nested)
      if (parsed.cost && !existing.cost) {
        newFields.push("cost");
      } else if (parsed.cost && existing.cost) {
        if (
          parsed.cost.currency !== existing.cost.currency ||
          Math.abs(parsed.cost.amount - existing.cost.amount) > 0.01
        ) {
          conflictFields.push({
            field: "cost",
            existing: `${existing.cost.currency} ${existing.cost.amount}`,
            parsed: `${parsed.cost.currency} ${parsed.cost.amount}`,
          });
        }
      }

      // Compare parsed.date vs existing day.date for non-flight types (flights
      // already require same date in the candidate check).
      if (parsed.type !== "flight" && parsed.date !== day.date) {
        conflictFields.push({
          field: "date",
          existing: day.date,
          parsed: parsed.date,
        });
      }

      let status: SegmentMatch["status"];
      if (conflictFields.length > 0) {
        status = "conflict";
      } else if (newFields.length > 0) {
        status = "enrichment";
      } else {
        status = "duplicate";
      }

      return {
        status,
        existingSegmentId: existing.id,
        existingTripId: trip.id,
        newFields: newFields.length ? newFields : undefined,
        conflictFields: conflictFields.length ? conflictFields : undefined,
      };
    }
  }

  return { status: "new" };
}

/** Locate a segment by id within a trip. */
function findSegmentById(
  trip: Trip,
  segmentId: string,
): { segment: Segment; day: Trip["days"][number] } | null {
  for (const day of trip.days) {
    const segment = day.segments.find((s) => s.id === segmentId);
    if (segment) return { segment, day };
  }
  return null;
}

/**
 * Copy fields from a parsed segment onto an existing segment.
 * - overwrite=false (merge): only fill fields that are empty on the existing segment.
 * - overwrite=true  (replace): overwrite every field that is set on the parsed segment.
 * Never touches id/source/sortOrder/sourceEmailId.
 */
function applySegmentFields(
  target: Segment,
  parsed: ParsedSegment,
  { overwrite }: { overwrite: boolean },
): void {
  const copyable = [
    "title",
    "startTime",
    "endTime",
    "venueName",
    "address",
    "city",
    "url",
    "confirmationCode",
    "provider",
    "departureCity",
    "arrivalCity",
    "departureAirport",
    "arrivalAirport",
    "carrier",
    "routeCode",
    "partySize",
    "creditCardHold",
    "phone",
    "endDate",
    "breakfastIncluded",
    "seatNumber",
    "cabinClass",
    "baggageInfo",
    "contactName",
  ] as const;

  const existing = target as unknown as Record<string, unknown>;
  const incoming = parsed as unknown as Record<string, unknown>;

  for (const field of copyable) {
    const pVal = incoming[field];
    if (pVal === undefined || pVal === null || pVal === "") continue;
    const eVal = existing[field];
    const eEmpty = eVal === undefined || eVal === null || eVal === "";
    if (overwrite || eEmpty) {
      existing[field] = pVal;
    }
  }

  if (parsed.cost) {
    if (overwrite || !target.cost) {
      target.cost = { ...parsed.cost };
    }
  }

  // portsOfCall is an array, so the generic copyable-field logic doesn't
  // apply cleanly. Treat it like cost: copy when overwriting or when the
  // target has no existing ports-of-call data.
  if (parsed.portsOfCall && parsed.portsOfCall.length > 0) {
    if (overwrite || !target.portsOfCall || target.portsOfCall.length === 0) {
      target.portsOfCall = parsed.portsOfCall.map((p) => ({ ...p }));
    }
  }
}

/**
 * Deduplicate parsed segments across all email results.
 * Modifies results in place.
 */
function deduplicateResults(results: EmailScanResult[]): void {
  // Collect all segments with their email context
  const allSegments: Array<{ seg: ParsedSegment & { emailId: string }; resultIdx: number; segIdx: number }> = [];
  for (let ri = 0; ri < results.length; ri++) {
    for (let si = 0; si < results[ri].parsedSegments.length; si++) {
      allSegments.push({
        seg: { ...results[ri].parsedSegments[si], emailId: results[ri].emailId },
        resultIdx: ri,
        segIdx: si,
      });
    }
  }

  // Group by dedup key
  const groups = new Map<string, typeof allSegments>();
  for (const entry of allSegments) {
    const key = segmentDedupeKey(entry.seg);
    const group = groups.get(key) || [];
    group.push(entry);
    groups.set(key, group);
  }

  // Find duplicates and mark segments to remove
  const toRemove = new Set<string>(); // "resultIdx:segIdx"
  const replacements = new Map<string, ParsedSegment>(); // "resultIdx:segIdx" → merged

  const totalSegs = allSegments.length;
  const dupGroups = [...groups.values()].filter((g) => g.length > 1).length;
  debugEmailScan(`[dedup] ${totalSegs} segment(s) across ${results.length} result(s) — ${dupGroups} duplicate group(s)`);

  for (const [dedupKey, group] of groups) {
    if (group.length <= 1) continue;

    // Merge all into the first one
    let merged = group[0].seg;
    for (let i = 1; i < group.length; i++) {
      merged = mergeSegments(merged, group[i].seg) as ParsedSegment & { emailId: string };
      toRemove.add(`${group[i].resultIdx}:${group[i].segIdx}`);
    }

    const winnerKey = `${group[0].resultIdx}:${group[0].segIdx}`;
    replacements.set(winnerKey, merged);

    debugEmailScan(`  Dedup [${dedupKey}]: ${group.length} copies of "${merged.title}"`);
    debugEmailScan(`    keeping: from ${group[0].seg.emailId}`);
    for (let i = 1; i < group.length; i++) {
      debugEmailScan(`    skipping: from ${group[i].seg.emailId} (duplicate)`);
    }
  }

  // Apply removals and replacements (iterate backwards to preserve indices)
  for (let ri = results.length - 1; ri >= 0; ri--) {
    const segs = results[ri].parsedSegments;
    for (let si = segs.length - 1; si >= 0; si--) {
      const key = `${ri}:${si}`;
      if (toRemove.has(key)) {
        segs.splice(si, 1);
      } else if (replacements.has(key)) {
        segs[si] = replacements.get(key)!;
      }
    }
  }
}

/** Statuses that mean the email is "done" and shouldn't be re-shown */
const DONE_STATUSES = new Set(["mapped", "skipped"]);

export function createEmailRoutes(options: EmailRoutesOptions): Router {
  const { resolveStorage } = options;

  const getStorage: StorageResolver =
    typeof resolveStorage === "function"
      ? resolveStorage
      : () => resolveStorage;

  const router = Router();

  /**
   * GET /emails/labels
   * List Gmail labels for the authenticated user.
   */
  router.get("/labels", async (req: Request, res: Response) => {
    try {
      const scanner = new GmailScanner(req.accessToken || "");
      const labels = await scanner.listLabels();

      // Return user labels + useful system labels
      const useful = labels.filter(
        (l) =>
          l.type === "user" ||
          ["INBOX", "STARRED", "IMPORTANT"].includes(l.id),
      );

      res.json(useful);
    } catch (err) {
      console.error("GET /emails/labels error:", err);
      const message = err instanceof Error ? err.message : "Failed to list labels";
      if (message.includes("insufficient") || message.includes("scope")) {
        res.status(403).json({
          error: "Gmail access not granted",
          code: "GMAIL_SCOPE_REQUIRED",
        });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  /**
   * GET /emails/pending
   * Return previously-parsed results that haven't been applied or dismissed yet.
   * This lets the UI resume where the user left off without re-scanning.
   */
  router.get("/pending", async (req: Request, res: Response) => {
    try {
      const storage = getStorage(req);
      const processedEmails = await storage.getProcessedEmails();
      const trips = await storage.listTrips();

      // Find emails with status "parsed" — they have saved results but aren't done
      const pendingEmails = processedEmails.filter(
        (pe) => pe.parseStatus === "parsed" && pe.rawParseResult,
      );

      if (pendingEmails.length === 0) {
        res.json({ results: [] });
        return;
      }

      // Reconstruct EmailScanResult from stored data, re-matching trip suggestions
      // and re-classifying against current itinerary state.
      const results: EmailScanResult[] = pendingEmails.map((pe) => {
        const stored = pe.rawParseResult as EmailScanResult;
        const rematchedSegments = stored.parsedSegments.map((seg) => {
          const matchingTrip = trips.find((t) =>
            isDateInRange(seg.date, t.startDate, t.endDate),
          );
          if (!matchingTrip) {
            return { ...seg, suggestedTripId: undefined, match: { status: "new" as const } };
          }
          const match = matchParsedAgainstTrip(seg, matchingTrip);
          return { ...seg, suggestedTripId: matchingTrip.id, match };
        });
        return { ...stored, parsedSegments: rematchedSegments };
      });

      debugEmailScan(`Returning ${results.length} pending email results`);
      res.json({ results });
    } catch (err) {
      console.error("GET /emails/pending error:", err);
      res.status(500).json({ error: "Failed to load pending results" });
    }
  });

  /**
   * POST /emails/scan
   * Trigger a Gmail scan and parse emails with Claude AI.
   * Returns: pending (previously parsed) results + newly parsed results combined.
   * Only NEW emails (not in processedEmails at all) are sent to Claude.
   *
   * Rate-limited per user (see `createEmailScanRateLimiter`) — scanning is
   * expensive and users don't need to hammer this button.
   */
  const scanRateLimiter = createEmailScanRateLimiter();
  router.post("/scan", scanRateLimiter, async (req: Request, res: Response) => {
    try {
      const parsed = emailScanRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues });
        return;
      }

      const { tripId, labelFilter, maxResults, newerThanDays, forceRescan } = parsed.data;
      const storage = getStorage(req);

      // Load all processed email records
      const processedEmails = await storage.getProcessedEmails();
      const processedMap = new Map(processedEmails.map((e) => [e.gmailMessageId, e]));

      // Get existing trips for auto-matching
      const trips = await storage.listTrips();

      // Collect pending results (parsed but not applied/dismissed)
      const tripsById = new Map(trips.map((t) => [t.id, t]));
      const pendingResults: EmailScanResult[] = [];
      for (const pe of processedEmails) {
        if (pe.parseStatus === "parsed" && pe.rawParseResult) {
          const stored = pe.rawParseResult as EmailScanResult;
          // Re-match trip suggestions + re-classify against current itinerary
          const rematchedSegments = stored.parsedSegments.map((seg) => {
            const matchingTrip = tripId
              ? tripsById.get(tripId)
              : trips.find((t) => isDateInRange(seg.date, t.startDate, t.endDate));
            if (!matchingTrip) {
              return { ...seg, suggestedTripId: undefined, match: { status: "new" as const } };
            }
            const match = matchParsedAgainstTrip(seg, matchingTrip);
            return { ...seg, suggestedTripId: matchingTrip.id, match };
          });
          pendingResults.push({ ...stored, parsedSegments: rematchedSegments });
        }
      }

      // Scan Gmail for new emails
      const scanner = new GmailScanner(req.accessToken || "");
      const effectiveMaxResults = maxResults ?? 100;
      const rawEmails = await scanner.scanEmails({
        labelFilter,
        maxResults: effectiveMaxResults,
        newerThanDays: newerThanDays ?? 365,
      });

      debugEmailScan(
        `Gmail returned ${rawEmails.length} emails (maxResults=${effectiveMaxResults}, labelFilter=${labelFilter || "none"})`,
      );
      if (rawEmails.length >= effectiveMaxResults) {
        console.warn(
          `  NOTE: hit the maxResults cap (${effectiveMaxResults}). Older matching emails may be missing — consider increasing maxResults or narrowing with a labelFilter.`,
        );
      }

      // Filter which emails to (re)parse. Default policy:
      //   - never seen before  → parse
      //   - prior "failed"     → retry automatically (a previous code bug or
      //                          transient error may have blocked it)
      //   - prior "skipped"    → do NOT retry unless forceRescan is set
      //   - prior "parsed"     → already have results, skip (pending)
      //   - prior "mapped"     → already applied to a trip, skip
      // When forceRescan=true, retry ALL prior statuses except "mapped"
      // (already applied). Log skipped ones with the reason.
      const newEmails = rawEmails.filter((e) => {
        const prior = processedMap.get(e.id);
        if (!prior) return true;

        if (forceRescan) {
          if (prior.parseStatus === "mapped") {
            debugEmailScan(`SKIP: "${e.subject}" (already applied to a trip — not re-scanned even with forceRescan)`);
            return false;
          }
          debugEmailScan(`RETRY: "${e.subject}" (forceRescan, prior=${prior.parseStatus})`);
          return true;
        }

        // Auto-retry prior failed status — previous attempt errored and the
        // code that caused it may have been fixed since.
        if (prior.parseStatus === "failed") {
          debugEmailScan(`RETRY: "${e.subject}" (previously failed — retrying)`);
          return true;
        }

        const reason =
          prior.parseStatus === "mapped"
            ? "already applied to a trip"
            : prior.parseStatus === "skipped"
              ? "previously dismissed / no travel content"
              : prior.parseStatus === "parsed"
                ? "already parsed, pending review"
                : `already processed (${prior.parseStatus})`;
        debugEmailScan(`SKIP: "${e.subject}" (${reason})`);
        return false;
      });

      // If no new emails to parse, just return pending results
      if (newEmails.length === 0) {
        if (pendingResults.length > 0) {
          debugEmailScan(`No new emails. Returning ${pendingResults.length} pending results.`);
          res.json({ results: pendingResults, pendingCount: pendingResults.length, newCount: 0 });
        } else {
          res.json({ results: [], message: "No new emails to process" });
        }
        return;
      }

      // Parse new emails with Claude
      if (!config.anthropic.apiKey) {
        res.status(500).json({ error: "Anthropic API key not configured" });
        return;
      }

      const parser = new EmailParser({ apiKey: config.anthropic.apiKey });
      const newResults: EmailScanResult[] = [];      // travel results
      const noTravelResults: EmailScanResult[] = []; // for UI display only
      const newProcessedEmails: ProcessedEmail[] = [];

      debugEmailScan(`Scanning ${newEmails.length} new emails (${rawEmails.length} total from Gmail, ${pendingResults.length} pending)`);

      for (const email of newEmails) {
        try {
          debugEmailScan(`Parsing email: "${email.subject}" from ${email.from} (body: ${email.bodyText.length} chars)`);
          const { segments, invalidCount, rawItemCount } = await parser.parseEmail({
            subject: email.subject,
            from: email.from,
            body: email.bodyText,
            receivedAt: email.receivedAt,
          });

          // Three outcomes:
          //   1. Segments extracted → success
          //   2. Claude returned items but ALL failed Zod validation → retryable failure
          //   3. Claude returned no items at all → genuine "no travel content" (skipped)
          const hasTravel = segments.length > 0;
          const validationFailedEverything =
            !hasTravel && rawItemCount > 0 && invalidCount > 0;

          if (hasTravel) {
            debugEmailScan(`  → ${segments.length} segments extracted`);
            if (invalidCount > 0) {
              // Some items dropped — track aggregate signal so we can spot
              // partial-failure patterns even when the email did parse.
              recordParseFailure({
                outcome: "parsed_with_invalid",
                source: "gmail_scan",
                subject: email.subject,
                from: email.from,
                receivedAt: email.receivedAt,
                bodyLength: email.bodyText.length,
                rawItemCount,
                invalidCount,
              });
            }
          } else if (validationFailedEverything) {
            console.warn(
              `  PARSE FAILURE: "${email.subject}" — Claude returned ${rawItemCount} items but all ${invalidCount} failed Zod validation. Marking as "failed" so it will be retried on the next scan.`,
            );
            recordParseFailure({
              outcome: "failed",
              source: "gmail_scan",
              subject: email.subject,
              from: email.from,
              receivedAt: email.receivedAt,
              bodyLength: email.bodyText.length,
              rawItemCount,
              invalidCount,
            });
          } else {
            debugEmailScan(`SKIP: "${email.subject}" (no travel content detected)`);
            recordParseFailure({
              outcome: "no_travel_content",
              source: "gmail_scan",
              subject: email.subject,
              from: email.from,
              receivedAt: email.receivedAt,
              bodyLength: email.bodyText.length,
              rawItemCount,
              invalidCount,
            });
          }

          // Auto-match segments to trips by date, then classify against itinerary
          const matchedSegments = segments.map((seg) => {
            const matchingTrip = tripId
              ? tripsById.get(tripId)
              : trips.find((t) => isDateInRange(seg.date, t.startDate, t.endDate));
            if (!matchingTrip) {
              return { ...seg, match: { status: "new" as const } };
            }
            const match = matchParsedAgainstTrip(seg, matchingTrip);
            return { ...seg, suggestedTripId: matchingTrip.id, match };
          });

          const scanResult: EmailScanResult = {
            emailId: email.id,
            subject: email.subject,
            from: email.from,
            receivedAt: email.receivedAt,
            parsedSegments: matchedSegments,
            parseStatus: hasTravel
              ? "success"
              : validationFailedEverything
                ? "failed"
                : "no_travel_content",
            ...(validationFailedEverything
              ? {
                  error: `Claude returned ${rawItemCount} item(s) but none passed schema validation. See server logs for details.`,
                }
              : {}),
          };

          if (hasTravel) {
            newResults.push(scanResult);
          } else if (validationFailedEverything) {
            // Surface to the UI so the user knows it was attempted.
            newResults.push(scanResult);
          } else {
            noTravelResults.push(scanResult);
          }

          // Remove any prior record for this email — we're about to replace it.
          const idx = processedEmails.findIndex((p) => p.gmailMessageId === email.id);
          if (idx !== -1) processedEmails.splice(idx, 1);

          // Save to processedEmails. Status rules:
          //   - success (travel extracted)            → "parsed"  (saved with results)
          //   - all validation failed                 → "failed"  (retryable, no results)
          //   - no travel at all                      → "skipped" (sticky, no retry)
          newProcessedEmails.push({
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
            rawParseResult: hasTravel ? scanResult : undefined,
            createdAt: new Date().toISOString(),
          });
        } catch (err: unknown) {
          // Detect billing / auth / overloaded errors from Anthropic
          const errMsg = err instanceof Error ? err.message : String(err);
          const errObj = err as Record<string, unknown>;
          const errStatus = typeof errObj.status === "number" ? errObj.status : 0;
          const errType = typeof errObj.type === "string" ? errObj.type : "";
          const isBillingError =
            errMsg.includes("credit balance") ||
            errMsg.includes("billing") ||
            errMsg.includes("too low") ||
            (errStatus === 400 && errMsg.includes("credit"));
          const isAuthError =
            errStatus === 401 ||
            errMsg.includes("authentication") ||
            errMsg.includes("invalid x-api-key") ||
            errMsg.includes("api_key");
          const isOverloadedError =
            errStatus === 529 ||
            errStatus === 503 ||
            errType === "overloaded_error" ||
            errMsg.includes("overloaded") ||
            errMsg.includes("Overloaded");

          // Overloaded errors are transient — log a short message, not the full stack
          if (isOverloadedError) {
            console.warn(
              `  AI service overloaded — halting scan. Email "${email.subject}" will be retried on next scan.`,
            );
          } else {
            console.error(`Failed to parse email ${email.id}:`, err);
            // Only report non-transient exceptions — overloaded / billing /
            // auth are environmental and would otherwise drown the signal.
            if (!isBillingError && !isAuthError) {
              recordParseFailure({
                outcome: "exception",
                source: "gmail_scan",
                subject: email.subject,
                from: email.from,
                receivedAt: email.receivedAt,
                bodyLength: email.bodyText.length,
                errorMessage: errMsg,
              });
              reportError(err, {
                emailId: email.id,
                source: "gmail_scan",
              });
            }
          }

          if (isBillingError || isAuthError || isOverloadedError) {
            const code = isBillingError
              ? "ANTHROPIC_BILLING"
              : isAuthError
                ? "ANTHROPIC_AUTH"
                : "ANTHROPIC_OVERLOADED";
            const userMessage = isBillingError
              ? "The AI service (Anthropic) requires additional credits. Please check your billing at console.anthropic.com."
              : isAuthError
                ? "The AI service API key is invalid or expired. Please update ANTHROPIC_API_KEY."
                : "The AI service is temporarily overloaded. Please try scanning again in a few minutes.";
            const httpStatus = isBillingError ? 402 : isAuthError ? 401 : 503;

            // Save any results we parsed so far before the error
            if (newProcessedEmails.length > 0) {
              await storage.saveProcessedEmails([...processedEmails, ...newProcessedEmails]);
            }

            // Return pending + whatever we parsed before error
            const allResults = [...pendingResults, ...newResults];
            res.status(httpStatus).json({
              error: userMessage,
              code,
              emailsFound: newEmails.length,
              // Include any results we managed to parse before hitting the error
              results: allResults.length > 0 ? allResults : undefined,
            });
            return;
          }

          // Per-email errors: don't save, allow retry on next scan
          newResults.push({
            emailId: email.id,
            subject: email.subject,
            from: email.from,
            receivedAt: email.receivedAt,
            parsedSegments: [],
            parseStatus: "failed",
            error: errMsg,
          });
        }
      }

      // Combine pending + new travel results, then deduplicate
      const allResults = [...pendingResults, ...newResults];
      deduplicateResults(allResults);

      // Append no-travel results for UI display (not persisted as pending)
      allResults.push(...noTravelResults);

      // Save new processed email records
      await storage.saveProcessedEmails([...processedEmails, ...newProcessedEmails]);

      // Save label preference if provided
      if (labelFilter) {
        const settings = await storage.getSettings();
        if (settings.gmailLabelFilter !== labelFilter) {
          settings.gmailLabelFilter = labelFilter;
          await storage.saveSettings(settings);
        }
      }

      res.json({
        results: allResults,
        pendingCount: pendingResults.length,
        newCount: newResults.length,
      });
    } catch (err) {
      console.error("POST /emails/scan error:", err);
      const message = err instanceof Error ? err.message : "Scan failed";
      if (message.includes("insufficient") || message.includes("scope")) {
        res.status(403).json({
          error: "Gmail access not granted",
          code: "GMAIL_SCOPE_REQUIRED",
        });
        return;
      }
      res.status(500).json({ error: message });
    }
  });

  /**
   * POST /emails/import-html
   * Import a raw HTML email (e.g. a saved `.html` file or pasted HTML source),
   * run it through the same Claude parser used for Gmail scanning, and drop
   * the resulting segments into the pending review queue alongside Gmail
   * results. This unblocks users whose mailboxes we can't scan directly.
   *
   * The request synthesizes a processed-email record with a synthetic id
   * ("html-import-<timestamp>-<rand>") so the normal /emails/apply flow can
   * mark it as "mapped" once the user applies the segments.
   */
  router.post("/import-html", async (req: Request, res: Response) => {
    try {
      const parsed = htmlImportRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues });
        return;
      }

      if (!config.anthropic.apiKey) {
        res.status(500).json({ error: "Anthropic API key not configured" });
        return;
      }

      const { html, eml, subject, from, receivedAt, tripId } = parsed.data;
      const storage = getStorage(req);
      const isEmlImport = Boolean(eml);

      // Run through the parser using the same pipeline as Gmail.
      const parser = new EmailParser({ apiKey: config.anthropic.apiKey });
      let segments: ParsedSegment[] = [];
      let invalidCount = 0;
      let rawItemCount = 0;
      // Extracted EML metadata (surfaced in the result so the UI can show
      // the decoded subject/from even when the caller didn't provide them).
      let effectiveSubject = subject;
      let effectiveFrom = from;
      let effectiveReceivedAt = receivedAt;
      try {
        if (isEmlImport) {
          // Pre-extract EML headers so the pending-review record reflects
          // the decoded values (subject/from) even when the caller didn't
          // supply them. The parseEml call below will re-extract internally,
          // but we need these values here for the EmailScanResult envelope.
          const extracted = await EmailParser.emlToEmail(eml!);
          effectiveSubject = subject?.trim() || extracted.subject;
          effectiveFrom = from?.trim() || extracted.from;
          effectiveReceivedAt = receivedAt || extracted.receivedAt;
          const result = await parser.parseEml({
            eml: eml!,
            subject,
            from,
            receivedAt,
          });
          segments = result.segments;
          invalidCount = result.invalidCount;
          rawItemCount = result.rawItemCount;
        } else {
          const result = await parser.parseHtml({
            html: html!,
            subject,
            from,
            receivedAt,
          });
          segments = result.segments;
          invalidCount = result.invalidCount;
          rawItemCount = result.rawItemCount;
        }
      } catch (err: unknown) {
        // Surface Anthropic billing / auth / overloaded errors the same way
        // the scan route does so the UI can show a user-friendly message.
        const errMsg = err instanceof Error ? err.message : String(err);
        const errObj = err as Record<string, unknown>;
        const errStatus = typeof errObj.status === "number" ? errObj.status : 0;
        const errType = typeof errObj.type === "string" ? errObj.type : "";
        const isBillingError =
          errMsg.includes("credit balance") ||
          errMsg.includes("billing") ||
          errMsg.includes("too low") ||
          (errStatus === 400 && errMsg.includes("credit"));
        const isAuthError =
          errStatus === 401 ||
          errMsg.includes("authentication") ||
          errMsg.includes("invalid x-api-key") ||
          errMsg.includes("api_key");
        const isOverloadedError =
          errStatus === 529 ||
          errStatus === 503 ||
          errType === "overloaded_error" ||
          errMsg.includes("overloaded") ||
          errMsg.includes("Overloaded");

        if (isBillingError || isAuthError || isOverloadedError) {
          const code = isBillingError
            ? "ANTHROPIC_BILLING"
            : isAuthError
              ? "ANTHROPIC_AUTH"
              : "ANTHROPIC_OVERLOADED";
          const userMessage = isBillingError
            ? "The AI service (Anthropic) requires additional credits. Please check your billing at console.anthropic.com."
            : isAuthError
              ? "The AI service API key is invalid or expired. Please update ANTHROPIC_API_KEY."
              : "The AI service is temporarily overloaded. Please try importing again in a few minutes.";
          const httpStatus = isBillingError ? 402 : isAuthError ? 401 : 503;
          res.status(httpStatus).json({ error: userMessage, code });
          return;
        }

        console.error("POST /emails/import-html parser error:", err);
        recordParseFailure({
          outcome: "exception",
          source: isEmlImport ? "eml_import" : "html_import",
          subject,
          from,
          receivedAt,
          errorMessage: errMsg,
        });
        reportError(err, { source: isEmlImport ? "eml_import" : "html_import" });
        res.status(500).json({ error: errMsg || "HTML parse failed" });
        return;
      }

      // Auto-match extracted segments to trips by date (or to the caller's
      // hinted trip if provided) and classify against existing itinerary.
      const trips = await storage.listTrips();
      const tripsById = new Map(trips.map((t) => [t.id, t]));
      const matchedSegments = segments.map((seg) => {
        const matchingTrip = tripId
          ? tripsById.get(tripId)
          : trips.find((t) => isDateInRange(seg.date, t.startDate, t.endDate));
        if (!matchingTrip) {
          return { ...seg, match: { status: "new" as const } };
        }
        const match = matchParsedAgainstTrip(seg, matchingTrip);
        return { ...seg, suggestedTripId: matchingTrip.id, match };
      });

      const hasTravel = matchedSegments.length > 0;
      const validationFailedEverything =
        !hasTravel && rawItemCount > 0 && invalidCount > 0;

      const emailId = `${isEmlImport ? "eml" : "html"}-import-${Date.now()}-${generateId()}`;
      const now = new Date().toISOString();
      const result: EmailScanResult = {
        emailId,
        subject:
          effectiveSubject || (isEmlImport ? "(EML import)" : "(HTML import)"),
        from: effectiveFrom || "(unknown sender)",
        receivedAt: effectiveReceivedAt || now,
        parsedSegments: matchedSegments,
        parseStatus: hasTravel
          ? "success"
          : validationFailedEverything
            ? "failed"
            : "no_travel_content",
        ...(validationFailedEverything
          ? {
              error: `Claude returned ${rawItemCount} item(s) but none passed schema validation. See server logs for details.`,
            }
          : {}),
      };

      // Persist the synthetic processed-email record so /emails/apply can
      // later mark it as "mapped" using the same code path as Gmail results.
      // We only store a pending result when we actually extracted segments —
      // no-travel imports don't need to linger in the pending queue.
      if (hasTravel) {
        const processedEmails = await storage.getProcessedEmails();
        processedEmails.push({
          gmailMessageId: emailId,
          gmailThreadId: undefined,
          subject: result.subject,
          fromAddress: result.from,
          receivedAt: result.receivedAt,
          parsedType: matchedSegments[0].type,
          parseStatus: "parsed",
          rawParseResult: result,
          createdAt: now,
        });
        await storage.saveProcessedEmails(processedEmails);
      }

      debugEmailScan(
        `${isEmlImport ? "EML" : "HTML"} import: ${segments.length} segments extracted, ${invalidCount} invalid (rawItems=${rawItemCount}, emailId=${emailId})`,
      );

      // Telemetry: emit on every non-success outcome (and on partial failures
      // where some items were dropped). Source distinguishes EML vs HTML so
      // we can tell which format struggles more.
      const telemetrySource = isEmlImport ? "eml_import" : "html_import";
      if (validationFailedEverything) {
        recordParseFailure({
          outcome: "failed",
          source: telemetrySource,
          subject: result.subject,
          from: result.from,
          receivedAt: result.receivedAt,
          rawItemCount,
          invalidCount,
        });
      } else if (!hasTravel) {
        recordParseFailure({
          outcome: "no_travel_content",
          source: telemetrySource,
          subject: result.subject,
          from: result.from,
          receivedAt: result.receivedAt,
          rawItemCount,
          invalidCount,
        });
      } else if (invalidCount > 0) {
        recordParseFailure({
          outcome: "parsed_with_invalid",
          source: telemetrySource,
          subject: result.subject,
          from: result.from,
          receivedAt: result.receivedAt,
          rawItemCount,
          invalidCount,
        });
      }

      res.status(201).json({ result });
    } catch (err) {
      console.error("POST /emails/import-html error:", err);
      const message = err instanceof Error ? err.message : "HTML import failed";
      res.status(500).json({ error: message });
    }
  });

  /**
   * POST /emails/apply
   * Apply selected parsed segments to trips.
   * Each segment may specify action=create|merge|replace + existingSegmentId.
   */
  router.post("/apply", async (req: Request, res: Response) => {
    try {
      const parsed = applyParsedSegmentsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues });
        return;
      }

      const storage = getStorage(req);
      const createdSegments: Array<{ tripId: string; segmentId: string; title: string }> = [];
      const updatedSegments: Array<{ tripId: string; segmentId: string; title: string; action: "merge" | "replace" }> = [];

      debugEmailScan(`Applying ${parsed.data.segments.length} segments from email scan`);

      // Group segments by trip
      const byTrip = new Map<string, typeof parsed.data.segments>();
      for (const seg of parsed.data.segments) {
        const list = byTrip.get(seg.tripId) || [];
        list.push(seg);
        byTrip.set(seg.tripId, list);
      }

      for (const [tid, segs] of byTrip) {
        const trip = await storage.getTrip(tid);
        if (!trip) {
          console.warn(`  Trip ${tid} not found, skipping ${segs.length} segments`);
          continue;
        }
        debugEmailScan(`  Trip "${trip.title}" (${tid}): applying ${segs.length} segments`);

        for (const seg of segs) {
          const action = seg.action ?? "create";

          // Merge / replace onto an existing segment
          if ((action === "merge" || action === "replace") && seg.existingSegmentId) {
            const target = findSegmentById(trip, seg.existingSegmentId);
            if (!target) {
              console.warn(`    Existing segment ${seg.existingSegmentId} not found — falling back to create`);
            } else {
              if (action === "replace") {
                applySegmentFields(target.segment, seg, { overwrite: true });
              } else {
                applySegmentFields(target.segment, seg, { overwrite: false });
              }
              target.segment.sourceEmailId ??= seg.emailId;
              target.segment.needsReview = true;
              updatedSegments.push({
                tripId: tid,
                segmentId: target.segment.id,
                title: target.segment.title,
                action,
              });
              debugEmailScan(`    ${action === "merge" ? "~" : "↻"} [${seg.type}] "${target.segment.title}" ← ${seg.emailId}`);
              continue;
            }
          }

          // Create new segment
          const day = trip.days.find((d) => d.date === seg.date);
          if (!day) {
            console.warn(`    No day ${seg.date} in trip, skipping "${seg.title}"`);
            continue;
          }

          const segmentId = generateId();
          day.segments.push({
            id: segmentId,
            type: seg.type,
            title: seg.title,
            startTime: seg.startTime,
            endTime: seg.endTime,
            venueName: seg.venueName,
            address: seg.address,
            city: seg.city,
            url: seg.url || undefined,
            confirmationCode: seg.confirmationCode,
            provider: seg.provider,
            departureCity: seg.departureCity,
            arrivalCity: seg.arrivalCity,
            departureAirport: seg.departureAirport,
            arrivalAirport: seg.arrivalAirport,
            carrier: seg.carrier,
            routeCode: seg.routeCode,
            partySize: seg.partySize,
            creditCardHold: seg.creditCardHold,
            seatNumber: seg.seatNumber,
            cabinClass: seg.cabinClass,
            baggageInfo: seg.baggageInfo,
            contactName: seg.contactName,
            phone: seg.phone,
            endDate: seg.endDate,
            portsOfCall: seg.portsOfCall,
            breakfastIncluded: seg.breakfastIncluded,
            cost: seg.cost,
            source: "email_auto",
            sourceEmailId: seg.emailId,
            needsReview: true,
            sortOrder: day.segments.length,
          });

          createdSegments.push({ tripId: tid, segmentId, title: seg.title });
          debugEmailScan(`    + [${seg.type}] "${seg.title}" on ${seg.date} → ${segmentId}`);
        }

        // Auto-fill city on days based on segment destinations
        for (const day of trip.days) {
          if (day.city) continue;
          for (const seg of day.segments) {
            const segCity = seg.type === "flight" ? seg.arrivalCity : seg.city;
            if (segCity) {
              day.city = segCity;
              debugEmailScan(`    City: set ${day.date} → "${segCity}" (from "${seg.title}")`);
              break;
            }
          }
        }
        // Propagate city forward
        let lastCity = "";
        for (const day of trip.days) {
          if (day.city) {
            lastCity = day.city;
          } else if (lastCity) {
            day.city = lastCity;
            debugEmailScan(`    City: propagated ${day.date} → "${lastCity}"`);
          }
        }

        // Cruise per-day port override: a cruise's portsOfCall is the most
        // authoritative city signal for each day of the cruise — override
        // whatever was previously set (auto-filled, propagated, or manually
        // chosen at trip creation time). Sea days become "At Sea".
        const cruiseCityChanges = applyCruisePortsToDayCities(trip);
        for (const change of cruiseCityChanges) {
          debugEmailScan(
            `    City: cruise port ${change.date} → "${change.to}" (was "${change.from || "∅"}")`,
          );
        }

        trip.updatedAt = new Date().toISOString();
        await storage.saveTrip(trip);

        // Mark applied emails as "mapped" and clear rawParseResult
        const processedEmails = await storage.getProcessedEmails();
        const emailIds = new Set(segs.map((s) => s.emailId));
        for (const eid of emailIds) {
          const existing = processedEmails.find((pe) => pe.gmailMessageId === eid);
          if (existing) {
            existing.parseStatus = "mapped";
            existing.tripId = tid;
            existing.rawParseResult = undefined;
          } else {
            processedEmails.push({
              gmailMessageId: eid,
              parseStatus: "mapped",
              tripId: tid,
              createdAt: new Date().toISOString(),
            });
          }
        }
        await storage.saveProcessedEmails(processedEmails);
      }

      debugEmailScan(
        `Apply complete: ${createdSegments.length} created, ${updatedSegments.length} updated`,
      );
      res.status(201).json({ created: createdSegments, updated: updatedSegments });
    } catch (err) {
      console.error("POST /emails/apply error:", err);
      res.status(500).json({ error: "Failed to apply segments" });
    }
  });

  /**
   * GET /emails/processed
   * List previously processed emails.
   */
  router.get("/processed", async (req: Request, res: Response) => {
    try {
      const storage = getStorage(req);
      const emails = await storage.getProcessedEmails();
      res.json(emails);
    } catch (err) {
      console.error("GET /emails/processed error:", err);
      res.status(500).json({ error: "Failed to list processed emails" });
    }
  });

  /**
   * POST /emails/dismiss/:emailId
   * Mark an email as skipped so it won't appear in pending results.
   */
  router.post("/dismiss/:emailId", async (req: Request, res: Response) => {
    try {
      const storage = getStorage(req);
      const { emailId } = req.params;
      const processedEmails = await storage.getProcessedEmails();

      const existing = processedEmails.find((e) => e.gmailMessageId === emailId);
      if (existing) {
        existing.parseStatus = "skipped";
        existing.rawParseResult = undefined;
      } else {
        processedEmails.push({
          gmailMessageId: emailId as string,
          parseStatus: "skipped",
          createdAt: new Date().toISOString(),
        });
      }

      await storage.saveProcessedEmails(processedEmails);
      res.json({ status: "dismissed" });
    } catch (err) {
      console.error("POST /emails/dismiss error:", err);
      res.status(500).json({ error: "Failed to dismiss email" });
    }
  });

  return router;
}
