"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  useCreateEmailScanSchedule,
  useDeleteEmailScanSchedule,
  useEmailScanRuns,
  useEmailScanSchedules,
  useGmailLabels,
  useUpdateEmailScanSchedule,
} from "@itinly/api-client";
import type {
  EmailScanFrequency,
  EmailScanRun,
  EmailScanSchedule,
} from "@itinly/shared";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  Loader2,
  Pause,
  Play,
  Plus,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useConnectedEmailProviders,
  emailProviderLabel,
  emailLabelNoun,
  type EmailProvider,
} from "@/lib/use-active-provider";
import { buildGmailLabelTree, indentedLabel } from "@/lib/gmail-labels";
import { toastMutationError } from "@/lib/api-error";
import { useConfirm } from "@/lib/confirm-dialog";
import { cn } from "@/lib/utils";

const FREQUENCY_LABELS: Record<EmailScanFrequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

const STATUS_TOKEN: Record<EmailScanRun["status"], string> = {
  running: "info",
  succeeded: "ok",
  failed: "danger",
};

/**
 * Format the "Next run" timestamp as a short, friendly relative string
 * ("in 4h", "tomorrow", "in 3d"). Falls through to a localised date
 * when the offset is beyond a week.
 */
function fmtNextRun(iso: string): string {
  const target = new Date(iso).getTime();
  const now = Date.now();
  const ms = target - now;
  if (ms <= 0) return "any moment";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return hours === 24 ? "tomorrow" : `in ${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 8) return `in ${days}d`;
  return new Date(iso).toLocaleDateString();
}

function fmtRunStarted(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Top-level panel — mount this inside an account-settings page or a
 * standalone /settings/scans route. Renders the list of schedules,
 * a "+" button to create one, and inline edit/delete affordances.
 */
export function EmailScanSchedulesPanel(): React.JSX.Element {
  const { data: schedules, isLoading, isError } = useEmailScanSchedules();
  const { providers: connectedProviders } = useConnectedEmailProviders();
  const [createOpen, setCreateOpen] = useState(false);

  const noProviders = connectedProviders.length === 0;

  return (
    <section>
      <header className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Scheduled scans</h2>
          <p className="text-sm text-muted-foreground">
            Have itinly scan your mailbox on a regular cadence and notify
            you when new bookings turn up.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setCreateOpen(true)}
          disabled={noProviders}
          title={
            noProviders
              ? "Connect Gmail or Outlook first from the section above"
              : "Add a new scheduled scan"
          }
        >
          <Plus className="h-4 w-4" />
          New
        </Button>
      </header>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading schedules…
        </div>
      ) : isError ? (
        <div
          className="flex items-start gap-2 rounded-md border p-3 text-sm"
          style={{
            backgroundColor: "var(--status-danger-bg)",
            color: "var(--status-danger-fg)",
            borderColor: "var(--status-danger-rail)",
          }}
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          Couldn&apos;t load schedules. Try refreshing.
        </div>
      ) : !schedules || schedules.length === 0 ? (
        <EmptyState onAdd={() => setCreateOpen(true)} disabled={noProviders} />
      ) : (
        <ul className="flex flex-col gap-2">
          {schedules.map((s) => (
            <ScheduleRow key={s.id} schedule={s} />
          ))}
        </ul>
      )}

      <ScheduleEditorDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        schedule={null}
      />
    </section>
  );
}

function EmptyState({
  onAdd,
  disabled,
}: {
  onAdd: () => void;
  disabled: boolean;
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-dashed border-border p-6 text-center">
      <Calendar className="mx-auto h-7 w-7 text-muted-foreground" />
      <p className="mt-2 text-sm font-medium">No scheduled scans</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Set one up to have itinly poll your mailbox automatically.
      </p>
      <Button size="sm" className="mt-3" onClick={onAdd} disabled={disabled}>
        <Plus className="h-4 w-4" />
        Add a schedule
      </Button>
    </div>
  );
}

function ScheduleRow({
  schedule,
}: {
  schedule: EmailScanSchedule;
}): React.JSX.Element {
  const [editOpen, setEditOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const update = useUpdateEmailScanSchedule();
  const remove = useDeleteEmailScanSchedule();
  const confirm = useConfirm();

  const togglePause = () => {
    update.mutate(
      { id: schedule.id, input: { enabled: !schedule.enabled } },
      { onError: toastMutationError("update schedule") },
    );
  };

  const onDelete = async () => {
    const ok = await confirm({
      title: "Delete this schedule?",
      description:
        "The mailbox stays untouched — only the recurring scan and its run history are removed.",
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;
    remove.mutate(schedule.id, {
      onSuccess: () => toast.success("Schedule deleted"),
      onError: toastMutationError("delete schedule"),
    });
  };

  return (
    <li className="rounded-md border border-border bg-card p-3">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-foreground/80",
            schedule.enabled ? "bg-muted" : "bg-muted/40 opacity-60",
          )}
          aria-hidden
        >
          <Calendar className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {FREQUENCY_LABELS[schedule.frequency]} scan ·{" "}
            {emailProviderLabel(schedule.provider as EmailProvider)}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {schedule.labelName ||
              (schedule.labelFilter
                ? schedule.labelFilter
                : `All ${emailLabelNoun(schedule.provider as EmailProvider)}s`)}
            {" · "}
            {schedule.enabled ? (
              <>Next run {fmtNextRun(schedule.nextRunAt)}</>
            ) : (
              <span style={{ color: "var(--status-warn-fg)" }}>Paused</span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setHistoryOpen(true)}
            title="Run history"
          >
            <Clock className="h-3.5 w-3.5" />
            History
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={togglePause}
            disabled={update.isPending}
            title={schedule.enabled ? "Pause schedule" : "Resume schedule"}
          >
            {schedule.enabled ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setEditOpen(true)}
            title="Edit schedule"
          >
            <Calendar className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDelete}
            disabled={remove.isPending}
            className="hover:text-destructive"
            title="Delete schedule"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <ScheduleEditorDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        schedule={schedule}
      />
      <RunHistoryDialog
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        scheduleId={schedule.id}
      />
    </li>
  );
}

/**
 * Create + edit form for a schedule. Same dialog drives both because
 * the field set is identical — `schedule` null means "create new",
 * non-null means "edit existing".
 */
function ScheduleEditorDialog({
  open,
  onClose,
  schedule,
}: {
  open: boolean;
  onClose: () => void;
  schedule: EmailScanSchedule | null;
}): React.JSX.Element {
  const { providers: connectedProviders } = useConnectedEmailProviders();
  const fallbackProvider: EmailProvider =
    connectedProviders[0] ?? "google";
  const [provider, setProvider] = useState<EmailProvider>(
    (schedule?.provider as EmailProvider) ?? fallbackProvider,
  );
  const [labelFilter, setLabelFilter] = useState<string>(
    schedule?.labelFilter ?? "",
  );
  const [frequency, setFrequency] = useState<EmailScanFrequency>(
    schedule?.frequency ?? "daily",
  );
  const { data: labels } = useGmailLabels(open, provider);
  const create = useCreateEmailScanSchedule();
  const update = useUpdateEmailScanSchedule();
  const isPending = create.isPending || update.isPending;

  const labelTree = useMemo(() => (labels ? buildGmailLabelTree(labels) : []), [labels]);
  const resolvedLabelName = useMemo(() => {
    if (!labelFilter || !labels) return undefined;
    return labels.find((l) => l.id === labelFilter)?.name;
  }, [labelFilter, labels]);

  const onSubmit = () => {
    if (schedule) {
      update.mutate(
        {
          id: schedule.id,
          input: {
            provider,
            // null sentinel explicitly clears the labelFilter when the
            // user picks "All mail" — undefined would be stripped.
            labelFilter: labelFilter || null,
            labelName: resolvedLabelName ?? null,
            frequency,
          },
        },
        {
          onSuccess: () => {
            toast.success("Schedule updated");
            onClose();
          },
          onError: toastMutationError("update schedule"),
        },
      );
    } else {
      create.mutate(
        {
          provider,
          labelFilter: labelFilter || undefined,
          labelName: resolvedLabelName,
          frequency,
        },
        {
          onSuccess: () => {
            toast.success("Schedule created");
            onClose();
          },
          onError: toastMutationError("create schedule"),
        },
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {schedule ? "Edit schedule" : "New scheduled scan"}
          </DialogTitle>
          <DialogDescription>
            Pick how often itinly should check this mailbox for new
            travel bookings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {connectedProviders.length > 1 && (
            <div className="space-y-2">
              <Label htmlFor="sched-provider">Mailbox</Label>
              <Select
                value={provider}
                onValueChange={(v) => {
                  setProvider(v as EmailProvider);
                  // Switching providers — clear the label since the id
                  // space is different across Gmail vs Outlook.
                  setLabelFilter("");
                }}
              >
                <SelectTrigger id="sched-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {connectedProviders.map((p) => (
                    <SelectItem key={p} value={p}>
                      {emailProviderLabel(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="sched-label">
              {emailProviderLabel(provider)} {emailLabelNoun(provider)}
            </Label>
            <Select value={labelFilter} onValueChange={setLabelFilter}>
              <SelectTrigger id="sched-label">
                <SelectValue
                  placeholder={`All ${emailLabelNoun(provider)}s`}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">
                  All {emailLabelNoun(provider)}s
                </SelectItem>
                {labelTree.map((node) => (
                  <SelectItem key={node.label.id} value={node.label.id}>
                    {indentedLabel(node)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sched-frequency">Frequency</Label>
            <Select
              value={frequency}
              onValueChange={(v) => setFrequency(v as EmailScanFrequency)}
            >
              <SelectTrigger id="sched-frequency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={isPending}>
            {isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {schedule ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Read-only dialog showing the most recent 50 runs for a schedule.
 * `useEmailScanRuns` only fires when `scheduleId` is non-empty, which
 * matches our open/close idiom.
 */
function RunHistoryDialog({
  open,
  onClose,
  scheduleId,
}: {
  open: boolean;
  onClose: () => void;
  scheduleId: string;
}): React.JSX.Element {
  const { data: runs, isLoading } = useEmailScanRuns(
    open ? scheduleId : "",
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Recent runs</DialogTitle>
          <DialogDescription>
            Last 50 runs of this schedule, newest first.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : !runs || runs.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              No runs yet — the first one fires on the next tick.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {runs.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RunRow({ run }: { run: EmailScanRun }): React.JSX.Element {
  const Icon =
    run.status === "succeeded"
      ? CheckCircle2
      : run.status === "failed"
        ? XCircle
        : Loader2;
  const token = STATUS_TOKEN[run.status];
  return (
    <li className="flex items-start gap-3 py-2.5 text-sm">
      <Icon
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0",
          run.status === "running" && "animate-spin",
        )}
        style={{ color: `var(--status-${token}-fg)` }}
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{fmtRunStarted(run.startedAt)}</p>
        <p className="text-xs text-muted-foreground">
          {run.status === "running"
            ? "In progress…"
            : run.status === "failed"
              ? run.errorMessage ?? "Failed"
              : run.newCount > 0
                ? `Added ${run.newCount} new segment${run.newCount === 1 ? "" : "s"} from ${run.scannedCount} email${run.scannedCount === 1 ? "" : "s"}`
                : `Scanned ${run.scannedCount} email${run.scannedCount === 1 ? "" : "s"} — nothing new`}
        </p>
      </div>
    </li>
  );
}
