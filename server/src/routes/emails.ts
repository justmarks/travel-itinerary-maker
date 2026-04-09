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
   * POST /emails/scan
   * Trigger a Gmail scan and parse emails with Claude AI.
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

      // Get already-processed email IDs
      const processedEmails = await storage.getProcessedEmails();
      const processedIds = new Set(processedEmails.map((e) => e.gmailMessageId));

      // Get existing trips for auto-matching
      const trips = await storage.listTrips();

      // Scan Gmail
      const scanner = new GmailScanner(req.accessToken || "");
      const rawEmails = await scanner.scanEmails({
        labelFilter,
        maxResults: maxResults ?? 25,
        newerThanDays: newerThanDays ?? 365,
      });

      // Filter out already-processed
      const newEmails = rawEmails.filter((e) => !processedIds.has(e.id));

      if (newEmails.length === 0) {
        res.json({ results: [], message: "No new emails to process" });
        return;
      }

      // Parse with Claude
      if (!config.anthropic.apiKey) {
        res.status(500).json({ error: "Anthropic API key not configured" });
        return;
      }

      const parser = new EmailParser({ apiKey: config.anthropic.apiKey });
      const results: EmailScanResult[] = [];
      const newProcessedEmails: ProcessedEmail[] = [];

      console.log(`Scanning ${newEmails.length} new emails (${rawEmails.length} total from Gmail)`);

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
            // If a specific trip was requested, use that
            if (tripId) return { ...seg, suggestedTripId: tripId };

            // Otherwise, find a trip whose date range contains this segment's date
            const matchingTrip = trips.find((t) =>
              isDateInRange(seg.date, t.startDate, t.endDate),
            );
            return matchingTrip
              ? { ...seg, suggestedTripId: matchingTrip.id }
              : seg;
          });

          results.push({
            emailId: email.id,
            subject: email.subject,
            from: email.from,
            receivedAt: email.receivedAt,
            parsedSegments: matchedSegments,
            parseStatus: segments.length > 0 ? "success" : "no_travel_content",
          });

          // Track as processed
          newProcessedEmails.push({
            gmailMessageId: email.id,
            gmailThreadId: email.threadId,
            subject: email.subject,
            fromAddress: email.from,
            receivedAt: email.receivedAt,
            parsedType: segments.length > 0 ? segments[0].type : undefined,
            parseStatus: segments.length > 0 ? "parsed" : "skipped",
            createdAt: new Date().toISOString(),
          });
        } catch (err: unknown) {
          console.error(`Failed to parse email ${email.id}:`, err);

          // Detect billing / auth errors from Anthropic — these affect ALL emails,
          // so stop immediately and don't mark any emails as processed.
          const errMsg = err instanceof Error ? err.message : String(err);
          const errObj = err as { status?: number; error?: { error?: { type?: string } } };
          const isBillingError =
            errMsg.includes("credit balance") ||
            errMsg.includes("billing") ||
            errObj.error?.error?.type === "invalid_request_error";
          const isAuthError =
            errObj.status === 401 ||
            errMsg.includes("authentication") ||
            errMsg.includes("api_key");

          if (isBillingError || isAuthError) {
            const code = isBillingError ? "ANTHROPIC_BILLING" : "ANTHROPIC_AUTH";
            const userMessage = isBillingError
              ? "The AI service (Anthropic) requires additional credits. Please check your billing at console.anthropic.com."
              : "The AI service API key is invalid or expired. Please update ANTHROPIC_API_KEY.";

            // Return what we found from Gmail but explain why parsing failed
            res.status(402).json({
              error: userMessage,
              code,
              emailsFound: newEmails.length,
            });
            return;
          }

          // For other per-email errors, record as failed and continue
          results.push({
            emailId: email.id,
            subject: email.subject,
            from: email.from,
            receivedAt: email.receivedAt,
            parsedSegments: [],
            parseStatus: "failed",
            error: errMsg,
          });

          newProcessedEmails.push({
            gmailMessageId: email.id,
            gmailThreadId: email.threadId,
            subject: email.subject,
            fromAddress: email.from,
            receivedAt: email.receivedAt,
            parseStatus: "failed",
            createdAt: new Date().toISOString(),
          });
        }
      }

      // Save processed email records
      await storage.saveProcessedEmails([...processedEmails, ...newProcessedEmails]);

      // Save label preference if provided
      if (labelFilter) {
        const settings = await storage.getSettings();
        if (settings.gmailLabelFilter !== labelFilter) {
          settings.gmailLabelFilter = labelFilter;
          await storage.saveSettings(settings);
        }
      }

      res.json({ results });
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

      // Group segments by trip
      const byTrip = new Map<string, typeof parsed.data.segments>();
      for (const seg of parsed.data.segments) {
        const list = byTrip.get(seg.tripId) || [];
        list.push(seg);
        byTrip.set(seg.tripId, list);
      }

      for (const [tid, segs] of byTrip) {
        const trip = await storage.getTrip(tid);
        if (!trip) continue;

        for (const seg of segs) {
          const day = trip.days.find((d) => d.date === seg.date);
          if (!day) continue;

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
        }

        trip.updatedAt = new Date().toISOString();
        await storage.saveTrip(trip);

        // Update processed email status to "mapped"
        const processedEmails = await storage.getProcessedEmails();
        const emailIds = new Set(segs.map((s) => s.emailId));
        for (const pe of processedEmails) {
          if (emailIds.has(pe.gmailMessageId)) {
            pe.parseStatus = "mapped";
            pe.tripId = tid;
          }
        }
        await storage.saveProcessedEmails(processedEmails);
      }

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
   * Mark an email as skipped so it won't be re-scanned.
   */
  router.post("/dismiss/:emailId", async (req: Request, res: Response) => {
    try {
      const storage = getStorage(req);
      const { emailId } = req.params;
      const processedEmails = await storage.getProcessedEmails();

      const existing = processedEmails.find((e) => e.gmailMessageId === emailId);
      if (existing) {
        existing.parseStatus = "skipped";
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
