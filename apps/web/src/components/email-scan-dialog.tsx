"use client";

import { useState, useCallback } from "react";
import type { EmailScanResult, ParsedSegment, GmailLabel } from "@travel-app/shared";
import {
  useScanEmails,
  useApplyParsedSegments,
  useDismissEmail,
  useGmailLabels,
  useTrips,
  ApiError,
} from "@travel-app/api-client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Mail,
  Loader2,
  CheckCircle2,
  XCircle,
  MinusCircle,
  MapPin,
  AlertCircle,
  Check,
  X,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";

const CONFIDENCE_STYLES: Record<string, string> = {
  high: "border-green-300 bg-green-50 text-green-700",
  medium: "border-amber-300 bg-amber-50 text-amber-700",
  low: "border-red-300 bg-red-50 text-red-700",
};

interface SegmentSelection extends ParsedSegment {
  emailId: string;
  selected: boolean;
  assignedTripId: string;
}

type ScanStep = "config" | "scanning" | "results" | "applying" | "done" | "error";

export function EmailScanDialog({
  tripId,
  triggerLabel = "Scan Emails",
  triggerVariant = "outline",
  triggerSize = "sm",
}: {
  tripId?: string;
  triggerLabel?: string;
  triggerVariant?: "outline" | "default" | "ghost";
  triggerSize?: "sm" | "default" | "lg";
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<ScanStep>("config");
  const [selectedLabel, setSelectedLabel] = useState<string>("");
  const [results, setResults] = useState<EmailScanResult[]>([]);
  const [selections, setSelections] = useState<SegmentSelection[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [appliedCount, setAppliedCount] = useState(0);

  const { data: labels, error: labelsError } = useGmailLabels(open);
  const { data: trips } = useTrips();
  const scanEmails = useScanEmails();
  const applySegments = useApplyParsedSegments();
  const dismissEmail = useDismissEmail();

  const reset = useCallback(() => {
    setStep("config");
    setResults([]);
    setSelections([]);
    setErrorMessage("");
    setAppliedCount(0);
  }, []);

  const handleScan = async () => {
    setStep("scanning");
    setErrorMessage("");

    try {
      const input: Record<string, unknown> = {};
      if (tripId) input.tripId = tripId;
      if (selectedLabel && selectedLabel !== "__all__") input.labelFilter = selectedLabel;

      const res = await scanEmails.mutateAsync(input);

      if (!res.results.length) {
        setResults([]);
        setStep("results");
        return;
      }

      setResults(res.results);

      const sels: SegmentSelection[] = [];
      for (const result of res.results) {
        for (const seg of result.parsedSegments) {
          sels.push({
            ...seg,
            emailId: result.emailId,
            selected: seg.confidence !== "low",
            assignedTripId: seg.suggestedTripId || tripId || "",
          });
        }
      }
      setSelections(sels);
      setStep("results");
    } catch (err) {
      const apiErr = err as { status?: number; body?: { code?: string; error?: string; emailsFound?: number } };
      const status = apiErr.status;
      const body = apiErr.body;

      if (status === 403 && body?.code === "GMAIL_SCOPE_REQUIRED") {
        setErrorMessage(
          "Gmail access is required. Please sign out and sign back in, granting Gmail permissions when prompted.",
        );
      } else if (status === 402) {
        const found = body?.emailsFound ? ` (${body.emailsFound} emails found)` : "";
        setErrorMessage(
          `Found emails${found} but the AI service needs credits to parse them. Please add credits at console.anthropic.com, then try scanning again \u2014 your emails will be re-fetched.`,
        );
      } else if (body?.error) {
        setErrorMessage(body.error);
      } else {
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to scan emails",
        );
      }
      setStep("error");
    }
  };

  const toggleSelection = (index: number) => {
    setSelections((prev) =>
      prev.map((s, i) => (i === index ? { ...s, selected: !s.selected } : s)),
    );
  };

  const setTripForSegment = (index: number, tid: string) => {
    setSelections((prev) =>
      prev.map((s, i) => (i === index ? { ...s, assignedTripId: tid } : s)),
    );
  };

  const handleApply = async () => {
    const toApply = selections.filter((s) => s.selected && s.assignedTripId);
    if (!toApply.length) return;

    setStep("applying");

    try {
      const segments = toApply.map((s) => ({
        type: s.type,
        title: s.title,
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        venueName: s.venueName,
        address: s.address,
        city: s.city,
        url: s.url,
        confirmationCode: s.confirmationCode,
        provider: s.provider,
        departureCity: s.departureCity,
        arrivalCity: s.arrivalCity,
        carrier: s.carrier,
        routeCode: s.routeCode,
        partySize: s.partySize,
        creditCardHold: s.creditCardHold,
        phone: s.phone,
        breakfastIncluded: s.breakfastIncluded,
        seatNumber: s.seatNumber,
        contactName: s.contactName,
        cost: s.cost,
        confidence: s.confidence,
        tripId: s.assignedTripId,
        emailId: s.emailId,
      }));

      const res = await applySegments.mutateAsync({ segments });
      setAppliedCount(res.created.length);

      const appliedEmailIds = new Set(toApply.map((s) => s.emailId));
      const dismissedEmailIds = new Set(
        results
          .filter((r) => !appliedEmailIds.has(r.emailId) && r.parseStatus !== "no_travel_content")
          .map((r) => r.emailId),
      );
      for (const eid of dismissedEmailIds) {
        await dismissEmail.mutateAsync(eid);
      }

      setStep("done");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to apply segments",
      );
      setStep("error");
    }
  };

  const selectedCount = selections.filter((s) => s.selected && s.assignedTripId).length;
  const travelResults = results.filter((r) => r.parsedSegments.length > 0);
  const noTravelResults = results.filter((r) => r.parsedSegments.length === 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size={triggerSize}>
          <Mail className="mr-2 h-4 w-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>

      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] flex-col overflow-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Scan Emails
          </DialogTitle>
          <DialogDescription>
            Search Gmail for travel confirmations and add them to your itinerary.
          </DialogDescription>
        </DialogHeader>

        {/* ── Step: Config ── */}
        {step === "config" && (
          <>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Gmail Label (optional)
                </label>
                <div className="flex items-center gap-2">
                  <Tag className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <Input
                    value={selectedLabel}
                    onChange={(e) => setSelectedLabel(e.target.value)}
                    placeholder="e.g. Travel, Receipts"
                    className="h-9"
                  />
                  {selectedLabel && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => setSelectedLabel("")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                {labels && labels.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {labels.map((label) => (
                      <button
                        key={label.id}
                        type="button"
                        onClick={() => setSelectedLabel(label.name)}
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                          selectedLabel === label.name
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                        )}
                      >
                        {label.name}
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Leave blank to search all mail for travel keywords.
                </p>
              </div>

              {labelsError && (
                <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <p>
                    Could not load labels. You may need to sign out and back in for Gmail access.
                  </p>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button onClick={handleScan} className="w-full">
                <Mail className="mr-2 h-4 w-4" />
                Start Scan
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── Step: Scanning ── */}
        {step === "scanning" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-8">
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            <p className="font-medium">Scanning emails...</p>
            <p className="text-sm text-muted-foreground">
              Searching Gmail and parsing with AI.
            </p>
          </div>
        )}

        {/* ── Step: Results ── */}
        {step === "results" && (
          <>
            {results.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
                <MinusCircle className="h-7 w-7 text-muted-foreground" />
                <p className="font-medium">No new emails found</p>
                <p className="text-sm text-muted-foreground">
                  Already processed, or no confirmations found.
                </p>
              </div>
            ) : (
              <>
                {/* Summary — fixed */}
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    {travelResults.length} with travel
                  </span>
                  {noTravelResults.length > 0 && (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <MinusCircle className="h-4 w-4" />
                      {noTravelResults.length} skipped
                    </span>
                  )}
                </div>

                {/* Scrollable segment list */}
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {selections.length > 0 ? (
                    <div className="space-y-2 pr-1">
                      <p className="text-sm font-medium">
                        {selections.length} segment{selections.length !== 1 ? "s" : ""} found:
                      </p>
                      {selections.map((seg, idx) => {
                        const email = results.find((r) => r.emailId === seg.emailId);
                        return (
                          <div
                            key={`${seg.emailId}-${idx}`}
                            className={cn(
                              "rounded-lg border p-2.5 transition-colors",
                              seg.selected
                                ? "border-border bg-card"
                                : "border-muted bg-muted/30 opacity-60",
                            )}
                          >
                            <div className="flex items-start gap-2.5">
                              <button
                                onClick={() => toggleSelection(idx)}
                                className="mt-0.5 shrink-0"
                              >
                                {seg.selected ? (
                                  <Check className="h-4 w-4 rounded border border-primary bg-primary p-0.5 text-primary-foreground" />
                                ) : (
                                  <div className="h-4 w-4 rounded border border-muted-foreground/30" />
                                )}
                              </button>

                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-sm font-medium">{seg.title}</span>
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "text-[10px]",
                                      CONFIDENCE_STYLES[seg.confidence],
                                    )}
                                  >
                                    {seg.confidence}
                                  </Badge>
                                </div>

                                <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                                  <span>{seg.date}</span>
                                  {seg.startTime && <span>{seg.startTime}</span>}
                                  {seg.confirmationCode && (
                                    <span className="font-mono">#{seg.confirmationCode}</span>
                                  )}
                                </div>

                                {email && (
                                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                    {email.subject}
                                  </p>
                                )}

                                {seg.selected && (
                                  <div className="mt-1.5">
                                    <Select
                                      value={seg.assignedTripId}
                                      onValueChange={(v) => setTripForSegment(idx, v)}
                                    >
                                      <SelectTrigger className="h-7 w-full text-xs">
                                        <SelectValue placeholder="Assign to trip..." />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {trips?.map((t) => (
                                          <SelectItem key={t.id} value={t.id}>
                                            {t.title} ({t.startDate})
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    {!seg.assignedTripId && (
                                      <p className="mt-0.5 text-[10px] text-amber-600">
                                        Select a trip to add this segment
                                      </p>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      No travel segments found in scanned emails.
                    </p>
                  )}
                </div>
              </>
            )}

            {/* Footer — always visible */}
            <DialogFooter className="flex-row justify-between gap-2 border-t pt-3">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                {results.length === 0 ? "Close" : "Cancel"}
              </Button>
              {selections.length > 0 && (
                <Button size="sm" onClick={handleApply} disabled={selectedCount === 0}>
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                  Add {selectedCount} segment{selectedCount !== 1 ? "s" : ""}
                </Button>
              )}
            </DialogFooter>
          </>
        )}

        {/* ── Step: Applying ── */}
        {step === "applying" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-8">
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            <p className="font-medium">Adding segments to your trip...</p>
          </div>
        )}

        {/* ── Step: Done ── */}
        {step === "done" && (
          <>
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
              <p className="text-lg font-medium">
                {appliedCount} segment{appliedCount !== 1 ? "s" : ""} added!
              </p>
              <p className="text-sm text-muted-foreground">
                Look for the yellow &quot;Review&quot; badge to verify.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => setOpen(false)} className="w-full">Done</Button>
            </DialogFooter>
          </>
        )}

        {/* ── Step: Error ── */}
        {step === "error" && (
          <>
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
              <XCircle className="h-8 w-8 text-destructive" />
              <p className="text-lg font-medium">Scan Failed</p>
              <p className="text-sm text-muted-foreground">{errorMessage}</p>
            </div>
            <DialogFooter className="flex-row justify-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                Close
              </Button>
              <Button size="sm" onClick={() => { reset(); handleScan(); }}>
                Retry
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
