"use client";

import { useEffect, useState } from "react";
import { useReportEmail } from "@travel-app/api-client";
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
import { Loader2, Send } from "lucide-react";
import { describeError } from "@/lib/api-error";

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
  /**
   * Email subject for display in the dialog. Optional — when omitted the
   * dialog just shows the reason.
   */
  emailSubject?: string;
  /**
   * Inline email content for sources we can't refetch server-side
   * (HTML/EML imports). Pass `body` for those flows; for Gmail-scanned
   * emails leave undefined and the server will refetch from Gmail.
   */
  inlineEmail?: {
    subject?: string;
    from?: string;
    receivedAt?: string;
    body: string;
  };
}

/**
 * Lightweight dialog that lets a user report an email that wasn't parsed
 * correctly. Submits to POST /emails/report — the server forwards to the
 * operator inbox and captures a Sentry event. The user is told that the
 * full email content is sent to us so they can make an informed decision.
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
  const reportEmail = useReportEmail();

  // Reset state whenever the dialog opens for a different email.
  useEffect(() => {
    if (open) {
      setReason(defaultReason);
      setUserNote("");
      setExpectedOutcome("");
    }
  }, [open, defaultReason, emailId]);

  const handleSubmit = async () => {
    try {
      const res = await reportEmail.mutateAsync({
        emailId,
        reason,
        userNote: userNote.trim() || undefined,
        expectedOutcome: expectedOutcome.trim() || undefined,
        inlineEmail,
      });
      toast.success("Report sent. Thanks!", {
        description: res.delivered
          ? "We'll take a look and try to do better next time."
          : "We received it (delivery is queued).",
      });
      onOpenChange(false);
    } catch (err) {
      toast.error("Couldn't send report", { description: describeError(err) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report this email</DialogTitle>
          <DialogDescription>
            We&apos;ll receive the full email contents along with your note so
            we can debug the parser. Reports go to{" "}
            <code>emailerror@itinly.app</code>.
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
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={reportEmail.isPending}>
            {reportEmail.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="mr-1.5 h-3.5 w-3.5" />
            )}
            Send report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
