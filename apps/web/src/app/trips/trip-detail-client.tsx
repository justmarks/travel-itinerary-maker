"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useTrip,
  useUpdateTrip,
  useDeleteTrip,
  useDeleteShare,
  useApiClient,
  useConfirmAllSegments,
  ApiError,
} from "@travel-app/api-client";
import type { TripStatus } from "@travel-app/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  Calendar,
  CalendarCheck,
  CalendarPlus,
  CalendarX,
  RefreshCw,
  MapPin,
  Pencil,
  Check,
  X,
  Download,
  FileText,
  BookOpen,
  FileDown,
  CalendarDays,
  AlertCircle,
  AlertTriangle,
  MoreHorizontal,
  FileCode2,
  Share2,
  Trash2,
  Users,
  LogOut,
} from "lucide-react";
import { ShareTripDialog } from "@/components/share-trip-dialog";
import { ItineraryDay } from "@/components/itinerary-day";
import { TripTodos } from "@/components/trip-todos";
import { TripCosts } from "@/components/trip-costs";
import { TimelineView } from "@/components/timeline-view";
import { MapView } from "@/components/map-view";
import { TripHistory } from "@/components/trip-history";
import { toast } from "sonner";
import { EmailScanDialog } from "@/components/email-scan-dialog";
import { HtmlImportDialog } from "@/components/html-import-dialog";
import { RequireAuth } from "@/components/require-auth";
import { UserMenu } from "@/components/user-menu";
import { useConfirm } from "@/lib/confirm-dialog";
import { useDemoHref } from "@/lib/demo";
import { describeError } from "@/lib/api-error";
import { useCalendarSync } from "@/lib/use-calendar-sync";
import {
  useActiveCalendarProvider,
  calendarProviderLabel,
} from "@/lib/use-active-provider";
import { NotConnectedNotice } from "@/components/not-connected-notice";
import { getTodayIso } from "@/lib/today";
import { useTripPermission } from "@/lib/use-trip-permission";
import { cn } from "@/lib/utils";

/**
 * Map each trip status to a `--status-*` token (mirrors the same map
 * in `trip-card.tsx`). Pulling the colors from the design-system
 * palette means a planning-blue tweak in `globals.css` propagates
 * everywhere a status chip renders.
 */
const STATUS_TOKEN: Record<string, "info" | "ok" | "muted" | "danger"> = {
  planning:  "info",
  active:    "ok",
  completed: "muted",
  cancelled: "danger",
};

function statusChipStyle(status: string): React.CSSProperties {
  const t = STATUS_TOKEN[status] ?? "muted";
  return {
    backgroundColor: `var(--status-${t}-bg)`,
    color: `var(--status-${t}-fg)`,
  };
}

/** Order the status chip cycles through on click. */
const TRIP_STATUS_CYCLE: TripStatus[] = [
  "planning",
  "active",
  "completed",
  "cancelled",
];

function nextTripStatus(current: string): TripStatus {
  const idx = TRIP_STATUS_CYCLE.indexOf(current as TripStatus);
  return TRIP_STATUS_CYCLE[(idx + 1) % TRIP_STATUS_CYCLE.length];
}

function formatDateRange(start: string, end: string) {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
  const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", opts);
  return `${fmt(start)} – ${fmt(end)}`;
}

function EditableTitle({ tripId, title }: { tripId: string; title: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const updateTrip = useUpdateTrip(tripId);

  const save = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setEditing(false);
    if (trimmed !== title) {
      updateTrip.mutate(
        { title: trimmed },
        {
          onError: (err) => {
            toast.error("Couldn't rename trip", {
              description: describeError(err),
            });
          },
        },
      );
    }
  };

  if (editing) {
    return (
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-9 text-2xl font-bold"
          autoFocus
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={!value.trim() || updateTrip.isPending}
        >
          <Check className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => {
            setValue(title);
            setEditing(false);
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      </form>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="group/title flex items-center gap-2 text-left"
      title="Rename trip"
    >
      <h1 className="text-2xl font-bold">{title}</h1>
      <Pencil className="h-4 w-4 text-muted-foreground opacity-100 transition-opacity can-hover:opacity-0 can-hover:group-hover/title:opacity-100" />
    </button>
  );
}

interface OverlapInfo {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
}

function EditableDates({
  tripId,
  startDate,
  endDate,
}: {
  tripId: string;
  startDate: string;
  endDate: string;
}) {
  const [editing, setEditing] = useState(false);
  const [newStart, setNewStart] = useState(startDate);
  const [newEnd, setNewEnd] = useState(endDate);
  const [overlapError, setOverlapError] = useState<OverlapInfo[] | null>(null);
  const updateTrip = useUpdateTrip(tripId);

  const isValid = newStart && newEnd && newStart <= newEnd;
  const hasChanges = newStart !== startDate || newEnd !== endDate;

  const save = () => {
    if (!isValid || !hasChanges) return;
    setOverlapError(null);

    const updates: Record<string, string> = {};
    if (newStart !== startDate) updates.startDate = newStart;
    if (newEnd !== endDate) updates.endDate = newEnd;

    updateTrip.mutate(updates, {
      onSuccess: () => {
        setEditing(false);
        setOverlapError(null);
      },
      onError: (error) => {
        if (error instanceof ApiError && error.status === 409) {
          const body = error.body as { overlappingTrips?: OverlapInfo[] };
          if (body.overlappingTrips) {
            setOverlapError(body.overlappingTrips);
            return;
          }
        }
        toast.error("Couldn't update trip dates", {
          description: describeError(error),
        });
      },
    });
  };

  const cancel = () => {
    setNewStart(startDate);
    setNewEnd(endDate);
    setOverlapError(null);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="space-y-2">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Input
            type="date"
            value={newStart}
            onChange={(e) => {
              setNewStart(e.target.value);
              setOverlapError(null);
            }}
            className="h-8 w-36 text-sm"
          />
          <span className="text-sm text-muted-foreground">–</span>
          <Input
            type="date"
            value={newEnd}
            onChange={(e) => {
              setNewEnd(e.target.value);
              setOverlapError(null);
            }}
            className="h-8 w-36 text-sm"
          />
          <Button
            type="submit"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!isValid || !hasChanges || updateTrip.isPending}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={cancel}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </form>
        {newStart && newEnd && newStart > newEnd && (
          <p className="text-xs text-destructive">
            End date must be on or after start date.
          </p>
        )}
        {overlapError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              <p className="font-medium">
                These dates overlap with:
              </p>
              <ul className="mt-0.5">
                {overlapError.map((trip) => (
                  <li key={trip.id}>
                    {trip.title} ({formatDateRange(trip.startDate, trip.endDate)})
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="group/dates flex items-center gap-1.5 text-left"
      title="Edit dates"
    >
      <Calendar className="h-3.5 w-3.5" />
      {formatDateRange(startDate, endDate)}
      <Pencil className="h-3 w-3 text-muted-foreground opacity-100 transition-opacity can-hover:opacity-0 can-hover:group-hover/dates:opacity-100" />
    </button>
  );
}

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadBlobDirect(blob: Blob, filename: string) {
  // Empty blob is a sentinel meaning the export was handled another way
  // (e.g. demo mode opens the print-to-PDF dialog directly). Skip the
  // download so the user doesn't get a 0-byte file.
  if (blob.size === 0) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Combined overflow menu for the trip detail header — keeps the toolbar
 * compact by tucking "Import email" and the Export submenu behind a single
 * "..." button. The EmailScan button stays visible because it's the most
 * common action; everything else lives here.
 */
function TripActionsMenu({
  tripId,
  tripTitle,
  trip,
  onImportEmail,
  canDelete,
}: {
  tripId: string;
  tripTitle: string;
  trip: {
    id: string;
    calendarId?: string;
    days: Array<{ segments: Array<{ calendarEventId?: string }> }>;
  };
  onImportEmail: () => void;
  /** Whether to surface the destructive "Delete trip" entry. Owner-only. */
  canDelete: boolean;
}) {
  const client = useApiClient();
  const router = useRouter();
  const confirm = useConfirm();
  const deleteTrip = useDeleteTrip();
  const [exporting, setExporting] = useState(false);

  const handleDelete = async () => {
    const ok = await confirm({
      title: `Delete "${tripTitle}"?`,
      description: "This cannot be undone.",
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;
    deleteTrip.mutate(tripId, {
      onSuccess: () => {
        // Bounce to the dashboard so the user isn't stuck on a now-404
        // detail page. The trips list will refresh from the
        // invalidation in the mutation hook.
        router.push("/");
      },
      onError: (err) => {
        toast.error("Couldn't delete trip", {
          description: describeError(err),
        });
      },
    });
  };

  const runExport = async (fn: () => Promise<void>) => {
    setExporting(true);
    try {
      await fn();
    } catch (err) {
      toast.error("Export failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setExporting(false);
    }
  };

  const handleExportMarkdown = () =>
    runExport(async () => {
      const markdown = await client.exportMarkdown(tripId);
      downloadBlob(markdown, "itinerary.md", "text/markdown");
    });

  const handleExportOneNote = () =>
    runExport(async () => {
      const html = await client.exportOneNote(tripId);
      downloadBlob(html, "itinerary.html", "text/html");
    });

  const handleExportPdf = () =>
    runExport(async () => {
      const blob = await client.exportPdf(tripId);
      downloadBlobDirect(blob, "itinerary.pdf");
    });

  const handleExportIcal = () =>
    runExport(async () => {
      const blob = await client.exportIcal(tripId);
      const safeName = tripTitle.replace(/[/\\:*?"<>|]/g, "-").trim() || "itinerary";
      downloadBlobDirect(blob, `${safeName}.ics`);
    });

  // Calendar-sync state lives at this level (not inside the dropdown's
  // content) because Radix unmounts `DropdownMenuContent` when the
  // menu closes — that took the dialog state + dialog components with
  // it, so clicking "Sync to Calendar…" closed the menu and then
  // showed nothing. Hoisting state up + rendering the dialogs as a
  // sibling of `<DropdownMenu>` means the dialogs survive the menu
  // collapse.
  const {
    calendarGranted,
    isSynced,
    syncedCount,
    syncedCalendarName,
    syncing,
    calendars,
    loadingCalendars,
    calendarError,
    loadCalendars,
    sync,
    refresh,
    unsync,
  } = useCalendarSync(trip);
  const { provider: calendarProvider } = useActiveCalendarProvider();
  const providerLabel = calendarProviderLabel(calendarProvider);
  const [calDialog, setCalDialog] = useState<"pick" | "info" | "scope" | null>(null);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>("primary");
  const [removeStep, setRemoveStep] = useState<"confirm" | null>(null);
  const [deleteChoice, setDeleteChoice] = useState<"delete" | "keep">("delete");

  const refreshCalendarList = async () => {
    const cals = await loadCalendars();
    const primary = cals.find((c) => c.primary);
    setSelectedCalendarId(trip.calendarId ?? primary?.id ?? "primary");
  };

  const openCalendarDialog = () => {
    if (!calendarGranted) {
      setCalDialog("scope");
      return;
    }
    if (isSynced) {
      setRemoveStep(null);
      setDeleteChoice("delete");
      setCalDialog("info");
      void refreshCalendarList();
    } else {
      setCalDialog("pick");
      void refreshCalendarList();
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label="More trip actions"
            disabled={exporting}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={syncing}
            onSelect={() => {
              // Radix closes the dropdown on default selection — that's
              // fine; the dialog lives outside this content tree so it
              // mounts independently and isn't torn down with the menu.
              openCalendarDialog();
            }}
          >
            {isSynced ? (
              <CalendarCheck className="mr-2 h-4 w-4" style={{ color: "var(--status-ok-fg)" }} />
            ) : (
              <CalendarPlus className="mr-2 h-4 w-4" />
            )}
            {syncing
              ? "Syncing…"
              : isSynced
                ? `Calendar synced (${syncedCount})`
                : "Sync to Calendar…"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onImportEmail}>
            <FileCode2 className="mr-2 h-4 w-4" />
            Import email
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Download className="mr-2 h-4 w-4" />
              Export
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={handleExportMarkdown}>
                <FileText className="mr-2 h-4 w-4" />
                Markdown (.md)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportOneNote}>
                <BookOpen className="mr-2 h-4 w-4" />
                OneNote (.html)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportPdf}>
                <FileDown className="mr-2 h-4 w-4" />
                PDF (.pdf)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportIcal}>
                <CalendarDays className="mr-2 h-4 w-4" />
                iCal (.ics)
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={handleDelete}
                disabled={deleteTrip.isPending}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete trip
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <CalendarSyncDialogs
        dialog={calDialog}
        setDialog={setCalDialog}
        removeStep={removeStep}
        setRemoveStep={setRemoveStep}
        selectedCalendarId={selectedCalendarId}
        setSelectedCalendarId={setSelectedCalendarId}
        deleteChoice={deleteChoice}
        setDeleteChoice={setDeleteChoice}
        sync={sync}
        refresh={refresh}
        unsync={unsync}
        calendars={calendars}
        loadingCalendars={loadingCalendars}
        calendarError={calendarError}
        syncedCount={syncedCount}
        syncedCalendarName={syncedCalendarName}
        providerLabel={providerLabel}
      />
    </>
  );
}

/**
 * Standalone overflow menu shown to a trip's *recipient* (not the owner)
 * with a single destructive action: leave the trip. Hits the same
 * `DELETE /trips/:id/shares/:shareId` endpoint as the owner-initiated
 * revoke, but the server detects the requester is the share's recipient
 * and records the audit entry as `share.leave` rather than
 * `share.revoke`, plus pushes the leaving notification to the owner
 * instead of back to the requester.
 */
function LeaveTripMenu({
  tripId,
  tripTitle,
  ownShareId,
}: {
  tripId: string;
  tripTitle: string;
  ownShareId: string;
}): React.JSX.Element {
  const router = useRouter();
  const confirm = useConfirm();
  const deleteShare = useDeleteShare(tripId);

  const handleLeave = async () => {
    const ok = await confirm({
      title: `Leave "${tripTitle}"?`,
      description:
        "You'll lose access to this trip — the owner will be notified.",
      confirmText: "Leave",
      destructive: true,
    });
    if (!ok) return;
    deleteShare.mutate(ownShareId, {
      onSuccess: () => {
        // The trip is no longer visible to this user — bouncing to the
        // dashboard avoids a 404 the moment the next GET fires.
        router.push("/");
      },
      onError: (err) => {
        toast.error("Couldn't leave trip", {
          description: describeError(err),
        });
      },
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label="More trip actions"
          disabled={deleteShare.isPending}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={handleLeave}
          disabled={deleteShare.isPending}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Leave trip
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NeedsReviewBanner({
  trip,
}: {
  trip: {
    id: string;
    days: Array<{ segments: Array<{ needsReview: boolean }> }>;
  };
}) {
  const confirmAll = useConfirmAllSegments(trip.id);
  const reviewCount = trip.days.reduce(
    (sum, d) => sum + d.segments.filter((s) => s.needsReview).length,
    0,
  );
  if (reviewCount === 0) return null;
  return (
    <div
      className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm"
      style={{
        backgroundColor: "var(--status-warn-bg)",
        color: "var(--status-warn-fg)",
        borderColor: "var(--status-warn-rail)",
      }}
    >
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1 min-w-0">
        <strong>{reviewCount}</strong>{" "}
        {reviewCount === 1 ? "segment" : "segments"}{" "}from email need
        review. Look for the yellow &quot;Review&quot; badge and click the
        green checkmark to confirm.
      </span>
      <Button
        size="sm"
        variant="outline"
        className="bg-card hover:bg-card/80"
        style={{
          borderColor: "var(--status-warn-rail)",
          color: "var(--status-warn-fg)",
        }}
        onClick={() =>
          confirmAll.mutate(undefined, {
            onError: (err) => {
              toast.error("Couldn't confirm segments", {
                description: describeError(err),
              });
            },
          })
        }
        disabled={confirmAll.isPending}
      >
        <Check className="mr-1.5 h-3.5 w-3.5" />
        Confirm all
      </Button>
    </div>
  );
}

/**
 * Dialogs the calendar-sync flow renders alongside the trigger
 * (header button OR overflow-menu item). The trigger and dialogs
 * are deliberately decoupled so the trigger can live inside a
 * `<DropdownMenuContent>` (which Radix unmounts when the menu
 * closes) while the dialogs live OUTSIDE it — picking "Sync to
 * Calendar" closes the menu, but the dialog still mounts because
 * its React subtree didn't go with the dropdown.
 *
 * Controlled via the `dialog` prop. The parent owns the open state
 * so the dialog survives menu collapse.
 */
function CalendarSyncDialogs({
  dialog,
  setDialog,
  removeStep,
  setRemoveStep,
  selectedCalendarId,
  setSelectedCalendarId,
  deleteChoice,
  setDeleteChoice,
  sync,
  refresh,
  unsync,
  calendars,
  loadingCalendars,
  calendarError,
  syncedCount,
  syncedCalendarName,
  providerLabel,
}: {
  dialog: "pick" | "info" | "scope" | null;
  setDialog: (d: "pick" | "info" | "scope" | null) => void;
  removeStep: "confirm" | null;
  setRemoveStep: (s: "confirm" | null) => void;
  selectedCalendarId: string;
  setSelectedCalendarId: (id: string) => void;
  deleteChoice: "delete" | "keep";
  setDeleteChoice: (c: "delete" | "keep") => void;
  sync: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  unsync: (deleteEvents: boolean) => Promise<void>;
  calendars: Array<{ id: string; summary: string; primary: boolean }> | null;
  loadingCalendars: boolean;
  calendarError: string | null;
  syncedCount: number;
  syncedCalendarName: string | undefined;
  providerLabel: string;
}) {
  const handleSync = async () => {
    setDialog(null);
    await sync(selectedCalendarId);
  };
  const handleRefresh = async () => {
    setDialog(null);
    await refresh();
  };
  const handleRemove = async () => {
    setDialog(null);
    await unsync(deleteChoice === "delete");
  };

  return (
    <>
      {/* ── Needs Calendar scope ── */}
      <Dialog open={dialog === "scope"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Connect a calendar</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <NotConnectedNotice capability="calendar" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Calendar picker (not yet synced) ── */}
      <Dialog open={dialog === "pick"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Choose a calendar</DialogTitle>
            <DialogDescription>
              Select the {providerLabel}{" "}to sync this trip&apos;s events to.
            </DialogDescription>
          </DialogHeader>
          {loadingCalendars ? (
            <p className="py-2 text-sm text-muted-foreground">Loading calendars…</p>
          ) : calendars && calendars.length > 0 ? (
            <Select value={selectedCalendarId} onValueChange={setSelectedCalendarId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {calendars.map((cal) => (
                  <SelectItem key={cal.id} value={cal.id}>
                    {cal.summary}{cal.primary ? " (primary)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : calendarError ? (
            <div
              className="rounded-md border p-3 text-sm"
              style={{
                borderColor: "var(--status-danger-rail)",
                background: "var(--status-danger-bg)",
                color: "var(--status-danger-fg)",
              }}
            >
              Couldn&apos;t load calendars: {calendarError}
            </div>
          ) : (
            // An empty calendar list almost always means the connection
            // can't authenticate against the provider — Google
            // sometimes doesn't return a refresh_token on reconnect
            // (see #306), and Graph 401s when the access token has
            // expired with nothing to refresh from. In both cases the
            // capability row looks "active" in /settings/account but
            // the listCalendars call comes back empty. Point the user
            // at a fix instead of a dead-end string.
            <div className="space-y-2 py-2 text-sm text-muted-foreground">
              <p>No writable calendars found.</p>
              <p>
                Your {providerLabel} connection may have expired.{" "}
                <Link
                  href="/settings/account"
                  className="font-medium text-foreground underline underline-offset-2"
                  onClick={() => setDialog(null)}
                >
                  Reconnect from Settings
                </Link>
                {" "}to re-grant calendar access.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button onClick={handleSync} disabled={loadingCalendars || !calendars?.length}>
              Sync
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Sync info dialog (already synced) ── */}
      <Dialog open={dialog === "info"} onOpenChange={(o) => { if (!o) { setDialog(null); setRemoveStep(null); } }}>
        <DialogContent className="sm:max-w-sm">
          {removeStep !== "confirm" ? (
            <>
              <DialogHeader>
                <DialogTitle>{providerLabel} sync</DialogTitle>
                <DialogDescription>
                  {syncedCount} event{syncedCount !== 1 ? "s" : ""} synced
                  {syncedCalendarName ? ` to ${syncedCalendarName}` : ""}.
                  New and edited events are pushed automatically.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => setRemoveStep("confirm")}
                >
                  <CalendarX className="mr-2 h-3.5 w-3.5" />
                  Remove sync
                </Button>
                <Button className="w-full sm:w-auto" onClick={handleRefresh}>
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  Refresh
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Remove sync</DialogTitle>
                <DialogDescription>
                  What should happen to the calendar events?
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3 py-1">
                <label className="flex items-start gap-3 cursor-pointer rounded-md border p-3 has-[:checked]:border-primary">
                  <input
                    type="radio"
                    name="deleteChoice"
                    value="delete"
                    checked={deleteChoice === "delete"}
                    onChange={() => setDeleteChoice("delete")}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium">Delete from {providerLabel}</p>
                    <p className="text-xs text-muted-foreground">Remove all synced events from your calendar.</p>
                  </div>
                </label>
                <label className="flex items-start gap-3 cursor-pointer rounded-md border p-3 has-[:checked]:border-primary">
                  <input
                    type="radio"
                    name="deleteChoice"
                    value="keep"
                    checked={deleteChoice === "keep"}
                    onChange={() => setDeleteChoice("keep")}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium">Keep in {providerLabel}</p>
                    <p className="text-xs text-muted-foreground">Events stay in your calendar but won&apos;t be updated by this app.</p>
                  </div>
                </label>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setRemoveStep(null)}>Back</Button>
                <Button variant="destructive" onClick={handleRemove}>Remove sync</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}


type Tab = "itinerary" | "timeline" | "map" | "costs" | "todos" | "history";

const TAB_LABELS: Record<Tab, string> = {
  itinerary: "Itinerary",
  timeline:  "Timeline",
  map:       "Map",
  costs:     "Costs",
  todos:     "To-do",
  history:   "History",
};

export default function TripDetailClient({ tripId }: { tripId: string }): React.JSX.Element | null {
  const { data: trip, isLoading, isError, error, refetch } = useTrip(tripId);
  const homeHref = useDemoHref("/");
  const [activeTab, setActiveTab] = useState<Tab>("itinerary");
  const [htmlImportOpen, setHtmlImportOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const updateTripStatus = useUpdateTrip(tripId);

  // Scroll the day matching today into view the first time the itinerary
  // renders for this trip. Anchored to a flag so flipping tabs or
  // re-rendering after a mutation doesn't yank the user back.
  const itineraryDaysRef = useRef<HTMLDivElement | null>(null);
  const didScrollToToday = useRef(false);
  useEffect(() => {
    if (didScrollToToday.current) return;
    if (!trip || activeTab !== "itinerary") return;
    const today = getTodayIso();
    if (!trip.days.some((d) => d.date === today)) return;
    const container = itineraryDaysRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLElement>(
      `[data-day-date="${today}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ behavior: "auto", block: "start" });
    didScrollToToday.current = true;
  }, [trip, activeTab]);

  // Permission for the active user — view-only contributors get a
  // read-only render; edit contributors keep most affordances; only the
  // owner sees Share / Calendar sync / Email scan / Delete. The
  // showCosts / showTodos flags mirror the share's per-recipient
  // visibility toggles set at share creation.
  const permission = useTripPermission(tripId);
  const { isReadOnly, isOwner, sharedFromEmail, sharedShareId } = permission;
  // The id of the share row that grants this user access. The server
  // surfaces it on the trip summary so the recipient can self-leave
  // without us having to look it up from `trip.shares` (which would also
  // fail for anonymous link shares the user is signed in to view via a
  // direct link). Absent on owned trips and anonymous public shares.
  const ownShareId = !isOwner ? sharedShareId ?? null : null;
  // While the permission lookup is still in flight, suppress cost /
  // todo rendering (we'd otherwise flash inline costs / the to-do
  // sidebar in for a beat before the contributor's restrictive
  // permission resolved and yanked them away). Owners get a brief
  // empty beat in exchange — much less jarring than show-then-hide.
  const showCosts = !permission.isLoading && permission.showCosts;
  const showTodos = !permission.isLoading && permission.showTodos;
  // Build the tab list dynamically so tabs the share hides don't even
  // appear. Itinerary / Timeline / Map are always shown; Costs and
  // To-do drop out for shares with the matching toggle off.
  const visibleTabs = (
    ["itinerary", "timeline", "map", "costs", "todos", "history"] as Tab[]
  ).filter((t) => {
    if (t === "costs") return showCosts;
    if (t === "todos") return showTodos;
    return true;
  });

  if (isLoading) {
    return (
      <main className="min-h-screen p-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="h-64 animate-pulse rounded-xl border bg-muted" />
        </div>
      </main>
    );
  }

  if (!trip) {
    // Distinguish a real load failure from a missing-trip 404 so the
    // user can retry instead of being told the trip doesn't exist.
    const is404 = error instanceof ApiError && error.status === 404;
    const showError = isError && !is404;
    return (
      <main className="min-h-screen p-8">
        <div className="mx-auto max-w-7xl">
          <Link href={homeHref}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
          {showError ? (
            <div
              className="mt-4 flex items-start gap-3 rounded-lg border p-4 text-sm"
              style={{
                backgroundColor: "var(--status-danger-bg)",
                color: "var(--status-danger-fg)",
                borderColor: "var(--status-danger-rail)",
              }}
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1">
                <p className="font-medium">Couldn&apos;t load this trip.</p>
                <p className="mt-0.5 text-xs opacity-80">{describeError(error)}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => refetch()}
                className="bg-card"
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Retry
              </Button>
            </div>
          ) : (
            <p className="mt-4 text-destructive">Trip not found.</p>
          )}
        </div>
      </main>
    );
  }

  return (
    <RequireAuth>
    <main className="flex h-screen flex-col p-8 print:h-auto print:block">
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col min-h-0 print:block">

        {/* Fixed header — back nav, title row, needs-review banner,
            and tab navigation. Lives outside the scroll container so
            it stays in place while the itinerary scrolls below. */}
        <div className="shrink-0 print:contents">

        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <Link href={homeHref}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              All trips
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            {/* Owner-only: scanning emails / sharing / the actions
                menu (which carries Calendar sync + Delete) all act on
                the owner's account, so contributors don't see them.
                Suppressed entirely while permission is loading so a
                shared-trip recipient doesn't see the chrome flash in
                and then disappear once the real permission resolves. */}
            {!permission.isLoading && isOwner && (
              <>
                <EmailScanDialog tripId={trip.id} triggerLabel="Scan Emails" />
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setShareOpen(true)}
                  className="gap-1.5"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  Share
                </Button>
                <TripActionsMenu
                  tripId={trip.id}
                  tripTitle={trip.title}
                  trip={trip}
                  onImportEmail={() => setHtmlImportOpen(true)}
                  canDelete={permission.isOwner}
                />
                <HtmlImportDialog
                  tripId={trip.id}
                  hideTrigger
                  open={htmlImportOpen}
                  onOpenChange={setHtmlImportOpen}
                />
                <ShareTripDialog
                  tripId={trip.id}
                  open={shareOpen}
                  onOpenChange={setShareOpen}
                />
              </>
            )}
            {!permission.isLoading && !isOwner && ownShareId && (
              <LeaveTripMenu
                tripId={trip.id}
                tripTitle={trip.title}
                ownShareId={ownShareId}
              />
            )}
            <UserMenu />
          </div>
        </div>

        <div className="mb-8">
          <div className="flex flex-wrap items-center gap-3">
            {isReadOnly ? (
              <h1 className="text-2xl font-bold">{trip.title}</h1>
            ) : (
              <EditableTitle tripId={trip.id} title={trip.title} />
            )}
            {isReadOnly ? (
              <span
                className="rounded-full px-2.5 py-0.5 text-xs font-medium capitalize"
                style={statusChipStyle(trip.status)}
              >
                {trip.status}
              </span>
            ) : (
              <button
                type="button"
                onClick={() =>
                  updateTripStatus.mutate(
                    { status: nextTripStatus(trip.status) },
                    {
                      onError: (err) => {
                        toast.error("Couldn't update status", {
                          description: describeError(err),
                        });
                      },
                    },
                  )
                }
                disabled={updateTripStatus.isPending}
                title={`Status: ${trip.status}. Click to advance.`}
                className="cursor-pointer rounded-full px-2.5 py-0.5 text-xs font-medium capitalize transition-opacity hover:opacity-80 disabled:cursor-wait"
                style={statusChipStyle(trip.status)}
              >
                {trip.status}
              </button>
            )}
            {sharedFromEmail && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                <Users className="h-3 w-3" />
                Shared by {sharedFromEmail}
                <span className="ml-1 text-[10px] uppercase tracking-wider opacity-70">
                  · {isReadOnly ? "view" : "edit"}
                </span>
              </span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            {isReadOnly ? (
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                {formatDateRange(trip.startDate, trip.endDate)}
              </span>
            ) : (
              <EditableDates
                tripId={trip.id}
                startDate={trip.startDate}
                endDate={trip.endDate}
              />
            )}
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              {trip.days.length} {trip.days.length === 1 ? "day" : "days"}
            </span>
          </div>
        </div>

        {/* Needs-review banner — owner-only (parsed segments live in the
            owner's Drive and the contributor can't apply them). */}
        {isOwner && <NeedsReviewBanner trip={trip} />}

        {/* Tab navigation — hidden when printing */}
        <div className="no-scrollbar mb-6 flex gap-0 overflow-x-auto border-b border-border print-hidden">
          {visibleTabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors",
                activeTab === tab
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>

        </div>

        {/* Scrolling tab content — only this region scrolls so the
            header stays put. On the itinerary tab at lg+ we hand off
            scrolling to the two columns inside so the day list and
            sidebar can scroll independently; below lg the columns
            stack and the outer container provides one unified scroll.
            Print mode unwraps both shell and this container (see
            print: overrides above) so a multi-page itinerary still
            flows naturally onto paper. */}
        <div
          className={cn(
            "-mx-1 flex-1 min-h-0 overflow-y-auto px-1 print:overflow-visible",
            activeTab === "itinerary" && "lg:overflow-hidden",
          )}
        >

        {/* Tab content */}
        {activeTab === "itinerary" && (
          <div className="grid grid-cols-1 gap-8 lg:h-full lg:grid-cols-[minmax(0,1fr)_280px]">
            <div
              ref={itineraryDaysRef}
              className="flex min-w-0 flex-col gap-8 lg:overflow-y-auto lg:pb-2 lg:pr-2 print:overflow-visible"
            >
              {trip.days.map((day) => (
                <ItineraryDay
                  key={day.date}
                  day={day}
                  tripId={trip.id}
                  readOnly={isReadOnly}
                  showCosts={showCosts}
                />
              ))}
            </div>
            {showTodos && (
              <div className="flex min-w-0 flex-col gap-6 lg:overflow-y-auto lg:pb-2 print:overflow-visible">
                <div className="rounded-xl border p-5">
                  <TripTodos
                    tripId={trip.id}
                    todos={trip.todos}
                    readOnly={isReadOnly}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "timeline" && <TimelineView trip={trip} />}

        {activeTab === "map" && <MapView trip={trip} />}

        {activeTab === "costs" && showCosts && (
          <div className="rounded-xl border p-6">
            <TripCosts tripId={trip.id} />
          </div>
        )}

        {activeTab === "todos" && showTodos && (
          <div className="rounded-xl border p-6">
            <TripTodos
              tripId={trip.id}
              todos={trip.todos}
              days={trip.days}
              showSuggestButton={!isReadOnly}
              readOnly={isReadOnly}
            />
          </div>
        )}

        {activeTab === "history" && (
          <TripHistory entries={trip.history} />
        )}
        </div>
      </div>
    </main>
    </RequireAuth>
  );
}
