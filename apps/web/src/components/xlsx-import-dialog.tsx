"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useImportXlsxTrip, ApiError } from "@travel-app/api-client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileSpreadsheet, AlertCircle, Upload } from "lucide-react";

interface OverlapInfo {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunkSize)),
    );
  }
  return btoa(binary);
}

function formatDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function XlsxImportDialog() {
  const router = useRouter();
  const importXlsx = useImportXlsxTrip();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [titleOverride, setTitleOverride] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [overlapError, setOverlapError] = useState<OverlapInfo[] | null>(null);

  const resetState = () => {
    setFile(null);
    setTitleOverride("");
    setErrorMessage(null);
    setOverlapError(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setErrorMessage(null);
    setOverlapError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setErrorMessage(null);
    setOverlapError(null);

    let fileBase64: string;
    try {
      fileBase64 = await fileToBase64(file);
    } catch {
      setErrorMessage("Could not read the selected file. Please try again.");
      return;
    }

    importXlsx.mutate(
      {
        fileBase64,
        filename: file.name,
        title: titleOverride.trim() || undefined,
      },
      {
        onSuccess: (response) => {
          setOpen(false);
          resetState();
          router.push(`/trips/${response.trip.id}`);
        },
        onError: (error) => {
          if (error instanceof ApiError) {
            if (error.status === 409) {
              const body = error.body as { overlappingTrips?: OverlapInfo[] };
              if (body.overlappingTrips?.length) {
                setOverlapError(body.overlappingTrips);
                return;
              }
            }
            const body = error.body as { error?: string } | undefined;
            setErrorMessage(
              body?.error ??
                "The workbook could not be imported. Please check the file and try again.",
            );
          } else {
            setErrorMessage(
              "Unexpected error importing the workbook. Please try again.",
            );
          }
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) resetState();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Import XLSX
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import trip from XLSX</DialogTitle>
          <DialogDescription>
            Upload a OneNote-style itinerary workbook and we&apos;ll build the
            trip from the day-by-day table and Costs sheet.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="xlsx-file">Workbook (.xlsx)</Label>
            <Input
              id="xlsx-file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={handleFileChange}
            />
            {file && (
              <p className="text-xs text-muted-foreground">
                {file.name} &middot; {Math.ceil(file.size / 1024)} KB
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="xlsx-title">Trip name (optional)</Label>
            <Input
              id="xlsx-title"
              placeholder="Leave blank to use the filename"
              value={titleOverride}
              onChange={(e) => setTitleOverride(e.target.value)}
            />
          </div>
          {errorMessage && (
            <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-left text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{errorMessage}</p>
            </div>
          )}
          {overlapError && (
            <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-left text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">
                  These dates overlap with an existing trip:
                </p>
                <ul className="mt-1 space-y-1">
                  {overlapError.map((trip) => (
                    <li key={trip.id}>
                      <span className="font-medium">{trip.title}</span>{" "}
                      <span className="text-xs opacity-75">
                        ({formatDate(trip.startDate)} &ndash;{" "}
                        {formatDate(trip.endDate)})
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs opacity-75">
                  Delete or adjust the existing trip before re-importing.
                </p>
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                resetState();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!file || importXlsx.isPending}>
              <Upload className="mr-2 h-4 w-4" />
              {importXlsx.isPending ? "Importing..." : "Import Trip"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
