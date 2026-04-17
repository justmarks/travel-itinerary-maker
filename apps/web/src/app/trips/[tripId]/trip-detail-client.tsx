"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useTrip, useUpdateTrip, useApiClient, ApiError } from "@travel-app/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Pencil,
  Check,
  X,
  Download,
  FileText,
  BookOpen,
  FileDown,
  AlertCircle,
  AlertTriangle,
} from "lucide-react";
import { ItineraryDay } from "@/components/itinerary-day";
import { TripTodos } from "@/components/trip-todos";
import { TripCosts } from "@/components/trip-costs";
import { EmailScanDialog } from "@/components/email-scan-dialog";
import { RequireAuth } from "@/components/require-auth";
import { UserMenu } from "@/components/user-menu";
import { useDemoHref } from "@/lib/demo";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  planning:  "bg-blue-100  text-blue-700",
  active:    "bg-green-100 text-green-700",
  completed: "bg-gray-100  text-gray-600",
  archived:  "bg-yellow-100 text-yellow-700",
};

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
    if (!value.trim()) return;
    updateTrip.mutate(
      { title: value.trim() },
      { onSuccess: () => setEditing(false) },
    );
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
      <Pencil className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover/title:opacity-100" />
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
          }
        }
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
      <Pencil className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover/dates:opacity-100" />
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
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ExportMenu({ tripId }: { tripId: string }) {
  const client = useApiClient();
  const [exporting, setExporting] = useState(false);

  const handleExportMarkdown = async () => {
    setExporting(true);
    try {
      const markdown = await client.exportMarkdown(tripId);
      downloadBlob(markdown, "itinerary.md", "text/markdown");
    } catch {
      alert("Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const handleExportOneNote = async () => {
    setExporting(true);
    try {
      const html = await client.exportOneNote(tripId);
      downloadBlob(html, "itinerary.html", "text/html");
    } catch {
      alert("Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    setExporting(true);
    try {
      const blob = await client.exportPdf(tripId);
      downloadBlobDirect(blob, "itinerary.pdf");
    } catch {
      alert("Export failed.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={exporting}>
          <Download className="mr-2 h-3.5 w-3.5" />
          {exporting ? "Exporting..." : "Export"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function TripDetailClient({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = use(params);
  const { data: trip, isLoading, error } = useTrip(tripId);
  const homeHref = useDemoHref("/");

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

  if (error || !trip) {
    return (
      <main className="min-h-screen p-8">
        <div className="mx-auto max-w-7xl">
          <Link href={homeHref}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </Link>
          <p className="mt-4 text-destructive">Trip not found.</p>
        </div>
      </main>
    );
  }

  return (
    <RequireAuth>
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-7xl">

        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <Link href={homeHref}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              All trips
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <EmailScanDialog tripId={trip.id} triggerLabel="Scan Emails" />
            <ExportMenu tripId={trip.id} />
            <UserMenu />
          </div>
        </div>

        <div className="mb-8">
          <div className="flex flex-wrap items-center gap-3">
            <EditableTitle tripId={trip.id} title={trip.title} />
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
                STATUS_STYLES[trip.status] ?? "bg-gray-100 text-gray-600",
              )}
            >
              {trip.status}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <EditableDates
              tripId={trip.id}
              startDate={trip.startDate}
              endDate={trip.endDate}
            />
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              {trip.days.length} {trip.days.length === 1 ? "day" : "days"}
            </span>
          </div>
        </div>

        {/* Needs-review banner */}
        {(() => {
          const reviewCount = trip.days.reduce(
            (sum, d) => sum + d.segments.filter((s) => s.needsReview).length,
            0,
          );
          if (reviewCount === 0) return null;
          return (
            <div className="mb-6 flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                <strong>{reviewCount}</strong> segment{reviewCount !== 1 ? "s" : ""} from email need review.
                Look for the yellow &quot;Review&quot; badge and click the green checkmark to confirm.
              </span>
            </div>
          );
        })()}

        {/* Body */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_280px]">

          {/* Day-by-day itinerary */}
          <div className="flex flex-col gap-8">
            {trip.days.map((day) => (
              <ItineraryDay key={day.date} day={day} tripId={trip.id} />
            ))}
          </div>

          {/* Sidebar */}
          <div className="flex flex-col gap-6">
            <div className="rounded-xl border p-5">
              <TripTodos tripId={trip.id} todos={trip.todos} />
            </div>
            <div className="rounded-xl border p-5">
              <TripCosts tripId={trip.id} />
            </div>
          </div>

        </div>
      </div>
    </main>
    </RequireAuth>
  );
}
