import { Router, type Request, type Response } from "express";
import {
  emailScanRequestSchema,
  applyParsedSegmentsSchema,
  generateId,
  isDateInRange,
  type EmailScanResult,
  type ParsedSegment,
} from "@travel-app/shared";
import type { StorageProvider, StorageResolver } from "../services/storage";
import type { ProcessedEmail } from "../services/google-drive/drive-storage";
import { GmailScanner } from "../services/gmail-scanner";
import { EmailParser } from "../services/email-parser";
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
    "url", "startTime", "endTime", "breakfastIncluded", "cabinClass", "baggageInfo",
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

  for (const [, group] of groups) {
    if (group.length <= 1) continue;

    // Merge all into the first one
    let merged = group[0].seg;
    for (let i = 1; i < group.length; i++) {
      merged = mergeSegments(merged, group[i].seg) as ParsedSegment & { emailId: string };
      toRemove.add(`${group[i].resultIdx}:${group[i].segIdx}`);
    }

    const winnerKey = `${group[0].resultIdx}:${group[0].segIdx}`;
    replacements.set(winnerKey, merged);
    console.log(`  Dedup: merged ${group.length} segments → "${merged.title}" (${merged.seatNumber || "no seats"})`);
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
      const results: EmailScanResult[] = pendingEmails.map((pe) => {
        const stored = pe.rawParseResult as EmailScanResult;
        // Re-run trip matching with current trips (user may have created new trips)
        const rematchedSegments = stored.parsedSegments.map((seg) => {
          const matchingTrip = trips.find((t) =>
            isDateInRange(seg.date, t.startDate, t.endDate),
          );
          return matchingTrip
            ? { ...seg, suggestedTripId: matchingTrip.id }
            : { ...seg, suggestedTripId: undefined };
        });
        return { ...stored, parsedSegments: rematchedSegments };
      });

      console.log(`Returning ${results.length} pending email results`);
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
   */
  router.post("/scan", async (req: Request, res: Response) => {
    try {
      const parsed = emailScanRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues });
        return;
      }

      const { tripId, labelFilter, maxResults, newerThanDays } = parsed.data;
      const storage = getStorage(req);

      // Load all processed email records
      const processedEmails = await storage.getProcessedEmails();
      const processedMap = new Map(processedEmails.map((e) => [e.gmailMessageId, e]));

      // Get existing trips for auto-matching
      const trips = await storage.listTrips();

      // Collect pending results (parsed but not applied/dismissed)
      const pendingResults: EmailScanResult[] = [];
      for (const pe of processedEmails) {
        if (pe.parseStatus === "parsed" && pe.rawParseResult) {
          const stored = pe.rawParseResult as EmailScanResult;
          // Re-match trip suggestions with current trips
          const rematchedSegments = stored.parsedSegments.map((seg) => {
            if (tripId) return { ...seg, suggestedTripId: tripId };
            const matchingTrip = trips.find((t) =>
              isDateInRange(seg.date, t.startDate, t.endDate),
            );
            return matchingTrip
              ? { ...seg, suggestedTripId: matchingTrip.id }
              : { ...seg, suggestedTripId: undefined };
          });
          pendingResults.push({ ...stored, parsedSegments: rematchedSegments });
        }
      }

      // Scan Gmail for new emails
      const scanner = new GmailScanner(req.accessToken || "");
      const rawEmails = await scanner.scanEmails({
        labelFilter,
        maxResults: maxResults ?? 25,
        newerThanDays: newerThanDays ?? 365,
      });

      // Filter to truly new emails (not in processedEmails at all)
      const newEmails = rawEmails.filter((e) => !processedMap.has(e.id));

      // If no new emails to parse, just return pending results
      if (newEmails.length === 0) {
        if (pendingResults.length > 0) {
          console.log(`No new emails. Returning ${pendingResults.length} pending results.`);
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

      console.log(`Scanning ${newEmails.length} new emails (${rawEmails.length} total from Gmail, ${pendingResults.length} pending)`);

      for (const email of newEmails) {
        try {
          console.log(`Parsing email: "${email.subject}" from ${email.from} (body: ${email.bodyText.length} chars)`);
          const segments = await parser.parseEmail({
            subject: email.subject,
            from: email.from,
            body: email.bodyText,
          });
          console.log(`  → ${segments.length} segments extracted`);

          // Auto-match segments to trips by date
          const matchedSegments = segments.map((seg) => {
            if (tripId) return { ...seg, suggestedTripId: tripId };
            const matchingTrip = trips.find((t) =>
              isDateInRange(seg.date, t.startDate, t.endDate),
            );
            return matchingTrip
              ? { ...seg, suggestedTripId: matchingTrip.id }
              : seg;
          });

          const hasTravel = segments.length > 0;
          const scanResult: EmailScanResult = {
            emailId: email.id,
            subject: email.subject,
            from: email.from,
            receivedAt: email.receivedAt,
            parsedSegments: matchedSegments,
            parseStatus: hasTravel ? "success" : "no_travel_content",
          };

          if (hasTravel) {
            newResults.push(scanResult);
          } else {
            noTravelResults.push(scanResult);
          }

          // Save to processedEmails — travel emails get "parsed" status with saved results,
          // no-travel emails get "skipped" status
          newProcessedEmails.push({
            gmailMessageId: email.id,
            gmailThreadId: email.threadId,
            subject: email.subject,
            fromAddress: email.from,
            receivedAt: email.receivedAt,
            parsedType: hasTravel ? segments[0].type : undefined,
            parseStatus: hasTravel ? "parsed" : "skipped",
            rawParseResult: hasTravel ? scanResult : undefined,
            createdAt: new Date().toISOString(),
          });
        } catch (err: unknown) {
          console.error(`Failed to parse email ${email.id}:`, err);

          // Detect billing / auth errors from Anthropic
          const errMsg = err instanceof Error ? err.message : String(err);
          const errObj = err as Record<string, unknown>;
          const errStatus = typeof errObj.status === "number" ? errObj.status : 0;
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

          if (isBillingError || isAuthError) {
            const code = isBillingError ? "ANTHROPIC_BILLING" : "ANTHROPIC_AUTH";
            const userMessage = isBillingError
              ? "The AI service (Anthropic) requires additional credits. Please check your billing at console.anthropic.com."
              : "The AI service API key is invalid or expired. Please update ANTHROPIC_API_KEY.";

            // Save any results we parsed so far before the error
            if (newProcessedEmails.length > 0) {
              await storage.saveProcessedEmails([...processedEmails, ...newProcessedEmails]);
            }

            // Return pending + whatever we parsed before error
            const allResults = [...pendingResults, ...newResults];
            res.status(402).json({
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
   * POST /emails/apply
   * Apply selected parsed segments to trips.
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

      console.log(`Applying ${parsed.data.segments.length} segments from email scan`);

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
        console.log(`  Trip "${trip.title}" (${tid}): adding ${segs.length} segments`);

        for (const seg of segs) {
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
            carrier: seg.carrier,
            routeCode: seg.routeCode,
            partySize: seg.partySize,
            creditCardHold: seg.creditCardHold,
            seatNumber: seg.seatNumber,
            cabinClass: seg.cabinClass,
            baggageInfo: seg.baggageInfo,
            contactName: seg.contactName,
            phone: seg.phone,
            breakfastIncluded: seg.breakfastIncluded,
            cost: seg.cost,
            source: "email_auto",
            sourceEmailId: seg.emailId,
            needsReview: true,
            sortOrder: day.segments.length,
          });

          createdSegments.push({ tripId: tid, segmentId, title: seg.title });
          console.log(`    + [${seg.type}] "${seg.title}" on ${seg.date} → ${segmentId}`);
        }

        // Auto-fill city on days based on segment destinations
        for (const day of trip.days) {
          if (day.city) continue;
          for (const seg of day.segments) {
            const segCity = seg.type === "flight" ? seg.arrivalCity : seg.city;
            if (segCity) {
              day.city = segCity;
              console.log(`    City: set ${day.date} → "${segCity}" (from "${seg.title}")`);
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
            console.log(`    City: propagated ${day.date} → "${lastCity}"`);
          }
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

      console.log(`Apply complete: ${createdSegments.length} segments created`);
      res.status(201).json({ created: createdSegments });
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
