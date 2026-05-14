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
} from "@itinly/shared";
import type { StorageProvider, StorageResolver } from "../services/storage";
import type { ProcessedEmail } from "../services/processed-email";
import {
  createConnectorResolvers,
  type ConnectorResolvers,
} from "../connectors/resolve";
import { EmailParser } from "../services/email-parser";
import { createEmailScanRateLimiter } from "../middleware/rate-limit";
import { recordParseFailure } from "../services/email-telemetry";
import { reportError } from "../services/monitoring";
import { debugEmailScan } from "../utils/debug-log";
import { recordHistory } from "../services/trip-history";
import { config } from "../config/env";
import { requireGmailAuth } from "../middleware/auth";
import type { TokenStore } from "../services/token-store";
import type { RequestHandler } from "express";
import type { ConnectionProvider } from "../services/connections-store";

/**
 * Parses an optional `?provider=google|microsoft` query param so the
 * UI can pick which mailbox to scan when both providers are
 * connected. Identical helper to the calendar route's version —
 * kept inline rather than shared because the two route files have
 * no other overlap. Unknown values resolve to undefined, preserving
 * the default Microsoft-first auto-pick.
 */
function parseEmailProviderQuery(req: Request): ConnectionProvider | undefined {
  const raw = req.query.provider;
  if (raw === "google" || raw === "microsoft") return raw;
  return undefined;
}

export interface EmailRoutesOptions {
  resolveStorage: StorageResolver | StorageProvider;
  /**
   * Required for routes that hit the Gmail API (`/labels`, `/scan`).
   * When omitted, those routes still mount but reject every request
   * with 503 — useful for tests / dev environments that don't exercise
   * the Gmail flow. The other routes (storage-only) work without it.
   */
  tokenStore?: TokenStore;
  /**
   * Phase 4b-2: pre-built connector resolvers bound to the
   * ConnectionsStore. When omitted (tests, memory mode), falls back
   * to a default factory with no store — every request takes the
   * legacy Gmail-via-`req.gmailAccessToken` path.
   */
  connectorResolvers?: ConnectorResolvers;
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

/** Lowercase alphanumeric word tokens, dropping empties. */
function tokens(s: string | undefined): Set<string> {
  if (!s) return new Set();
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((t) => t.length > 0),
  );
}

/**
 * Looser sibling of `normStr` equality used for names/titles/addresses where
 * one side often carries extra qualifier words ("Villa Fiorita Hotel" vs
 * "Villa Fiorita Boutique Hotel"), formatting decoration ("SEA → CDG" vs
 * "SEA → CDG (Air France 337)"), or a longer postal form of the same address
 * ("Via San Marco, 40, Calatabiano" vs "Via San Marco, 40, 95011 Calatabiano,
 * Italy"). One side being a token subset of the other is the easy case —
 * that's free enrichment, never a conflict. Falls back to Jaccard ≥ 0.6 to
 * catch near-misses where each side has a unique word (e.g. "di" appearing
 * in one Italian hotel name but not the other) without merging clearly
 * different bookings like "Sightseeing tour" and "Dinner at X" (0 token
 * overlap → no match).
 */
function fuzzyTextMatch(
  a: string | undefined,
  b: string | undefined,
): boolean {
  if (!a || !b) return false;
  if (normStr(a) === normStr(b)) return true;
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  if (intersection === 0) return false;
  // Token subset (one side fully contained in the other) → match.
  if (intersection === ta.size || intersection === tb.size) return true;
  // Jaccard similarity — 0.6 is high enough that 3-of-4 word matches but
  // 2-of-5 doesn't.
  const union = ta.size + tb.size - intersection;
  return intersection / union >= 0.6;
}

/**
 * Segment types that all represent "a scheduled experience at a venue".
 * Claude's parser and a human entering segments manually frequently disagree
 * on the precise subtype here — a Broadway booking might land in the trip as
 * `activity` (manual) while the confirmation email parses as `show`; a wine
 * tasting at a vineyard might be `activity` one way and `tour` the other;
 * a dinner reservation might be `activity` (manual) vs `restaurant_dinner`
 * (parsed). Letting matches cross within this cluster avoids surfacing
 * those as duplicate "New" rows just because the type label differs.
 */
const EXPERIENCE_TYPES = new Set<string>([
  "activity",
  "tour",
  "show",
  "restaurant_breakfast",
  "restaurant_brunch",
  "restaurant_lunch",
  "restaurant_dinner",
]);

/**
 * The meal-of-day subtypes are intentionally NOT cross-matched against each
 * other. A `restaurant_lunch` and a `restaurant_dinner` at the same venue on
 * the same day are real distinct bookings the user would not want collapsed.
 */
const RESTAURANT_TYPES = new Set<string>([
  "restaurant_breakfast",
  "restaurant_brunch",
  "restaurant_lunch",
  "restaurant_dinner",
]);

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

/**
 * Fields where one side legitimately carries extra qualifier words / postal
 * formatting / display decoration that shouldn't be flagged as a conflict.
 * See `fuzzyTextMatch` for the rule (subset OR Jaccard ≥ 0.6).
 */
const FUZZY_TEXT_FIELDS = new Set<ComparableField>([
  "title",
  "venueName",
  "address",
]);

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
    if (FUZZY_TEXT_FIELDS.has(field)) {
      return fuzzyTextMatch(a, b);
    }
    return normStr(a) === normStr(b);
  }
  return false;
}

/** Does this existing segment look like the same booking as the parsed one? */
function isCandidateMatch(existing: Segment, parsed: ParsedSegment, existingDate: string): boolean {
  // Type must match, OR both types must sit in the EXPERIENCE_TYPES cluster
  // (activity/tour/show/restaurant_*) — see the comment on EXPERIENCE_TYPES
  // for why. Cross-matching between two restaurant_* meal subtypes is
  // explicitly disallowed: a lunch and a dinner at the same venue on the
  // same day are real distinct bookings.
  if (existing.type !== parsed.type) {
    if (!EXPERIENCE_TYPES.has(existing.type) || !EXPERIENCE_TYPES.has(parsed.type)) return false;
    if (RESTAURANT_TYPES.has(existing.type) && RESTAURANT_TYPES.has(parsed.type)) return false;
  }

  // Confirmation code match is the strongest signal for non-flight types,
  // where one PNR/confirmation = one booking. Flights are different: a
  // round-trip PNR is shared across both legs (and a multi-city PNR across
  // every leg), so a confirmation-code-only match would collapse e.g. the
  // outbound SEA→ONT leg onto the return ONT→SEA leg. For flights, we
  // fall through to the date + route/city checks below; a matching PNR on
  // the same date with the same direction will naturally satisfy them.
  if (
    parsed.type !== "flight" &&
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
  // check-in and existing could be stored on any of the nights. fuzzyTextMatch
  // tolerates extra qualifier words ("Boutique") and case/punct differences
  // ("Castello di San Marco" vs "Castello San Marco").
  if (parsed.type === "hotel") {
    return fuzzyTextMatch(parsed.venueName, existing.venueName);
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
    return fuzzyTextMatch(parsed.title, existing.title);
  }

  // Restaurants / activities / tours / shows: same date + fuzzy venue or title.
  if (existingDate !== parsed.date) return false;
  if (
    parsed.venueName &&
    existing.venueName &&
    fuzzyTextMatch(parsed.venueName, existing.venueName)
  ) {
    return true;
  }
  return fuzzyTextMatch(parsed.title, existing.title);
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

/**
 * Prefix for always-on email-flow log lines so production logs in
 * Railway can be traced back to a specific user / trip. Mirrors the
 * pattern used by `[calendar-sync ...]` in `services/google-calendar.ts`.
 *
 * Use console.log directly (not `debugEmailScan`) for milestones the
 * user actually wants visible without setting DEBUG_EMAIL_SCAN=1:
 * scan start / Gmail-fetch result / per-email skip + outcome /
 * import / apply summaries. Verbose mechanics (dedup detail,
 * per-segment apply minutiae) stay behind `debugEmailScan`.
 */
function emailLogPrefix(
  scope: "email-scan" | "email-import" | "email-apply",
  userEmail: string | undefined,
  trip?: { id: string; title: string },
): string {
  const email = userEmail ?? "anon";
  const tripPart = trip ? ` trip:${trip.id} "${trip.title}"` : "";
  return `[${scope} ${email}${tripPart}]`;
}

export function createEmailRoutes(options: EmailRoutesOptions): Router {
  const { resolveStorage, tokenStore } = options;
  const resolvers =
    options.connectorResolvers ?? createConnectorResolvers({});

  const getStorage: StorageResolver =
    typeof resolveStorage === "function"
      ? resolveStorage
      : () => resolveStorage;

  const router = Router();

  // Routes that hit the Gmail API need an access token from the *Gmail*
  // OAuth client, not the primary one. `requireGmailAuth` looks up the
  // user's stored Gmail refresh token, refreshes it, and attaches the
  // result as `req.gmailAccessToken`. When no TokenStore is wired up
  // (memory-mode tests / local dev without persistence), the guard
  // becomes a pass-through — the GmailScanner is mocked in tests, and
  // memory-mode dev doesn't exercise the real Gmail API anyway. The
  // Gmail-link / refresh path is wired up only in `mode: "drive"`.
  const gmailGuard: RequestHandler = tokenStore
    ? requireGmailAuth(tokenStore)
    : (_req, _res, next) => next();

  /**
   * GET /emails/labels
   * List Gmail labels for the authenticated user.
   */
  router.get("/labels", gmailGuard, async (req: Request, res: Response) => {
    try {
      const resolved = await resolvers.resolveEmailConnector(
        req,
        parseEmailProviderQuery(req),
      );
      if (!resolved) {
        res.status(401).json({
          error: "Email not connected",
          code: "EMAIL_NOT_CONNECTED",
        });
        return;
      }
      const labels = await resolved.connector.listLabels();

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
  router.post("/scan", scanRateLimiter, gmailGuard, async (req: Request, res: Response) => {
    // Declared outside the try so the catch block at the bottom can
    // include it in error logs without falling out of scope.
    const scanPrefix = emailLogPrefix("email-scan", req.userEmail);
    try {
      const parsed = emailScanRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues });
        return;
      }

      const {
        tripId,
        labelFilter,
        maxResults,
        newerThanDays,
        forceRescan,
        provider: preferProvider,
      } = parsed.data;
      const storage = getStorage(req);
      console.log(
        `${scanPrefix} Starting scan (label=${labelFilter || "none"}, maxResults=${maxResults ?? 100}, newerThanDays=${newerThanDays ?? 365}, forceRescan=${!!forceRescan}${tripId ? `, tripId=${tripId}` : ""})`,
      );

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

      // Scan via the provider-agnostic resolver — picks Google or
      // Microsoft based on the user's `connections` (phase 4b-2),
      // with the legacy `req.gmailAccessToken` fallback for users
      // still on the pre-Supabase auth path. Capture the provider +
      // account metadata so we can stamp each ProcessedEmail with
      // it — helps observability + supports a future multi-mailbox
      // picker.
      const resolved = await resolvers.resolveEmailConnector(req, preferProvider);
      if (!resolved) {
        res.status(401).json({
          error: "Email not connected",
          code: "EMAIL_NOT_CONNECTED",
        });
        return;
      }
      const { connector, provider: emailProvider, accountEmail } = resolved;
      const effectiveMaxResults = maxResults ?? 100;
      const rawEmails = await connector.scanEmails({
        labelFilter,
        maxResults: effectiveMaxResults,
        newerThanDays: newerThanDays ?? 365,
        logPrefix: scanPrefix,
      });

      console.log(
        `${scanPrefix} mailbox returned ${rawEmails.length} email(s) (maxResults=${effectiveMaxResults}, labelFilter=${labelFilter || "none"})`,
      );
      if (rawEmails.length >= effectiveMaxResults) {
        console.warn(
          `${scanPrefix} NOTE: hit the maxResults cap (${effectiveMaxResults}). Older matching emails may be missing — consider increasing maxResults or narrowing with a labelFilter.`,
        );
      }

      // Whether a prior `mapped` record still points at a live trip.
      // If the trip was deleted, the segment that lived there is gone
      // too — so the email should be re-parsed and surfaced as new.
      // Without this check, scanning silently skips emails forever
      // even though their target trip no longer exists, and the user
      // has no way to recover them short of `forceRescan` (which
      // historically refused too — see below).
      const mappedTripStillExists = (prior: ProcessedEmail): boolean =>
        prior.parseStatus === "mapped" &&
        !!prior.tripId &&
        tripsById.has(prior.tripId);

      // Filter which emails to (re)parse. Default policy:
      //   - never seen before                → parse
      //   - prior "failed"                   → retry automatically (a previous
      //                                        code bug or transient error may
      //                                        have blocked it)
      //   - prior "skipped"                  → do NOT retry unless forceRescan
      //   - prior "parsed"                   → already have results, skip
      //                                        (returned via `pendingResults`)
      //   - prior "mapped" (live trip)       → already applied, skip
      //   - prior "mapped" (trip deleted)    → re-parse (segment is gone)
      // When forceRescan=true, retry ALL prior statuses including
      // "mapped" — historically we refused but the only honest reason
      // to ever skip a "mapped" email is "the segment is still in
      // the trip," which is not what the user asked for when they
      // explicitly toggled forceRescan.
      const newEmails = rawEmails.filter((e) => {
        const prior = processedMap.get(e.id);
        if (!prior) return true;

        if (forceRescan) {
          // The "mapped + live-trip" case is the only one where we
          // could plausibly skip — but a forceRescan caller has
          // explicitly opted into "redo everything," so honor that
          // intent. The applied segment can be deduped at apply
          // time via `match.status === "duplicate"`.
          console.log(`${scanPrefix} Retrying "${e.subject}" (forceRescan, prior=${prior.parseStatus})`);
          return true;
        }

        // Auto-retry prior failed status — previous attempt errored and the
        // code that caused it may have been fixed since.
        if (prior.parseStatus === "failed") {
          console.log(`${scanPrefix} Retrying "${e.subject}" (previously failed — retrying)`);
          return true;
        }

        // Trip-deleted recovery: a prior `mapped` whose target trip
        // no longer exists is treated like a brand-new email. The
        // mapping is stale; the segment isn't anywhere.
        if (prior.parseStatus === "mapped" && !mappedTripStillExists(prior)) {
          console.log(`${scanPrefix} Re-parsing "${e.subject}" (was applied to trip ${prior.tripId ?? "?"}, but that trip no longer exists)`);
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
        console.log(`${scanPrefix} Skipped "${e.subject}" (${reason})`);
        return false;
      });

      // If no new emails to parse, just return pending results
      if (newEmails.length === 0) {
        if (pendingResults.length > 0) {
          console.log(`${scanPrefix} Done: 0 new, ${pendingResults.length} pending result(s) returned`);
          res.json({ results: pendingResults, pendingCount: pendingResults.length, newCount: 0 });
        } else {
          console.log(`${scanPrefix} Done: 0 new emails to process`);
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

      console.log(`${scanPrefix} Parsing ${newEmails.length} new email(s) (${rawEmails.length} total from mailbox, ${pendingResults.length} pending)`);

      for (const email of newEmails) {
        try {
          console.log(`${scanPrefix} Parsing "${email.subject}" from ${email.from} (body: ${email.bodyText.length} chars)`);
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
            console.log(
              `${scanPrefix} Parsed "${email.subject}" → ${segments.length} segment(s)${invalidCount > 0 ? ` (${invalidCount} invalid item(s) dropped)` : ""}`,
            );
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
              `${scanPrefix} Parse failure for "${email.subject}" — Claude returned ${rawItemCount} item(s) but all ${invalidCount} failed Zod validation. Marking as "failed" so it will be retried on the next scan.`,
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
            console.log(`${scanPrefix} Skipped "${email.subject}" (no travel content detected)`);
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
            provider: emailProvider,
            accountEmail,
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
          // 429 rate_limit_error is treated like overloaded: same
          // "transient, try again later" UX, same halt-and-return-
          // partial-results behaviour. Anthropic's SDK does its own
          // internal retries for 429 before throwing, so if we see
          // one here the user is genuinely over a TPM/RPM budget for
          // the moment and hammering more email parses just digs
          // the hole deeper.
          const isOverloadedError =
            errStatus === 529 ||
            errStatus === 503 ||
            errStatus === 429 ||
            errType === "overloaded_error" ||
            errType === "rate_limit_error" ||
            errMsg.includes("overloaded") ||
            errMsg.includes("Overloaded") ||
            errMsg.includes("rate_limit") ||
            errMsg.includes("rate limit");

          // Overloaded errors are transient — log a short message, not the full stack
          if (isOverloadedError) {
            console.warn(
              `${scanPrefix} AI service overloaded — halting scan. Email "${email.subject}" will be retried on next scan.`,
            );
          } else {
            console.error(`${scanPrefix} Failed to parse "${email.subject}" (${email.id}):`, err);
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

      // Bucket the new processed records by parseStatus so the summary
      // matches what'll be visible to the user (and what triage cares
      // about): how many actually produced segments vs were dropped vs
      // failed mid-parse.
      const parsedCount = newProcessedEmails.filter((p) => p.parseStatus === "parsed").length;
      const noTravelCount = newProcessedEmails.filter((p) => p.parseStatus === "skipped").length;
      const failedCount = newProcessedEmails.filter((p) => p.parseStatus === "failed").length;
      console.log(
        `${scanPrefix} Done: ${parsedCount} parsed, ${noTravelCount} no-travel, ${failedCount} failed (${pendingResults.length} pending result(s) carried over)`,
      );

      res.json({
        results: allResults,
        pendingCount: pendingResults.length,
        newCount: newResults.length,
      });
    } catch (err) {
      console.error(`${scanPrefix} POST /emails/scan error:`, err);
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
   * POST /emails/scan/stream
   * Same scan + parse pipeline as POST /emails/scan, but streamed as
   * Server-Sent Events so the UI can render progress while parsing
   * is in flight (which can take minutes for a multi-dozen-email
   * mailbox). Event types:
   *   - `found`  { total }                 — once `connector.scanEmails()`
   *                                          returns, before any parse work.
   *   - `plan`   { newCount, pendingCount } — after filtering already-
   *                                          processed emails out.
   *   - `progress` { parsed, total,
   *                  subject, from }       — emitted BEFORE each parse so
   *                                          the user sees movement.
   *   - `done`   { results, pendingCount,
   *                newCount, message? }    — final state, identical shape
   *                                          to the JSON /scan response.
   *   - `error`  { status, error, code?,
   *                emailsFound?, results? } — corresponds to a non-2xx
   *                                          JSON response; the client
   *                                          should branch on `code`
   *                                          (same handling as /scan).
   *
   * Auth/connector/rate-limit guards mirror /scan exactly.
   */
  router.post("/scan/stream", scanRateLimiter, gmailGuard, async (req: Request, res: Response) => {
    const scanPrefix = emailLogPrefix("email-scan", req.userEmail);

    // Validate before opening the SSE stream — once headers are sent
    // we can't return a 400 JSON body, so do the cheap check first.
    const parsed = emailScanRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }

    // SSE setup. `X-Accel-Buffering: no` disables buffering on Nginx/
    // proxies (Railway's edge included) so events flush promptly
    // instead of pooling in a transport buffer.
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    let clientClosed = false;
    req.on("close", () => {
      clientClosed = true;
    });

    // Heartbeat keeps idle proxies from severing the connection during
    // long Claude parses (per-email can take 10–20 s; an unbuffered
    // intermediary may time out after 30–60 s of silence).
    const heartbeat = setInterval(() => {
      if (clientClosed) return;
      res.write(`: ping\n\n`);
    }, 15000);

    const emit = (event: string, data: Record<string, unknown>): void => {
      if (clientClosed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const {
        tripId,
        labelFilter,
        maxResults,
        newerThanDays,
        forceRescan,
        provider: preferProvider,
      } = parsed.data;
      const storage = getStorage(req);
      console.log(
        `${scanPrefix} Starting stream scan (label=${labelFilter || "none"}, maxResults=${maxResults ?? 100}, newerThanDays=${newerThanDays ?? 365}, forceRescan=${!!forceRescan}${tripId ? `, tripId=${tripId}` : ""})`,
      );

      const processedEmails = await storage.getProcessedEmails();
      const processedMap = new Map(processedEmails.map((e) => [e.gmailMessageId, e]));
      const trips = await storage.listTrips();
      const tripsById = new Map(trips.map((t) => [t.id, t]));

      const pendingResults: EmailScanResult[] = [];
      for (const pe of processedEmails) {
        if (pe.parseStatus === "parsed" && pe.rawParseResult) {
          const stored = pe.rawParseResult as EmailScanResult;
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

      const resolved = await resolvers.resolveEmailConnector(req);
      if (!resolved) {
        emit("error", {
          status: 401,
          error: "Email not connected",
          code: "EMAIL_NOT_CONNECTED",
        });
        return;
      }
      const { connector, provider: emailProvider, accountEmail } = resolved;
      const effectiveMaxResults = maxResults ?? 100;
      const rawEmails = await connector.scanEmails({
        labelFilter,
        maxResults: effectiveMaxResults,
        newerThanDays: newerThanDays ?? 365,
        logPrefix: scanPrefix,
      });

      console.log(
        `${scanPrefix} mailbox returned ${rawEmails.length} email(s) (maxResults=${effectiveMaxResults}, labelFilter=${labelFilter || "none"})`,
      );
      emit("found", { total: rawEmails.length });
      if (rawEmails.length >= effectiveMaxResults) {
        console.warn(
          `${scanPrefix} NOTE: hit the maxResults cap (${effectiveMaxResults}). Older matching emails may be missing — consider increasing maxResults or narrowing with a labelFilter.`,
        );
      }

      const mappedTripStillExists = (prior: ProcessedEmail): boolean =>
        prior.parseStatus === "mapped" &&
        !!prior.tripId &&
        tripsById.has(prior.tripId);

      const newEmails = rawEmails.filter((e) => {
        const prior = processedMap.get(e.id);
        if (!prior) return true;
        if (forceRescan) {
          console.log(`${scanPrefix} Retrying "${e.subject}" (forceRescan, prior=${prior.parseStatus})`);
          return true;
        }
        if (prior.parseStatus === "failed") {
          console.log(`${scanPrefix} Retrying "${e.subject}" (previously failed — retrying)`);
          return true;
        }
        if (prior.parseStatus === "mapped" && !mappedTripStillExists(prior)) {
          console.log(`${scanPrefix} Re-parsing "${e.subject}" (was applied to trip ${prior.tripId ?? "?"}, but that trip no longer exists)`);
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
        console.log(`${scanPrefix} Skipped "${e.subject}" (${reason})`);
        return false;
      });

      emit("plan", { newCount: newEmails.length, pendingCount: pendingResults.length });

      if (newEmails.length === 0) {
        if (pendingResults.length > 0) {
          console.log(`${scanPrefix} Done: 0 new, ${pendingResults.length} pending result(s) returned`);
          emit("done", { results: pendingResults, pendingCount: pendingResults.length, newCount: 0 });
        } else {
          console.log(`${scanPrefix} Done: 0 new emails to process`);
          emit("done", { results: [], message: "No new emails to process" });
        }
        return;
      }

      if (!config.anthropic.apiKey) {
        emit("error", { status: 500, error: "Anthropic API key not configured" });
        return;
      }

      const parser = new EmailParser({ apiKey: config.anthropic.apiKey });
      const newResults: EmailScanResult[] = [];
      const noTravelResults: EmailScanResult[] = [];
      const newProcessedEmails: ProcessedEmail[] = [];

      console.log(`${scanPrefix} Parsing ${newEmails.length} new email(s) (${rawEmails.length} total from mailbox, ${pendingResults.length} pending)`);

      for (let i = 0; i < newEmails.length; i++) {
        if (clientClosed) {
          console.log(`${scanPrefix} Client disconnected mid-scan — stopping after ${i}/${newEmails.length}`);
          break;
        }
        const email = newEmails[i];
        emit("progress", {
          parsed: i,
          total: newEmails.length,
          subject: email.subject,
          from: email.from,
        });
        try {
          console.log(`${scanPrefix} Parsing "${email.subject}" from ${email.from} (body: ${email.bodyText.length} chars)`);
          const { segments, invalidCount, rawItemCount } = await parser.parseEmail({
            subject: email.subject,
            from: email.from,
            body: email.bodyText,
            receivedAt: email.receivedAt,
          });

          const hasTravel = segments.length > 0;
          const validationFailedEverything =
            !hasTravel && rawItemCount > 0 && invalidCount > 0;

          if (hasTravel) {
            console.log(
              `${scanPrefix} Parsed "${email.subject}" → ${segments.length} segment(s)${invalidCount > 0 ? ` (${invalidCount} invalid item(s) dropped)` : ""}`,
            );
            if (invalidCount > 0) {
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
              `${scanPrefix} Parse failure for "${email.subject}" — Claude returned ${rawItemCount} item(s) but all ${invalidCount} failed Zod validation. Marking as "failed" so it will be retried on the next scan.`,
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
            console.log(`${scanPrefix} Skipped "${email.subject}" (no travel content detected)`);
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
            newResults.push(scanResult);
          } else {
            noTravelResults.push(scanResult);
          }

          const idx = processedEmails.findIndex((p) => p.gmailMessageId === email.id);
          if (idx !== -1) processedEmails.splice(idx, 1);

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
            provider: emailProvider,
            accountEmail,
            createdAt: new Date().toISOString(),
          });
        } catch (err: unknown) {
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
          // 429 rate_limit_error is treated like overloaded: same
          // "transient, try again later" UX, same halt-and-return-
          // partial-results behaviour. Anthropic's SDK does its own
          // internal retries for 429 before throwing, so if we see
          // one here the user is genuinely over a TPM/RPM budget for
          // the moment and hammering more email parses just digs
          // the hole deeper.
          const isOverloadedError =
            errStatus === 529 ||
            errStatus === 503 ||
            errStatus === 429 ||
            errType === "overloaded_error" ||
            errType === "rate_limit_error" ||
            errMsg.includes("overloaded") ||
            errMsg.includes("Overloaded") ||
            errMsg.includes("rate_limit") ||
            errMsg.includes("rate limit");

          if (isOverloadedError) {
            console.warn(
              `${scanPrefix} AI service overloaded — halting scan. Email "${email.subject}" will be retried on next scan.`,
            );
          } else {
            console.error(`${scanPrefix} Failed to parse "${email.subject}" (${email.id}):`, err);
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

            if (newProcessedEmails.length > 0) {
              await storage.saveProcessedEmails([...processedEmails, ...newProcessedEmails]);
            }

            const allResults = [...pendingResults, ...newResults];
            emit("error", {
              status: httpStatus,
              error: userMessage,
              code,
              emailsFound: newEmails.length,
              results: allResults.length > 0 ? allResults : undefined,
            });
            return;
          }

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

      // Final progress tick so the UI shows "Parsed N of N" before
      // flipping to the review screen — without this the last email's
      // name lingers as if still in-flight.
      emit("progress", {
        parsed: newEmails.length,
        total: newEmails.length,
      });

      const allResults = [...pendingResults, ...newResults];
      deduplicateResults(allResults);
      allResults.push(...noTravelResults);

      await storage.saveProcessedEmails([...processedEmails, ...newProcessedEmails]);

      if (labelFilter) {
        const settings = await storage.getSettings();
        if (settings.gmailLabelFilter !== labelFilter) {
          settings.gmailLabelFilter = labelFilter;
          await storage.saveSettings(settings);
        }
      }

      const parsedCount = newProcessedEmails.filter((p) => p.parseStatus === "parsed").length;
      const noTravelCount = newProcessedEmails.filter((p) => p.parseStatus === "skipped").length;
      const failedCount = newProcessedEmails.filter((p) => p.parseStatus === "failed").length;
      console.log(
        `${scanPrefix} Done: ${parsedCount} parsed, ${noTravelCount} no-travel, ${failedCount} failed (${pendingResults.length} pending result(s) carried over)`,
      );

      emit("done", {
        results: allResults,
        pendingCount: pendingResults.length,
        newCount: newResults.length,
      });
    } catch (err) {
      console.error(`${scanPrefix} POST /emails/scan/stream error:`, err);
      const message = err instanceof Error ? err.message : "Scan failed";
      if (message.includes("insufficient") || message.includes("scope")) {
        emit("error", {
          status: 403,
          error: "Gmail access not granted",
          code: "GMAIL_SCOPE_REQUIRED",
        });
      } else {
        emit("error", { status: 500, error: message });
      }
    } finally {
      clearInterval(heartbeat);
      if (!clientClosed) res.end();
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
    // Declared outside the try so the catch block at the bottom can
    // include it in error logs without falling out of scope.
    const importPrefix = emailLogPrefix("email-import", req.userEmail);
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
      const sourceLength = isEmlImport ? eml!.length : html!.length;
      console.log(
        `${importPrefix} Importing ${isEmlImport ? "EML" : "HTML"} "${subject ?? "(no subject)"}" from ${from ?? "(no sender)"} (${sourceLength} chars${tripId ? `, tripId=${tripId}` : ""})`,
      );

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
        // 429 rate_limit_error is treated like overloaded — see the
        // matching block in the scan handlers for rationale.
        const isOverloadedError =
          errStatus === 529 ||
          errStatus === 503 ||
          errStatus === 429 ||
          errType === "overloaded_error" ||
          errType === "rate_limit_error" ||
          errMsg.includes("overloaded") ||
          errMsg.includes("Overloaded") ||
          errMsg.includes("rate_limit") ||
          errMsg.includes("rate limit");

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

        console.error(`${importPrefix} POST /emails/import-html parser error:`, err);
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

      console.log(
        `${importPrefix} Done: "${effectiveSubject ?? "(no subject)"}" → ${segments.length} segment(s)${invalidCount > 0 ? `, ${invalidCount} invalid` : ""} (rawItems=${rawItemCount}, emailId=${emailId})`,
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
      console.error(`${importPrefix} POST /emails/import-html error:`, err);
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
    // Declared outside the try so the catch block can use it for the
    // error log too — otherwise the prefix would be out of scope.
    const applyPrefix = emailLogPrefix("email-apply", req.userEmail);
    try {
      const parsed = applyParsedSegmentsSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues });
        return;
      }

      const storage = getStorage(req);
      const createdSegments: Array<{ tripId: string; segmentId: string; title: string }> = [];
      const updatedSegments: Array<{ tripId: string; segmentId: string; title: string; action: "merge" | "replace" }> = [];

      console.log(`${applyPrefix} Applying ${parsed.data.segments.length} segment(s) from email scan`);

      // Group segments by trip
      const byTrip = new Map<string, typeof parsed.data.segments>();
      for (const seg of parsed.data.segments) {
        const list = byTrip.get(seg.tripId) || [];
        list.push(seg);
        byTrip.set(seg.tripId, list);
      }

      // Upfront date-range validation. A `create` action with a date outside
      // the chosen trip's startDate..endDate window is a user mistake — the
      // segment can't land on a day that doesn't exist, and we used to
      // silently drop it (the email got marked `mapped` but no segment was
      // created, so the booking just vanished). Reject the whole request so
      // the UI can surface a specific message and let the user either pick
      // a different trip or fix the date. Merge / replace actions target an
      // existing segment that's already on a real day, so `seg.date` is
      // irrelevant for them and they're skipped here.
      const outOfRange: Array<{
        tripId: string;
        tripTitle: string;
        tripStartDate: string;
        tripEndDate: string;
        emailId: string;
        title: string;
        date: string;
      }> = [];
      const tripsForApply = new Map<string, Trip>();
      for (const [tid, segs] of byTrip) {
        const trip = await storage.getTrip(tid);
        if (!trip) continue; // surfaced as a per-trip warning + skip below
        tripsForApply.set(tid, trip);
        for (const seg of segs) {
          const action = seg.action ?? "create";
          if (action !== "create") continue;
          if (!isDateInRange(seg.date, trip.startDate, trip.endDate)) {
            outOfRange.push({
              tripId: tid,
              tripTitle: trip.title,
              tripStartDate: trip.startDate,
              tripEndDate: trip.endDate,
              emailId: seg.emailId,
              title: seg.title,
              date: seg.date,
            });
          }
        }
      }
      if (outOfRange.length > 0) {
        const first = outOfRange[0];
        const message =
          outOfRange.length === 1
            ? `"${first.title}" on ${first.date} is outside "${first.tripTitle}" (${first.tripStartDate} – ${first.tripEndDate}). Pick a different trip or fix the date.`
            : `${outOfRange.length} segments fall outside the selected trip's date range. Pick a different trip or fix the date.`;
        console.warn(
          `${applyPrefix} Rejecting apply: ${outOfRange.length} segment(s) out of range — ${outOfRange
            .map(
              (o) =>
                `"${o.title}" ${o.date} not in "${o.tripTitle}" ${o.tripStartDate}..${o.tripEndDate}`,
            )
            .join("; ")}`,
        );
        res.status(400).json({
          error: message,
          code: "OUT_OF_RANGE",
          segments: outOfRange,
        });
        return;
      }

      for (const [tid, segs] of byTrip) {
        const trip = tripsForApply.get(tid);
        if (!trip) {
          console.warn(`${applyPrefix} Trip ${tid} not found, skipping ${segs.length} segment(s)`);
          continue;
        }
        const tripApplyPrefix = emailLogPrefix("email-apply", req.userEmail, trip);
        console.log(`${tripApplyPrefix} Applying ${segs.length} segment(s)`);
        const createdBeforeThisTrip = createdSegments.length;
        const updatedBeforeThisTrip = updatedSegments.length;

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

        // Auto-fill city on days based on segment destinations.
        // Priority: hotel (where you sleep) > in-destination events
        // (activities, restaurants, shows, tours) > arrival cities of
        // long-haul transport (flights, trains) > pickup locations of
        // local transport (car rental, car service, other transport).
        // A flight that lands at ONT and a car rental picked up at ONT
        // shouldn't override a hotel in Palm Desert on the same day —
        // the hotel is the authoritative signal for "where am I today".
        // Cruise days are handled by applyCruisePortsToDayCities below.
        const cityPriority: Record<Segment["type"], number> = {
          hotel: 0,
          activity: 1,
          show: 1,
          tour: 1,
          restaurant_breakfast: 1,
          restaurant_brunch: 1,
          restaurant_lunch: 1,
          restaurant_dinner: 1,
          flight: 2,
          train: 2,
          car_rental: 3,
          car_service: 3,
          other_transport: 3,
          cruise: 3,
        };
        for (const day of trip.days) {
          if (day.city) continue;
          // Pick the day's city by precedence + recency:
          //   - Lower priority value wins outright (activities/hotels
          //     beat flights beat cars — non-transport is the strongest
          //     "where are you THIS day" signal).
          //   - Same priority → later startTime wins. This is what
          //     makes a layover flight (MIA→LAX 8am, LAX→SEA noon)
          //     report Seattle as the day's city instead of LAX,
          //     regardless of the order segments were inserted into
          //     `day.segments`. Same rule covers the "two dinners in
          //     two cities" edge case — the later one is where the
          //     traveler ends the day.
          let best: {
            city: string;
            priority: number;
            startTime: string;
            title: string;
          } | null = null;
          for (const seg of day.segments) {
            const segCity = seg.type === "flight" ? seg.arrivalCity : seg.city;
            if (!segCity) continue;
            const priority = cityPriority[seg.type];
            const startTime = seg.startTime ?? "";
            const wins =
              best === null ||
              priority < best.priority ||
              (priority === best.priority && startTime > best.startTime);
            if (wins) {
              best = { city: segCity, priority, startTime, title: seg.title };
            }
          }
          if (best) {
            day.city = best.city;
            debugEmailScan(`    City: set ${day.date} → "${best.city}" (from "${best.title}")`);
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

        const newCreated = createdSegments.length - createdBeforeThisTrip;
        const newUpdated = updatedSegments.length - updatedBeforeThisTrip;
        if (newCreated > 0 || newUpdated > 0) {
          const summaryParts: string[] = [];
          if (newCreated > 0) {
            summaryParts.push(`${newCreated} new segment${newCreated === 1 ? "" : "s"}`);
          }
          if (newUpdated > 0) {
            summaryParts.push(`${newUpdated} updated segment${newUpdated === 1 ? "" : "s"}`);
          }
          recordHistory(
            trip,
            req,
            "bulk.email_apply",
            `Applied ${summaryParts.join(" and ")} from email scan`,
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

      console.log(
        `${applyPrefix} Done: ${createdSegments.length} created, ${updatedSegments.length} updated`,
      );
      res.status(201).json({ created: createdSegments, updated: updatedSegments });
    } catch (err) {
      console.error(`${applyPrefix} POST /emails/apply error:`, err);
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
