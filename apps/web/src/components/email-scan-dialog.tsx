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
import {
  Mail,
  Loader2,
  CheckCircle2,
  XCircle,
  MinusCircle,
  Plane,
  BedDouble,
  UtensilsCrossed,
  MapPin,
  Car,
  Train,
  Ship,
  AlertCircle,
  Check,
  X,
  Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";

const SEGMENT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  flight: Plane,
  hotel: BedDouble,
  restaurant_breakfast: UtensilsCrossed,
  restaurant_brunch: UtensilsCrossed,
  restaurant_lunch: UtensilsCrossed,
  restaurant_dinner: UtensilsCrossed,
  activity: MapPin,
  car_rental: Car,
  car_service: Car,
  train: Train,
  cruise: Ship,
  tour: MapPin,
  other_transport: Car,
};

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

  const { data: labels } = useGmailLabels(open);
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

      // Build selections from parsed segments
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
      if (err instanceof ApiError && err.status === 403) {
        const body = err.body as { code?: string };
        if (body.code === "GMAIL_SCOPE_REQUIRED") {
          setErrorMessage(
            "Gmail access is required. Please sign out and sign back in, granting Gmail permissions when prompted.",
          );
        } else {
          setErrorMessage("Gmail access denied. Please check your permissions.");
        }
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

      // Dismiss emails with no selected segments
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

      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Scan Emails for Travel
          </DialogTitle>
          <DialogDescription>
            Search your Gmail for travel confirmations and add them to your itinerary.
          </DialogDescription>
        </DialogHeader>

        {/* ── Step: Config ── */}
        {step === "config" && (
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Gmail Label (optional)
              </label>
              <Select value={selectedLabel} onValueChange={setSelectedLabel}>
                <SelectTrigger>
                  <div className="flex items-center gap-2">
                    <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                    <SelectValue placeholder="All mail (default search)" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All mail (default search)</SelectItem>
                  {labels?.map((label) => (
                    <SelectItem key={label.id} value={label.name}>
                      {label.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Filter to a specific label, or scan all mail for travel keywords.
              </p>
            </div>

            <Button onClick={handleScan} className="w-full">
              <Mail className="mr-2 h-4 w-4" />
              Start Scan
            </Button>
          </div>
        )}

        {/* ── Step: Scanning ── */}
        {step === "scanning" && (
          <div className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <div className="text-center">
              <p className="font-medium">Scanning emails...</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Searching Gmail and parsing travel content with AI.
              </p>
            </div>
          </div>
        )}

        {/* ── Step: Results ── */}
        {step === "results" && (
          <div className="space-y-4 pt-2">
            {results.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <MinusCircle className="h-8 w-8 text-muted-foreground" />
                <div>
                  <p className="font-medium">No new emails found</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    All travel emails have already been processed, or no new confirmations were found.
                  </p>
                </div>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Close
                </Button>
              </div>
            ) : (
              <>
                {/* Summary */}
                <div className="flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    {travelResults.length} with travel content
                  </span>
                  {noTravelResults.length > 0 && (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <MinusCircle className="h-4 w-4" />
                      {noTravelResults.length} skipped
                    </span>
                  )}
                </div>

                {/* Segment list */}
                {selections.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-sm font-medium">
                      Found {selections.length} travel segment{selections.length !== 1 ? "s" : ""}:
                    </p>
                    {selections.map((seg, idx) => {
                      const Icon = SEGMENT_ICONS[seg.type] || MapPin;
                      const email = results.find((r) => r.emailId === seg.emailId);
                      return (
                        <div
                          key={`${seg.emailId}-${idx}`}
                          className={cn(
                            "rounded-lg border p-3 transition-colors",
                            seg.selected
                              ? "border-border bg-card"
                              : "border-muted bg-muted/30 opacity-60",
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <button
                              onClick={() => toggleSelection(idx)}
                              className="mt-0.5 shrink-0"
                            >
                              {seg.selected ? (
                                <Check className="h-5 w-5 rounded border border-primary bg-primary p-0.5 text-primary-foreground" />
                              ) : (
                                <div className="h-5 w-5 rounded border border-muted-foreground/30" />
                              )}
                            </button>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                <span className="font-medium">{seg.title}</span>
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

                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                <span>{seg.date}</span>
                                {seg.startTime && <span>{seg.startTime}</span>}
                                {seg.confirmationCode && (
                                  <span className="font-mono">
                                    #{seg.confirmationCode}
                                  </span>
                                )}
                              </div>

                              {email && (
                                <p className="mt-1 truncate text-xs text-muted-foreground">
                                  From: {email.from} — {email.subject}
                                </p>
                              )}

                              {/* Trip assignment */}
                              {seg.selected && (
                                <div className="mt-2">
                                  <Select
                                    value={seg.assignedTripId}
                                    onValueChange={(v) => setTripForSegment(idx, v)}
                                  >
                                    <SelectTrigger className="h-7 text-xs">
                                      <SelectValue placeholder="Assign to trip..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {trips?.map((t) => (
                                        <SelectItem key={t.id} value={t.id}>
                                          {t.title} ({t.startDate} – {t.endDate})
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  {!seg.assignedTripId && (
                                    <p className="mt-1 text-[10px] text-amber-600">
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
                  <div className="py-4 text-center text-sm text-muted-foreground">
                    No travel segments found in the scanned emails.
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center justify-between border-t pt-4">
                  <Button variant="ghost" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleApply}
                    disabled={selectedCount === 0}
                  >
                    <Check className="mr-2 h-4 w-4" />
                    Add {selectedCount} segment{selectedCount !== 1 ? "s" : ""} to trip
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Step: Applying ── */}
        {step === "applying" && (
          <div className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="font-medium">Adding segments to your trip...</p>
          </div>
        )}

        {/* ── Step: Done ── */}
        {step === "done" && (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <CheckCircle2 className="h-10 w-10 text-green-500" />
            <div>
              <p className="text-lg font-medium">
                {appliedCount} segment{appliedCount !== 1 ? "s" : ""} added!
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                The segments have been added to your trip. Items marked with a yellow &quot;Review&quot; badge may need verification.
              </p>
            </div>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </div>
        )}

        {/* ── Step: Error ── */}
        {step === "error" && (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <XCircle className="h-10 w-10 text-destructive" />
            <div>
              <p className="text-lg font-medium">Scan Failed</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {errorMessage}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Close
              </Button>
              <Button onClick={() => { reset(); handleScan(); }}>
                Retry
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
