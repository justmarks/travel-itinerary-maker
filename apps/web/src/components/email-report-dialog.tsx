"use client";

import { useEffect, useMemo, useState } from "react";
import type { ParseReportReason } from "@travel-app/shared";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send } from "lucide-react";

const REPORT_TO = "emailerror@itinly.app";

/**
 * Conservative cap on the mailto: URL length. Mail clients vary widely —
 * macOS Mail and Outlook handle ~2k cleanly, Gmail web handles much more,
 * but Windows Mail truncates anything past ~2000 characters. We trim the
 * body when needed and let the user paste more content into the draft.
 */
const MAILTO_BODY_BUDGET = 6000;

const REASON_LABEL: Record<ParseReportReason, string> = {
  failed: "Parser failed",
  no_travel_content: "Said “no travel content”",
  parsed_wrong: "Got the details wrong",
};

const REASON_HINT: Record<ParseReportReason, string> = {
  failed: "We couldn't extract anything from this email.",
  no_travel_content:
    "We marked this as not a travel email, but you say it is.",
  parsed_wrong: "We extracted segments but they don't match the booking.",
};

export interface EmailReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  emailId: string;
  defaultReason: ParseReportReason;
  /** Email subject for display in the dialog. */
  emailSubject?: string;
  /**
   * Inline email content for sources we can include in the mailto draft
   * (HTML/EML imports). For Gmail-scanned emails this is undefined and
   * the dialog tells the user to forward the original separately.
   */
  inlineEmail?: {
    subject?: string;
    from?: string;
    receivedAt?: string;
    body: string;
  };
}

function buildMailtoBody(opts: {
  reason: ParseReportReason;
  emailId: string;
  userNote: string;
  expectedOutcome: string;
  inlineEmail?: EmailReportDialogProps["inlineEmail"];
}): string {
  const { reason, emailId, userNote, expectedOutcome, inlineEmail } = opts;
  const lines: string[] = [];
  lines.push(`Reason: ${REASON_LABEL[reason]}`);
  lines.push(`Email ID: ${emailId}`);
  lines.push("");

  if (userNote.trim()) {
    lines.push("--- What went wrong ---");
    lines.push(userNote.trim());
    lines.push("");
  }
  if (expectedOutcome.trim()) {
    lines.push("--- What I expected ---");
    lines.push(expectedOutcome.trim());
    lines.push("");
  }

  if (inlineEmail) {
    lines.push("--- Original email ---");
    if (inlineEmail.subject) lines.push(`Subject: ${inlineEmail.subject}`);
    if (inlineEmail.from) lines.push(`From: ${inlineEmail.from}`);
    if (inlineEmail.receivedAt)
      lines.push(`Received: ${inlineEmail.receivedAt}`);
    lines.push("");
    lines.push(inlineEmail.body);
  } else {
    lines.push(
      "(If helpful, please forward the original email to " +
        REPORT_TO +
        " from your inbox.)",
    );
  }

  let body = lines.join("\n");
  if (body.length > MAILTO_BODY_BUDGET) {
    body =
      body.slice(0, MAILTO_BODY_BUDGET) +
      "\n\n[…truncated — original email is too long for a mailto draft. Please paste the rest manually or forward the original.]";
  }
  return body;
}

/**
 * Lightweight dialog that lets a user report an email that wasn't parsed
 * correctly. Composes a `mailto:emailerror@itinly.app` draft pre-filled
 * with the reason, the user's note, and the email content (when we have
 * it — HTML/EML imports). For Gmail-scanned emails the body lives only in
 * the user's Gmail, so we ask them to forward it separately.
 */
export function EmailReportDialog({
  open,
  onOpenChange,
  emailId,
  defaultReason,
  emailSubject,
  inlineEmail,
}: EmailReportDialogProps): React.JSX.Element {
  const [reason, setReason] = useState<ParseReportReason>(defaultReason);
  const [userNote, setUserNote] = useState("");
  const [expectedOutcome, setExpectedOutcome] = useState("");

  // Reset state whenever the dialog opens for a different email.
  useEffect(() => {
    if (open) {
      setReason(defaultReason);
      setUserNote("");
      setExpectedOutcome("");
    }
  }, [open, defaultReason, emailId]);

  const mailtoHref = useMemo(() => {
    const subject =
      `Parse report: ${REASON_LABEL[reason]}` +
      (emailSubject ? ` — ${emailSubject}` : "");
    const body = buildMailtoBody({
      reason,
      emailId,
      userNote,
      expectedOutcome,
      inlineEmail,
    });
    return (
      `mailto:${REPORT_TO}` +
      `?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(body)}`
    );
  }, [reason, emailId, emailSubject, userNote, expectedOutcome, inlineEmail]);

  const handleSubmit = () => {
    // Open in a new tab so the dialog state isn't lost if the user's mail
    // client takes a moment to launch. Most browsers route mailto: to the
    // OS handler regardless of target.
    window.open(mailtoHref, "_blank", "noopener,noreferrer");
    toast.success("Opening your mail app", {
      description: `We pre-filled a draft to ${REPORT_TO}.`,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report this email</DialogTitle>
          <DialogDescription>
            We&apos;ll open a draft in your mail app so you can review what
            gets sent. Reports go to <code>{REPORT_TO}</code>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {emailSubject && (
            <div className="rounded border bg-muted/30 p-2 text-xs">
              <p className="truncate font-medium">{emailSubject}</p>
            </div>
          )}

          <div className="space-y-1.5">
            <p className="text-xs font-medium">What went wrong?</p>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(REASON_LABEL) as ParseReportReason[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={
                    "rounded-full border px-2.5 py-0.5 text-xs transition-colors " +
                    (reason === r
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground")
                  }
                >
                  {REASON_LABEL[r]}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {REASON_HINT[reason]}
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium" htmlFor="report-note">
              Note <span className="text-muted-foreground">(optional)</span>
            </label>
            <Textarea
              id="report-note"
              value={userNote}
              onChange={(e) => setUserNote(e.target.value)}
              placeholder="Anything else we should know?"
              rows={3}
              maxLength={2000}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium" htmlFor="report-expected">
              What did you expect?{" "}
              <span className="text-muted-foreground">(optional)</span>
            </label>
            <Textarea
              id="report-expected"
              value={expectedOutcome}
              onChange={(e) => setExpectedOutcome(e.target.value)}
              placeholder="e.g. one hotel segment for Hilton Tokyo, 2026-06-10 to 2026-06-14"
              rows={2}
              maxLength={2000}
            />
          </div>

          {!inlineEmail && (
            <p className="rounded border border-dashed border-muted-foreground/30 bg-muted/20 p-2 text-[11px] text-muted-foreground">
              We can&apos;t attach the original email automatically — if it
              would help us debug, please forward it to {REPORT_TO} from your
              inbox after sending this draft.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Open mail draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
