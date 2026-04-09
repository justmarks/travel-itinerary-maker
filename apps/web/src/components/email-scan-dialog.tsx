"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import type { EmailScanResult, ParsedSegment, GmailLabel } from "@travel-app/shared";
import {
  useScanEmails,
  useApplyParsedSegments,
  useDismissEmail,
  useGmailLabels,
  usePendingEmails,
  useTrips,
  useCreateTrip,
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
  AlertCircle,
  Check,
  X,
  Tag,
  Plus,
  ChevronDown,
  ChevronRight,
  Eye,
  RefreshCw,
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

type ScanStep = "loading" | "config" | "scanning" | "results" | "applying" | "done" | "error";

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
  const [step, setStep] = useState<ScanStep>("loading");
  const [selectedLabel, setSelectedLabel] = useState<string>("");
  const [results, setResults] = useState<EmailScanResult[]>([]);
  const [selections, setSelections] = useState<SegmentSelection[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [appliedCount, setAppliedCount] = useState(0);
  const [showSkipped, setShowSkipped] = useState(false);
  const [showLowConfidence, setShowLowConfidence] = useState(false);

  // Inline new-trip creation
  const [showNewTripForm, setShowNewTripForm] = useState(false);
  const [newTripTitle, setNewTripTitle] = useState("");
  const [newTripStart, setNewTripStart] = useState("");
  const [newTripEnd, setNewTripEnd] = useState("");
  const [creatingTrip, setCreatingTrip] = useState(false);

  const { data: labels, error: labelsError } = useGmailLabels(open);
  const { data: pendingData, isLoading: pendingLoading } = usePendingEmails(open);
  const { data: trips } = useTrips();
  const scanEmails = useScanEmails();
  const applySegments = useApplyParsedSegments();
  const dismissEmail = useDismissEmail();
  const createTrip = useCreateTrip();

  const reset = useCallback(() => {
    setStep("loading");
    setResults([]);
    setSelections([]);
    setErrorMessage("");
    setAppliedCount(0);
    setShowSkipped(false);
    setShowLowConfidence(false);
    setShowNewTripForm(false);
    setNewTripTitle("");
    setNewTripStart("");
    setNewTripEnd("");
    setCreatingTrip(false);
  }, []);

  // When dialog opens, check for pending results
  useEffect(() => {
    if (!open || pendingLoading) return;

    if (pendingData?.results && pendingData.results.length > 0) {
      // We have pending results — go straight to results view
      loadResultsIntoState(pendingData.results);
      setStep("results");
    } else {
      setStep("config");
    }
  }, [open, pendingLoading, pendingData]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Populate results + selections state from an array of EmailScanResult */
  const loadResultsIntoState = useCallback(
    (scanResults: EmailScanResult[]) => {
      setResults(scanResults);
      const sels: SegmentSelection[] = [];
      for (const result of scanResults) {
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
    },
    [tripId],
  );

  // Compute the full date range across ALL segments (for new trip defaults)
  const allSegmentDateRange = useMemo(() => {
    const dates = selections.map((s) => s.date).sort();
    if (dates.length === 0) return null;
    return { start: dates[0], end: dates[dates.length - 1] };
  }, [selections]);

  // Check if any selected segment is unassigned (no trip match)
  const hasUnassignedSegments = selections.some((s) => s.selected && !s.assignedTripId);

  // Auto-show the new trip form when there are unassigned segments and no existing trips match
  useEffect(() => {
    if (step === "results" && hasUnassignedSegments && !showNewTripForm) {
      if (!trips || trips.length === 0) {
        setShowNewTripForm(true);
      }
    }
  }, [step, hasUnassignedSegments, trips]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-populate new trip dates from all segment dates
  useEffect(() => {
    if (showNewTripForm && allSegmentDateRange) {
      if (!newTripStart) setNewTripStart(allSegmentDateRange.start);
      if (!newTripEnd) setNewTripEnd(allSegmentDateRange.end);
    }
  }, [showNewTripForm, allSegmentDateRange]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScan = async () => {
    setStep("scanning");
    setErrorMessage("");

    try {
      const input: Record<string, unknown> = {};
      if (tripId) input.tripId = tripId;
      if (selectedLabel && selectedLabel !== "__all__") input.labelFilter = selectedLabel;

      const res = await scanEmails.mutateAsync(input);

      if (!res.results || res.results.length === 0) {
        setResults([]);
        setSelections([]);
        setStep("results");
        return;
      }

      loadResultsIntoState(res.results);
      setStep("results");
    } catch (err) {
      const apiErr = err as { status?: number; body?: { code?: string; error?: string; emailsFound?: number; results?: EmailScanResult[] } };
      const status = apiErr.status;
      const body = apiErr.body;

      // If we got partial results with a billing error, show them
      if (status === 402 && body?.results && body.results.length > 0) {
        loadResultsIntoState(body.results);
        setErrorMessage(
          body.error || "AI service needs credits. You can still process the segments that were already parsed.",
        );
        setStep("results");
        return;
      }

      if (status === 403 && body?.code === "GMAIL_SCOPE_REQUIRED") {
        setErrorMessage(
          "Gmail access is required. Please sign out and sign back in, granting Gmail permissions when prompted.",
        );
      } else if (status === 402) {
        const found = body?.emailsFound ? ` (${body.emailsFound} emails found)` : "";
        setErrorMessage(
          `Found emails${found} but the AI service needs credits to parse them. Please add credits at console.anthropic.com, then try scanning again.`,
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

  /** Create a new trip and auto-assign all unassigned segments within its date range */
  const handleCreateTrip = async () => {
    if (!newTripTitle || !newTripStart || !newTripEnd) return;

    setCreatingTrip(true);
    try {
      const trip = await createTrip.mutateAsync({
        title: newTripTitle,
        startDate: newTripStart,
        endDate: newTripEnd,
      });

      // Auto-assign all selected but unassigned segments whose dates fall in range
      setSelections((prev) =>
        prev.map((s) => {
          if (s.selected && !s.assignedTripId && s.date >= newTripStart && s.date <= newTripEnd) {
            return { ...s, assignedTripId: trip.id };
          }
          return s;
        }),
      );

      setShowNewTripForm(false);
      setNewTripTitle("");
      setNewTripStart("");
      setNewTripEnd("");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to create trip",
      );
    } finally {
      setCreatingTrip(false);
    }
  };

  const handleApply = async () => {
    const toApply = selections.filter((s) => s.selected && s.assignedTripId);
    if (!toApply.length) return;

    setStep("applying");

    try {
      const resolvedSegments = toApply.map((s) => ({
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
        cabinClass: s.cabinClass,
        baggageInfo: s.baggageInfo,
        contactName: s.contactName,
        cost: s.cost,
        confidence: s.confidence,
        tripId: s.assignedTripId,
        emailId: s.emailId,
      }));

      const res = await applySegments.mutateAsync({ segments: resolvedSegments });
      setAppliedCount(res.created.length);

      // Dismiss emails that had segments but none were selected
      const appliedEmailIds = new Set(toApply.map((s) => s.emailId));
      const unappliedWithTravel = results.filter(
        (r) => r.parsedSegments.length > 0 && !appliedEmailIds.has(r.emailId),
      );
      // Only auto-dismiss emails where ALL their segments were deselected
      for (const r of unappliedWithTravel) {
        const anySelected = selections.some(
          (s) => s.emailId === r.emailId && s.selected,
        );
        if (!anySelected) {
          await dismissEmail.mutateAsync(r.emailId);
        }
      }

      setStep("done");
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to apply segments",
      );
      setStep("error");
    }
  };

  /** Dismiss all remaining pending emails (user doesn't want them) */
  const handleDismissAll = async () => {
    const pendingEmailIds = new Set(
      results
        .filter((r) => r.parsedSegments.length > 0)
        .map((r) => r.emailId),
    );
    for (const eid of pendingEmailIds) {
      await dismissEmail.mutateAsync(eid);
    }
    setOpen(false);
  };

  const selectedCount = selections.filter((s) => s.selected && s.assignedTripId).length;
  const travelResults = results.filter((r) => r.parsedSegments.length > 0);
  const noTravelResults = results.filter((r) => r.parsedSegments.length === 0);

  // Split selections into main (medium/high) and low-confidence
  const mainSelections = selections.filter((s) => s.confidence !== "low");
  const lowSelections = selections.filter((s) => s.confidence === "low");

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

        {/* ── Step: Loading pending results ── */}
        {step === "loading" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-8">
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Checking for pending results...</p>
          </div>
        )}

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
            {results.length === 0 && selections.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
                <MinusCircle className="h-7 w-7 text-muted-foreground" />
                <p className="font-medium">No new emails found</p>
                <p className="text-sm text-muted-foreground">
                  Already processed, or no confirmations found.
                </p>
              </div>
            ) : (
              <>
                {/* Summary bar */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  {travelResults.length > 0 && (
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      {travelResults.length} with travel
                    </span>
                  )}
                  {noTravelResults.length > 0 && (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <MinusCircle className="h-4 w-4" />
                      {noTravelResults.length} skipped
                    </span>
                  )}
                  {lowSelections.length > 0 && (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <AlertCircle className="h-4 w-4" />
                      {lowSelections.length} low confidence
                    </span>
                  )}
                  {errorMessage && (
                    <p className="w-full text-xs text-amber-700">{errorMessage}</p>
                  )}
                </div>

                {/* Scrollable content area */}
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {/* New Trip Creation — inline at top when segments are unassigned */}
                  {hasUnassignedSegments && !showNewTripForm && (
                    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-amber-800">
                          Some segments don&apos;t match any trip.
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 shrink-0 border-amber-300 bg-white text-xs hover:bg-amber-50"
                          onClick={() => setShowNewTripForm(true)}
                        >
                          <Plus className="mr-1 h-3 w-3" />
                          Create Trip
                        </Button>
                      </div>
                    </div>
                  )}

                  {showNewTripForm && (
                    <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-blue-900 flex items-center gap-1.5">
                          <Plus className="h-4 w-4" />
                          Create New Trip
                        </p>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-blue-600 hover:text-blue-800"
                          onClick={() => setShowNewTripForm(false)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <Input
                        value={newTripTitle}
                        onChange={(e) => setNewTripTitle(e.target.value)}
                        placeholder="Trip name (e.g. Hawaii 2026)"
                        className="h-8 text-sm bg-white"
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="text-[10px] text-blue-700">Start date</label>
                          <Input
                            type="date"
                            value={newTripStart}
                            onChange={(e) => setNewTripStart(e.target.value)}
                            className="h-8 text-sm bg-white"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-[10px] text-blue-700">End date</label>
                          <Input
                            type="date"
                            value={newTripEnd}
                            onChange={(e) => setNewTripEnd(e.target.value)}
                            className="h-8 text-sm bg-white"
                          />
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="w-full h-8 text-xs"
                        onClick={handleCreateTrip}
                        disabled={creatingTrip || !newTripTitle || !newTripStart || !newTripEnd}
                      >
                        {creatingTrip ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Plus className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        {creatingTrip ? "Creating..." : "Create & Assign Matching Segments"}
                      </Button>
                    </div>
                  )}

                  {/* Main segment list */}
                  {mainSelections.length > 0 ? (
                    <div className="space-y-2 pr-1">
                      <p className="text-sm font-medium">
                        {mainSelections.length} segment{mainSelections.length !== 1 ? "s" : ""} found:
                      </p>
                      {mainSelections.map((seg) => {
                        const globalIdx = selections.indexOf(seg);
                        return (
                          <SegmentCard
                            key={`${seg.emailId}-${globalIdx}`}
                            seg={seg}
                            index={globalIdx}
                            results={results}
                            trips={trips || []}
                            onToggle={toggleSelection}
                            onSetTrip={setTripForSegment}
                            onRequestNewTrip={() => setShowNewTripForm(true)}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      No travel segments found in scanned emails.
                    </p>
                  )}

                  {/* Low-confidence segments (collapsible) */}
                  {lowSelections.length > 0 && (
                    <div className="mt-4">
                      <button
                        onClick={() => setShowLowConfidence((v) => !v)}
                        className="flex w-full items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {showLowConfidence ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                        {lowSelections.length} low-confidence segment{lowSelections.length !== 1 ? "s" : ""}
                      </button>
                      {showLowConfidence && (
                        <div className="mt-2 space-y-2">
                          {lowSelections.map((seg) => {
                            const globalIdx = selections.indexOf(seg);
                            return (
                              <SegmentCard
                                key={`${seg.emailId}-${globalIdx}`}
                                seg={seg}
                                index={globalIdx}
                                results={results}
                                trips={trips || []}
                                onToggle={toggleSelection}
                                onSetTrip={setTripForSegment}
                                onRequestNewTrip={() => setShowNewTripForm(true)}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Skipped emails (no travel content) — collapsible review */}
                  {noTravelResults.length > 0 && (
                    <SkippedEmailsSection emails={noTravelResults} />
                  )}
                </div>
              </>
            )}

            {/* Footer — always visible */}
            <DialogFooter className="flex-row justify-between gap-2 border-t pt-3">
              <div className="flex gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  {results.length === 0 ? "Close" : "Later"}
                </Button>
                {travelResults.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={handleDismissAll}
                  >
                    Dismiss All
                  </Button>
                )}
              </div>
              <div className="flex gap-1.5">
                {step === "results" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setStep("config");
                    }}
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Scan More
                  </Button>
                )}
                {selections.length > 0 && (
                  <Button
                    size="sm"
                    onClick={handleApply}
                    disabled={selectedCount === 0}
                  >
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                    Add {selectedCount} segment{selectedCount !== 1 ? "s" : ""}
                  </Button>
                )}
              </div>
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
              <Button size="sm" onClick={() => { reset(); setStep("config"); }}>
                Retry
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Individual segment card */
function SegmentCard({
  seg,
  index,
  results,
  trips,
  onToggle,
  onSetTrip,
  onRequestNewTrip,
}: {
  seg: SegmentSelection;
  index: number;
  results: EmailScanResult[];
  trips: Array<{ id: string; title: string; startDate: string }>;
  onToggle: (idx: number) => void;
  onSetTrip: (idx: number, tripId: string) => void;
  onRequestNewTrip: () => void;
}) {
  const email = results.find((r) => r.emailId === seg.emailId);

  const handleTripChange = (value: string) => {
    if (value === "__create_new__") {
      onRequestNewTrip();
    } else {
      onSetTrip(index, value);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border p-2.5 transition-colors",
        seg.selected
          ? "border-border bg-card"
          : "border-muted bg-muted/30 opacity-60",
      )}
    >
      <div className="flex items-start gap-2.5">
        <button
          onClick={() => onToggle(index)}
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
            {seg.cost && (
              <span className="font-medium text-foreground">
                {seg.cost.currency} {seg.cost.amount.toFixed(2)}
              </span>
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
                onValueChange={handleTripChange}
              >
                <SelectTrigger className="h-7 w-full text-xs">
                  <SelectValue placeholder="Assign to trip..." />
                </SelectTrigger>
                <SelectContent>
                  {trips.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title} ({t.startDate})
                    </SelectItem>
                  ))}
                  <SelectItem value="__create_new__">
                    <span className="flex items-center gap-1.5 text-blue-600">
                      <Plus className="h-3 w-3" />
                      Create new trip...
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
              {!seg.assignedTripId && (
                <p className="mt-0.5 text-[10px] text-amber-600">
                  Select a trip or create a new one
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Collapsible section showing emails that had no travel content */
function SkippedEmailsSection({ emails }: { emails: EmailScanResult[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-4">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <Eye className="h-3.5 w-3.5" />
        {emails.length} skipped email{emails.length !== 1 ? "s" : ""} (no travel content detected)
      </button>
      {expanded && (
        <div className="mt-2 space-y-1.5">
          {emails.map((email) => (
            <div
              key={email.emailId}
              className="rounded border border-muted bg-muted/20 px-2.5 py-1.5"
            >
              <p className="truncate text-xs font-medium">{email.subject}</p>
              <p className="truncate text-[10px] text-muted-foreground">
                {email.from} &middot; {new Date(email.receivedAt).toLocaleDateString()}
              </p>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground italic">
            These emails were scanned but no travel bookings were found. They won&apos;t be scanned again.
          </p>
        </div>
      )}
    </div>
  );
}
