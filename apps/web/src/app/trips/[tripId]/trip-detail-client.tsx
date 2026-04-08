"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useTrip, useUpdateTrip, useApiClient } from "@travel-app/api-client";
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
} from "lucide-react";
import { ItineraryDay } from "@/components/itinerary-day";
import { TripTodos } from "@/components/trip-todos";
import { TripCosts } from "@/components/trip-costs";
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

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
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
          <Link href="/">
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
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-7xl">

        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              All trips
            </Button>
          </Link>
          <ExportMenu tripId={trip.id} />
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
            <span className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />
              {formatDateRange(trip.startDate, trip.endDate)}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              {trip.days.length} {trip.days.length === 1 ? "day" : "days"}
            </span>
          </div>
        </div>

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
  );
}
