"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import type {
  EmailScanResult,
  ParsedSegment,
  SegmentMatchStatus,
  ApplyAction,
} from "@travel-app/shared";
import {
  useScanEmails,
  useApplyParsedSegments,
  useDismissEmail,
  useGmailLabels,
  usePendingEmails,
  useTrips,
  useCreateTrip,
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

const MATCH_STATUS_STYLES: Record<SegmentMatchStatus, string> = {
  new: "border-blue-300 bg-blue-50 text-blue-700",
  enrichment: "border-violet-300 bg-violet-50 text-violet-700",
  conflict: "border-orange-300 bg-orange-50 text-orange-700",
  duplicate: "border-zinc-300 bg-zinc-100 text-zinc-600",
};

const MATCH_STATUS_LABEL: Record<SegmentMatchStatus, string> = {
  new: "New",
  enrichment: "Adds details",
  conflict: "Conflict",
  duplicate: "Already in trip",
};

/** Default action to propose when loading a scan result for the user. */
function defaultActionFor(status: SegmentMatchStatus): ApplyAction {
  switch (status) {
    case "enrichment":
      return "merge";
    case "conflict":
      return "merge"; // safer default — user can switch to replace or create
    case "duplicate":
      return "create"; // irrelevant, deselected by default
    case "new":
    default:
      return "create";
  }
}

interface SegmentSelection extends ParsedSegment {
  emailId: string;
  selected: boolean;
  assignedTripId: string;
  action: ApplyAction;
  existingSegmentId?: string;
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
  const [showLowConfidence, setShowLowConfidence] = useState(false);
  const [forceRescan, setForceRescan] = useState(false);

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
          const matchStatus: SegmentMatchStatus = seg.match?.status ?? "new";
          // Default selection: skip duplicates + low-confidence. User can opt in.
          const defaultSelected =
            matchStatus !== "duplicate" && seg.confidence !== "low";
          sels.push({
            ...seg,
            emailId: result.emailId,
            selected: defaultSelected,
            assignedTripId: seg.suggestedTripId || tripId || "",
            action: defaultActionFor(matchStatus),
            existingSegmentId: seg.match?.existingSegmentId,
          });
        }
      }
      setSelections(sels);
    },
    [tripId],
  );

  // Compute date range from ALL scanned segments for new trip defaults.
  // Uses every segment regardless of selection or assignment — the goal is
  // to suggest the full travel date span so the trip covers everything.
  const scannedDateRange = useMemo(() => {
    const dates = selections.map((s) => s.date).sort();
    if (dates.length === 0) return null;
    return { start: dates[0], end: dates[dates.length - 1] };
  }, [selections]);

  // Suggest a trip name from segment destinations + year
  const suggestedTripName = useMemo(() => {
    if (selections.length === 0) return "";
    // Collect destination cities: prefer flight arrivalCity, then segment city
    const cities: string[] = [];
    for (const s of selections) {
      if (s.type === "flight" && s.arrivalCity) {
        cities.push(s.arrivalCity);
      } else if (s.city) {
        cities.push(s.city);
      }
    }
    if (cities.length === 0) return "";
    // Count occurrences and pick the most common destination
    const counts = new Map<string, number>();
    for (const c of cities) {
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    const topCity = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    // Get year from the earliest segment date
    const year = selections[0]?.date?.slice(0, 4) || "";
    return year ? `${topCity} ${year}` : topCity;
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

  // Auto-populate new trip name and dates from scanned segments
  useEffect(() => {
    if (!showNewTripForm) return;
    if (!newTripTitle && suggestedTripName) setNewTripTitle(suggestedTripName);
    if (!newTripStart && scannedDateRange) setNewTripStart(scannedDateRange.start);
    if (!newTripEnd && scannedDateRange) setNewTripEnd(scannedDateRange.end);
  }, [showNewTripForm, scannedDateRange, suggestedTripName]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScan = async () => {
    setStep("scanning");
    setErrorMessage("");

    try {
      const input: Record<string, unknown> = {};
      if (tripId) input.tripId = tripId;
      if (selectedLabel && selectedLabel !== "__all__") input.labelFilter = selectedLabel;
      if (forceRescan) input.forceRescan = true;

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

      // If we got partial results with a billing or overloaded error, show them
      if (
        (status === 402 || status === 503) &&
        body?.results &&
        body.results.length > 0
      ) {
        loadResultsIntoState(body.results);
        setErrorMessage(
          body.error ||
            (status === 503
              ? "The AI service is temporarily overloaded. Please try scanning again in a few minutes. You can still process the segments that were already parsed."
              : "AI service needs credits. You can still process the segments that were already parsed."),
        );
        setStep("results");
        return;
      }

      if (status === 403 && body?.code === "GMAIL_SCOPE_REQUIRED") {
        setErrorMessage(
          "Gmail access is required. Please sign out and sign back in, granting Gmail permissions when prompted.",
        );
      } else if (status === 503 && body?.code === "ANTHROPIC_OVERLOADED") {
        setErrorMessage(
          "The AI service is temporarily overloaded. Please try scanning again in a few minutes.",
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

  const setActionForSegment = (index: number, action: ApplyAction) => {
    setSelections((prev) =>
      prev.map((s, i) => (i === index ? { ...s, action } : s)),
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
        departureAirport: s.departureAirport,
        arrivalAirport: s.arrivalAirport,
        carrier: s.carrier,
        routeCode: s.routeCode,
        partySize: s.partySize,
        creditCardHold: s.creditCardHold,
        phone: s.phone,
        endDate: s.endDate,
        portsOfCall: s.portsOfCall,
        breakfastIncluded: s.breakfastIncluded,
        seatNumber: s.seatNumber,
        cabinClass: s.cabinClass,
        baggageInfo: s.baggageInfo,
        contactName: s.contactName,
        cost: s.cost,
        confidence: s.confidence,
        tripId: s.assignedTripId,
        emailId: s.emailId,
        action: s.action,
        existingSegmentId:
          s.action === "merge" || s.action === "replace"
            ? s.existingSegmentId
            : undefined,
      }));

      const res = await applySegments.mutateAsync({ segments: resolvedSegments });
      setAppliedCount(res.created.length + (res.updated?.length ?? 0));

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

  // Counts by match status (for summary bar)
  const matchCounts = selections.reduce(
    (acc, s) => {
      const status: SegmentMatchStatus = s.match?.status ?? "new";
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    },
    {} as Record<SegmentMatchStatus, number>,
  );

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
          <Mail className="h-4 w-4 sm:mr-2" />
          <span className="hidden sm:inline">{triggerLabel}</span>
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

              <label className="flex items-start gap-2 rounded-md border border-border p-2.5 text-xs cursor-pointer hover:bg-muted/50 transition-colors">
                <input
                  type="checkbox"
                  checked={forceRescan}
                  onChange={(e) => setForceRescan(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer"
                />
                <div className="space-y-0.5">
                  <p className="font-medium text-foreground">Re-parse previously processed emails</p>
                  <p className="text-muted-foreground">
                    Retries emails that were previously skipped, failed, or already parsed. Use this to recover after fixing a parser bug. Emails already applied to trips are not re-parsed.
                  </p>
                </div>
              </label>
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
                  {matchCounts.new > 0 && (
                    <span className="flex items-center gap-1.5 text-blue-700">
                      <Plus className="h-4 w-4" />
                      {matchCounts.new} new
                    </span>
                  )}
                  {matchCounts.enrichment > 0 && (
                    <span className="flex items-center gap-1.5 text-violet-700">
                      <CheckCircle2 className="h-4 w-4" />
                      {matchCounts.enrichment} with details
                    </span>
                  )}
                  {matchCounts.conflict > 0 && (
                    <span className="flex items-center gap-1.5 text-orange-700">
                      <AlertCircle className="h-4 w-4" />
                      {matchCounts.conflict} conflict{matchCounts.conflict !== 1 ? "s" : ""}
                    </span>
                  )}
                  {matchCounts.duplicate > 0 && (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <MinusCircle className="h-4 w-4" />
                      {matchCounts.duplicate} already present
                    </span>
                  )}
                  {noTravelResults.length > 0 && (
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <MinusCircle className="h-4 w-4" />
                      {noTravelResults.length} skipped
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
                            onSetAction={setActionForSegment}
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
                                onSetAction={setActionForSegment}
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
  onSetAction,
  onRequestNewTrip,
}: {
  seg: SegmentSelection;
  index: number;
  results: EmailScanResult[];
  trips: Array<{ id: string; title: string; startDate: string }>;
  onToggle: (idx: number) => void;
  onSetTrip: (idx: number, tripId: string) => void;
  onSetAction: (idx: number, action: ApplyAction) => void;
  onRequestNewTrip: () => void;
}) {
  const email = results.find((r) => r.emailId === seg.emailId);
  const matchStatus: SegmentMatchStatus = seg.match?.status ?? "new";
  const hasExistingMatch = Boolean(seg.existingSegmentId);

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
                MATCH_STATUS_STYLES[matchStatus],
              )}
            >
              {MATCH_STATUS_LABEL[matchStatus]}
            </Badge>
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

          {/* Match details: new fields being added / conflicting fields */}
          {hasExistingMatch && (matchStatus === "enrichment" || matchStatus === "conflict") && (
            <div className="mt-1.5 space-y-1 rounded border border-dashed border-muted-foreground/20 bg-muted/30 p-1.5 text-[11px]">
              {seg.match?.newFields && seg.match.newFields.length > 0 && (
                <div>
                  <span className="font-medium text-violet-700">Adds: </span>
                  <span className="text-muted-foreground">
                    {seg.match.newFields.join(", ")}
                  </span>
                </div>
              )}
              {seg.match?.conflictFields && seg.match.conflictFields.length > 0 && (
                <div className="space-y-0.5">
                  <span className="font-medium text-orange-700">Conflicts:</span>
                  {seg.match.conflictFields.map((diff) => (
                    <div key={diff.field} className="pl-2 text-muted-foreground">
                      <span className="font-mono text-[10px]">{diff.field}:</span>{" "}
                      <span className="line-through">{String(diff.existing ?? "—")}</span>
                      {" → "}
                      <span className="text-foreground">{String(diff.parsed ?? "—")}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Action selector: only meaningful when an existing match is available */}
          {seg.selected && hasExistingMatch && matchStatus !== "new" && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {(["merge", "replace", "create"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => onSetAction(index, a)}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                    seg.action === a
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                  )}
                  title={
                    a === "merge"
                      ? "Fill empty fields from email; keep existing values"
                      : a === "replace"
                        ? "Overwrite existing fields with email data"
                        : "Add as a new separate segment"
                  }
                >
                  {a === "merge" ? "Merge" : a === "replace" ? "Replace" : "Add new"}
                </button>
              ))}
            </div>
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
        {emails.length} skipped email{emails.length !== 1 ? "s" : ""} (duplicates or non-travel)
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
            These emails are likely duplicates of bookings already extracted, or not related to travel segments. They won&apos;t be scanned again.
          </p>
        </div>
      )}
    </div>
  );
}
