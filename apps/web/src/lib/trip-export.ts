"use client";

/**
 * Download helpers + trip-export hook shared between the desktop trip
 * actions menu and the mobile ⋮ menu. Keeps the export wiring identical
 * on both surfaces (Markdown / OneNote / PDF / iCal) without each
 * caller having to duplicate the blob-download pattern.
 */

import { useState } from "react";
import { toast } from "sonner";
import { useApiClient } from "@itinly/api-client";
import { describeError } from "@/lib/api-error";

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

function sanitizeFileName(name: string, fallback = "itinerary"): string {
  return name.replace(/[/\\:*?"<>|]/g, "-").trim() || fallback;
}

export interface TripExportActions {
  /** True while any of the export handlers is in flight. Drives the
   *  "Exporting…" label in callers that surface it. */
  isExporting: boolean;
  exportMarkdown: () => Promise<void>;
  exportOneNote: () => Promise<void>;
  exportPdf: () => Promise<void>;
  exportIcal: () => Promise<void>;
}

export function useTripExport(tripId: string, tripTitle: string): TripExportActions {
  const client = useApiClient();
  const [isExporting, setIsExporting] = useState(false);

  const run = async (label: string, fn: () => Promise<void>) => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      await fn();
    } catch (err) {
      toast.error(`Couldn't export ${label}`, {
        description: describeError(err),
      });
    } finally {
      setIsExporting(false);
    }
  };

  return {
    isExporting,
    exportMarkdown: () =>
      run("Markdown", async () => {
        const markdown = await client.exportMarkdown(tripId);
        downloadBlob(markdown, "itinerary.md", "text/markdown");
      }),
    exportOneNote: () =>
      run("OneNote", async () => {
        const html = await client.exportOneNote(tripId);
        downloadBlob(html, "itinerary.html", "text/html");
      }),
    exportPdf: () =>
      run("PDF", async () => {
        const blob = await client.exportPdf(tripId);
        downloadBlobDirect(blob, "itinerary.pdf");
      }),
    exportIcal: () =>
      run("iCal", async () => {
        const blob = await client.exportIcal(tripId);
        downloadBlobDirect(blob, `${sanitizeFileName(tripTitle)}.ics`);
      }),
  };
}
