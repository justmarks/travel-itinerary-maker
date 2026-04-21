"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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
}) {
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

  const importMutation = useImportHtmlEmail();
  const applyMutation = useApplyParsedSegments();
  const { data: trips } = useTrips();

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
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) {
        // Defer reset so the closing animation finishes cleanly.
        setTimeout(resetState, 200);
      }
    },
    [resetState],
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
        carrier: s.carrier,
        routeCode: s.routeCode,
        partySize: s.partySize,
        creditCardHold: s.creditCardHold,
        phone: s.phone,
        endDate: s.endDate,
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
