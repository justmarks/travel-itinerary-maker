"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  EmailScanResult,
  ParsedSegment,
  SegmentMatchStatus,
  ApplyAction,
} from "@travel-app/shared";
import {
  useImportHtmlEmail,
  useApplyParsedSegments,
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
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  FileCode2,
  Loader2,
  Upload,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Plus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

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

type ImportStep = "input" | "parsing" | "results" | "applying" | "done" | "error";
type ImportFormat = "html" | "eml";

interface SegmentSelection extends ParsedSegment {
  emailId: string;
  selected: boolean;
  assignedTripId: string;
  action: ApplyAction;
  existingSegmentId?: string;
}

/**
 * Sniff whether the pasted/uploaded content looks like an EML (RFC 822)
 * file vs raw HTML. EML files start with MIME headers like "From: ",
 * "Subject: ", "MIME-Version: " etc. HTML almost always starts with a
 * doctype, <html> tag, or some visible tag.
 */
function sniffFormat(content: string): ImportFormat {
  const head = content.trimStart().slice(0, 500);
  // Header-style lines at the top — treat as EML.
  if (
    /^(from|to|subject|date|message-id|mime-version|content-type|received|return-path|delivered-to|reply-to):\s/im.test(
      head,
    )
  ) {
    return "eml";
  }
  return "html";
}

function defaultActionFor(status: SegmentMatchStatus | undefined): ApplyAction {
  switch (status) {
    case "enrichment":
    case "conflict":
      return "merge";
    case "duplicate":
    case "new":
    default:
      return "create";
  }
}

/**
 * Dialog for importing a saved .html email (or pasted HTML). The content is
 * sent to the server which runs it through the same Claude-based parser used
 * for Gmail scans, and the extracted segments are shown for review and apply
 * just like a Gmail scan result.
 */
export function HtmlImportDialog({
  tripId,
  triggerLabel = "Import email",
  triggerVariant = "outline",
  triggerSize = "sm",
  hideTrigger = false,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: {
  tripId?: string;
  triggerLabel?: string;
  triggerVariant?: "outline" | "default" | "ghost";
  triggerSize?: "sm" | "default" | "lg";
  hideTrigger?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}): React.JSX.Element | null {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = useCallback(
    (v: boolean) => {
      if (controlledOnOpenChange) controlledOnOpenChange(v);
      else setUncontrolledOpen(v);
    },
    [controlledOnOpenChange],
  );
  const [step, setStep] = useState<ImportStep>("input");
  const [content, setContent] = useState("");
  const [format, setFormat] = useState<ImportFormat>("html");
  const [subject, setSubject] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [receivedAt, setReceivedAt] = useState("");
  const [result, setResult] = useState<EmailScanResult | null>(null);
  const [selections, setSelections] = useState<SegmentSelection[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [appliedCount, setAppliedCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Inline new-trip creation
  const [showNewTripForm, setShowNewTripForm] = useState(false);
  const [newTripTitle, setNewTripTitle] = useState("");
  const [newTripStart, setNewTripStart] = useState("");
  const [newTripEnd, setNewTripEnd] = useState("");
  const [creatingTrip, setCreatingTrip] = useState(false);

  const importMutation = useImportHtmlEmail();
  const applyMutation = useApplyParsedSegments();
  const { data: trips } = useTrips();
  const createTrip = useCreateTrip();

  const resetState = useCallback(() => {
    setStep("input");
    setContent("");
    setFormat("html");
    setSubject("");
    setFromAddress("");
    setReceivedAt("");
    setResult(null);
    setSelections([]);
    setErrorMessage("");
    setAppliedCount(0);
    setShowNewTripForm(false);
    setNewTripTitle("");
    setNewTripStart("");
    setNewTripEnd("");
    setCreatingTrip(false);
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) {
        // Defer reset so the closing animation finishes cleanly.
        setTimeout(resetState, 200);
      }
    },
    // setOpen is a stable setState — not required in deps per React docs,
    // but ESLint's exhaustive-deps can't verify that without extra info.
    [resetState, setOpen],
  );

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        setContent(text);
        // Prefer the explicit extension; fall back to content sniffing.
        const isEml = /\.eml$/i.test(file.name);
        const isHtml = /\.html?$/i.test(file.name);
        const detected: ImportFormat = isEml
          ? "eml"
          : isHtml
            ? "html"
            : sniffFormat(text);
        setFormat(detected);
        if (!subject) {
          setSubject(file.name.replace(/\.(html?|eml)$/i, ""));
        }
      } catch (err) {
        console.error("Failed to read file:", err);
        setErrorMessage("Failed to read file");
      }
    },
    [subject],
  );

  const handlePaste = useCallback((value: string) => {
    setContent(value);
    // Auto-detect when the user pastes — they may drop in either format.
    if (value.trim()) {
      setFormat(sniffFormat(value));
    }
  }, []);

  const handleImport = useCallback(async () => {
    if (!content.trim()) {
      setErrorMessage("Paste an email or upload an .html / .eml file first.");
      return;
    }
    setStep("parsing");
    setErrorMessage("");
    try {
      const response = await importMutation.mutateAsync({
        ...(format === "eml"
          ? { eml: content }
          : { html: content }),
        subject: subject || undefined,
        from: fromAddress || undefined,
        receivedAt: receivedAt
          ? new Date(receivedAt).toISOString()
          : undefined,
        tripId,
      });
      setResult(response.result);
      setSelections(
        response.result.parsedSegments.map((seg) => ({
          ...seg,
          emailId: response.result.emailId,
          selected:
            seg.match?.status !== "duplicate" &&
            (seg.confidence === "high" || seg.confidence === "medium"),
          assignedTripId: seg.suggestedTripId || tripId || "",
          action: defaultActionFor(seg.match?.status),
          existingSegmentId: seg.match?.existingSegmentId,
        })),
      );
      setStep("results");
    } catch (err) {
      console.error("HTML import failed:", err);
      if (err instanceof ApiError) {
        const body = err.body as { error?: string; code?: string };
        setErrorMessage(body.error || `Import failed (${err.status})`);
      } else {
        setErrorMessage(err instanceof Error ? err.message : "Import failed");
      }
      setStep("error");
    }
  }, [content, format, subject, fromAddress, receivedAt, tripId, importMutation]);

  const toggleSelection = useCallback((index: number) => {
    setSelections((prev) =>
      prev.map((sel, i) =>
        i === index ? { ...sel, selected: !sel.selected } : sel,
      ),
    );
  }, []);

  const updateAssignedTrip = useCallback((index: number, value: string) => {
    if (value === "__create_new__") {
      setShowNewTripForm(true);
      return;
    }
    setSelections((prev) =>
      prev.map((sel, i) =>
        i === index ? { ...sel, assignedTripId: value } : sel,
      ),
    );
  }, []);

  const selectedCount = useMemo(
    () =>
      selections.filter((s) => s.selected && s.assignedTripId).length,
    [selections],
  );

  // Compute date range from all parsed segments for new-trip defaults.
  const scannedDateRange = useMemo(() => {
    const dates = selections.map((s) => s.date).filter(Boolean).sort();
    if (dates.length === 0) return null;
    return { start: dates[0], end: dates[dates.length - 1] };
  }, [selections]);

  // Suggest a trip name from destination cities + year.
  const suggestedTripName = useMemo(() => {
    if (selections.length === 0) return "";
    const cities: string[] = [];
    for (const s of selections) {
      if (s.type === "flight" && s.arrivalCity) {
        cities.push(s.arrivalCity);
      } else if (s.city) {
        cities.push(s.city);
      }
    }
    if (cities.length === 0) return "";
    const counts = new Map<string, number>();
    for (const c of cities) {
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    const topCity = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const year = selections[0]?.date?.slice(0, 4) || "";
    return year ? `${topCity} ${year}` : topCity;
  }, [selections]);

  // Any selected segment that has not been assigned to a trip.
  const hasUnassignedSegments = selections.some(
    (s) => s.selected && !s.assignedTripId,
  );

  // Auto-show the new trip form when viewing results with unassigned
  // segments and no existing trips to pick from.
  useEffect(() => {
    if (
      step === "results" &&
      hasUnassignedSegments &&
      !showNewTripForm &&
      (!trips || trips.length === 0)
    ) {
      setShowNewTripForm(true);
    }
  }, [step, hasUnassignedSegments, trips]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-populate the new trip form with suggestions from the parsed segments.
  useEffect(() => {
    if (!showNewTripForm) return;
    if (!newTripTitle && suggestedTripName) setNewTripTitle(suggestedTripName);
    if (!newTripStart && scannedDateRange) setNewTripStart(scannedDateRange.start);
    if (!newTripEnd && scannedDateRange) setNewTripEnd(scannedDateRange.end);
  }, [showNewTripForm, scannedDateRange, suggestedTripName]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Create a new trip and auto-assign selected segments whose dates fall in range. */
  const handleCreateTrip = useCallback(async () => {
    if (!newTripTitle || !newTripStart || !newTripEnd) return;
    setCreatingTrip(true);
    setErrorMessage("");
    try {
      const trip = await createTrip.mutateAsync({
        title: newTripTitle,
        startDate: newTripStart,
        endDate: newTripEnd,
      });
      setSelections((prev) =>
        prev.map((s) => {
          if (
            s.selected &&
            !s.assignedTripId &&
            s.date >= newTripStart &&
            s.date <= newTripEnd
          ) {
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
  }, [newTripTitle, newTripStart, newTripEnd, createTrip]);

  const handleApply = useCallback(async () => {
    const segments = selections
      .filter((s) => s.selected && s.assignedTripId)
      .map((s) => ({
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
        existingSegmentId: s.existingSegmentId,
      }));

    if (segments.length === 0) {
      setErrorMessage("Select at least one segment and assign a trip.");
      return;
    }

    setStep("applying");
    setErrorMessage("");
    try {
      const res = await applyMutation.mutateAsync({ segments });
      setAppliedCount(res.created.length + (res.updated?.length ?? 0));
      setStep("done");
    } catch (err) {
      console.error("Apply failed:", err);
      setErrorMessage(err instanceof Error ? err.message : "Apply failed");
      setStep("error");
    }
  }, [selections, applyMutation]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button variant={triggerVariant} size={triggerSize}>
            <FileCode2 className="mr-2 h-4 w-4" />
            {triggerLabel}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="flex max-h-[85vh] w-[50vw] max-w-[50vw] flex-col overflow-hidden sm:max-w-[50vw]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileCode2 className="h-5 w-5" />
            Import email
          </DialogTitle>
          <DialogDescription>
            Paste a travel confirmation email (or upload a saved{" "}
            <code>.html</code> or <code>.eml</code> file). The same Claude
            parser used for Gmail scans will extract segments from it.
          </DialogDescription>
        </DialogHeader>

        {step === "input" && (
          <div className="flex min-h-0 flex-1 flex-col space-y-4 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".html,.htm,.eml,text/html,message/rfc822"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="mr-2 h-4 w-4" />
                Upload .html / .eml file
              </Button>
              <span className="text-xs text-zinc-500">
                or paste the email source below
              </span>
              {content.trim() && (
                <Badge
                  variant="outline"
                  className="ml-auto text-xs uppercase tracking-wide"
                >
                  Detected: {format}
                </Badge>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-zinc-600">
                  Subject (optional)
                </label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Your hotel booking"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600">
                  Received date (optional)
                </label>
                <Input
                  type="date"
                  value={receivedAt}
                  onChange={(e) => setReceivedAt(e.target.value)}
                />
              </div>
              <div className="sm:col-span-3">
                <label className="mb-1 block text-xs font-medium text-zinc-600">
                  From (optional)
                </label>
                <Input
                  value={fromAddress}
                  onChange={(e) => setFromAddress(e.target.value)}
                  placeholder="e.g. noreply@hotel.example"
                />
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              <label className="mb-1 block text-xs font-medium text-zinc-600">
                Email source ({format.toUpperCase()})
              </label>
              <Textarea
                value={content}
                onChange={(e) => handlePaste(e.target.value)}
                placeholder={
                  format === "eml"
                    ? "From: ...\nSubject: ...\n\nbody"
                    : "<html>...</html>"
                }
                className="min-h-0 flex-1 resize-none font-mono text-xs"
              />
              <p className="mt-1 text-xs text-zinc-500">
                {content.length.toLocaleString()} characters
              </p>
            </div>

            {errorMessage && (
              <p className="shrink-0 text-sm text-red-600">{errorMessage}</p>
            )}

            <DialogFooter className="shrink-0 border-t pt-3">
              <Button variant="ghost" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleImport} disabled={!content.trim()}>
                Parse {format.toUpperCase()}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "parsing" && (
          <div className="flex flex-col items-center gap-3 py-10">
            <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
            <p className="text-sm text-zinc-600">
              Parsing {format.toUpperCase()} with Claude — this takes a few
              seconds…
            </p>
          </div>
        )}

        {step === "results" && result && (
          <div className="flex min-h-0 flex-1 flex-col py-2">
            <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            {/* New Trip creation — banner + inline form when segments are unassigned */}
            {result.parsedSegments.length > 0 &&
              hasUnassignedSegments &&
              !showNewTripForm && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
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
              <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-blue-900">
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
                  className="h-8 bg-white text-sm"
                  autoFocus
                />
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-[10px] text-blue-700">Start date</label>
                    <Input
                      type="date"
                      value={newTripStart}
                      onChange={(e) => setNewTripStart(e.target.value)}
                      className="h-8 bg-white text-sm"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] text-blue-700">End date</label>
                    <Input
                      type="date"
                      value={newTripEnd}
                      onChange={(e) => setNewTripEnd(e.target.value)}
                      className="h-8 bg-white text-sm"
                    />
                  </div>
                </div>
                <Button
                  size="sm"
                  className="h-8 w-full text-xs"
                  onClick={handleCreateTrip}
                  disabled={
                    creatingTrip ||
                    !newTripTitle ||
                    !newTripStart ||
                    !newTripEnd
                  }
                >
                  {creatingTrip ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {creatingTrip
                    ? "Creating..."
                    : "Create & Assign Matching Segments"}
                </Button>
              </div>
            )}

            {result.parsedSegments.length === 0 ? (
              <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>
                  No travel content detected in this {format.toUpperCase()}.
                  Try a different email or double-check the source.
                </span>
              </div>
            ) : (
              <>
                <p className="text-sm text-zinc-600">
                  Extracted <strong>{result.parsedSegments.length}</strong>{" "}
                  segment{result.parsedSegments.length === 1 ? "" : "s"}.
                  Select which ones to apply and pick the trip they belong to.
                </p>
                <ul className="space-y-2">
                  {selections.map((sel, i) => (
                    <li
                      key={`${sel.type}-${sel.date}-${i}`}
                      className={cn(
                        "rounded-md border p-3",
                        sel.selected
                          ? "border-zinc-300 bg-white"
                          : "border-zinc-200 bg-zinc-50 opacity-70",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={sel.selected}
                          onChange={() => toggleSelection(i)}
                          className="mt-1"
                        />
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{sel.title}</span>
                            <Badge variant="outline" className="text-xs">
                              {sel.type}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              {sel.date}
                            </Badge>
                            {sel.match?.status && (
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-xs",
                                  MATCH_STATUS_STYLES[sel.match.status],
                                )}
                              >
                                {MATCH_STATUS_LABEL[sel.match.status]}
                              </Badge>
                            )}
                          </div>
                          {(sel.city || sel.cost) && (
                            <div className="mt-1 text-xs text-zinc-500">
                              {sel.city && <span>{sel.city}</span>}
                              {sel.city && sel.cost && <span> · </span>}
                              {sel.cost && (
                                <span>
                                  {sel.cost.currency} {sel.cost.amount.toFixed(2)}
                                </span>
                              )}
                            </div>
                          )}
                          <div className="mt-2">
                            <label className="mr-2 text-xs text-zinc-500">
                              Apply to trip:
                            </label>
                            <Select
                              value={sel.assignedTripId || undefined}
                              onValueChange={(v) => updateAssignedTrip(i, v)}
                            >
                              <SelectTrigger className="h-8 w-[260px] text-xs">
                                <SelectValue placeholder="Select a trip" />
                              </SelectTrigger>
                              <SelectContent>
                                {(trips ?? []).map((t) => (
                                  <SelectItem key={t.id} value={t.id}>
                                    {t.title} ({t.startDate} → {t.endDate})
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
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}

            </div>

            {errorMessage && (
              <p className="shrink-0 text-sm text-red-600">{errorMessage}</p>
            )}

            <DialogFooter className="shrink-0 border-t pt-3">
              <Button variant="ghost" onClick={() => setStep("input")}>
                Back
              </Button>
              <Button
                onClick={handleApply}
                disabled={selectedCount === 0}
              >
                Apply {selectedCount} segment{selectedCount === 1 ? "" : "s"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === "applying" && (
          <div className="flex flex-col items-center gap-3 py-10">
            <Loader2 className="h-8 w-8 animate-spin text-zinc-500" />
            <p className="text-sm text-zinc-600">Applying segments…</p>
          </div>
        )}

        {step === "done" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <CheckCircle2 className="h-10 w-10 text-green-600" />
            <p className="text-sm text-zinc-700">
              Applied {appliedCount} segment{appliedCount === 1 ? "" : "s"}.
            </p>
            <Button variant="outline" onClick={() => handleOpenChange(false)}>
              Close
            </Button>
          </div>
        )}

        {step === "error" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <XCircle className="h-10 w-10 text-red-600" />
            <p className="text-sm text-red-700">{errorMessage}</p>
            <Button variant="outline" onClick={() => setStep("input")}>
              Try again
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
