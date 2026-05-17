"use client";

import type { TripHistoryEntry, TripHistoryKind } from "@itinly/shared";
import {
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  MapPin,
  Share2,
  Mail,
  FileSpreadsheet,
  History as HistoryIcon,
  Layers,
} from "lucide-react";
import type { ReactNode } from "react";

/**
 * History tone — one of four `--status-*` palette buckets. The bundle's
 * `History.jsx` UI kit uses the same four-tone scheme; we map each
 * concrete entry kind to its tone via the table below.
 *   create → ok     (green)
 *   update → info   (blue)
 *   delete → danger (red)
 *   info   → muted  (slate)
 */
type Tone = "create" | "update" | "delete" | "info";

const TONE_TO_STATUS: Record<Tone, "ok" | "info" | "danger" | "muted"> = {
  create: "ok",
  update: "info",
  delete: "danger",
  info: "muted",
};

const KIND_PRESENTATION: Record<
  TripHistoryKind,
  { icon: ReactNode; tone: Tone }
> = {
  "trip.update":      { icon: <Pencil className="h-3.5 w-3.5" />,           tone: "update" },
  "trip.day_update":  { icon: <MapPin className="h-3.5 w-3.5" />,           tone: "update" },
  "segment.create":   { icon: <Plus className="h-3.5 w-3.5" />,             tone: "create" },
  "segment.update":   { icon: <Pencil className="h-3.5 w-3.5" />,           tone: "update" },
  "segment.delete":   { icon: <Trash2 className="h-3.5 w-3.5" />,           tone: "delete" },
  "segment.confirm":  { icon: <CheckCircle2 className="h-3.5 w-3.5" />,     tone: "info"   },
  "todo.create":      { icon: <Plus className="h-3.5 w-3.5" />,             tone: "create" },
  "todo.update":      { icon: <Pencil className="h-3.5 w-3.5" />,           tone: "update" },
  "todo.delete":      { icon: <Trash2 className="h-3.5 w-3.5" />,           tone: "delete" },
  "share.create":     { icon: <Share2 className="h-3.5 w-3.5" />,           tone: "create" },
  "share.revoke":     { icon: <Share2 className="h-3.5 w-3.5" />,           tone: "delete" },
  "share.leave":      { icon: <Share2 className="h-3.5 w-3.5" />,           tone: "delete" },
  "bulk.import_xlsx": { icon: <FileSpreadsheet className="h-3.5 w-3.5" />,  tone: "info"   },
  "bulk.email_apply": { icon: <Mail className="h-3.5 w-3.5" />,             tone: "info"   },
  "bulk.confirm_all": { icon: <Layers className="h-3.5 w-3.5" />,           tone: "info"   },
};

function discStyle(tone: Tone): React.CSSProperties {
  const t = TONE_TO_STATUS[tone];
  return {
    backgroundColor: `var(--status-${t}-bg)`,
    color: `var(--status-${t}-fg)`,
  };
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  // floor (not round) so 90 seconds reads as "1m ago" rather than
  // "2m ago" — the "ago" convention is "at least X have passed",
  // which Math.floor models. Math.round pushed labels up by half a
  // bucket, surfacing a misleadingly larger duration than reality.
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 30) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatAbsoluteTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  date.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;
  const diff = Math.round((today.getTime() - date.getTime()) / dayMs);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) {
    return date.toLocaleDateString("en-US", { weekday: "long" });
  }
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: today.getFullYear() === date.getFullYear() ? undefined : "numeric",
  });
}

/**
 * Strip the email at "@example.com" → "name" for compact display. Keeps
 * the original around in the row title attribute so a hover discloses the
 * full address.
 */
function shortActor(email: string): string {
  if (email === "unknown") return "Unknown";
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}

interface TripHistoryProps {
  entries: TripHistoryEntry[] | undefined;
}

export function TripHistory({ entries }: TripHistoryProps): React.JSX.Element {
  const list = entries ?? [];
  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed p-7 text-center">
        <HistoryIcon className="h-6 w-6 text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
        <p className="text-xs text-muted-foreground/80">
          Edits to this trip will appear here once they happen.
        </p>
      </div>
    );
  }

  // Reverse-chrono: newest first. Group by calendar day for headings.
  const sorted = [...list].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const groups = new Map<string, TripHistoryEntry[]>();
  for (const entry of sorted) {
    const key = entry.timestamp.slice(0, 10); // YYYY-MM-DD in UTC
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }

  return (
    <div className="space-y-6">
      {[...groups.entries()].map(([dayKey, dayEntries]) => (
        <section key={dayKey} className="flex flex-col gap-2.5">
          <h3 className="text-[13px] font-semibold tracking-tight text-muted-foreground">
            {dayLabel(dayEntries[0].timestamp)}
          </h3>
          <ol className="flex flex-col gap-2">
            {dayEntries.map((entry) => {
              const presentation = KIND_PRESENTATION[entry.kind] ?? {
                icon: <HistoryIcon className="h-3.5 w-3.5" />,
                tone: "info" as const,
              };
              return (
                <li
                  key={entry.id}
                  className="flex items-start gap-3 rounded-lg border bg-card px-4 py-3.5 shadow-xs"
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                    style={discStyle(presentation.tone)}
                    aria-hidden
                  >
                    {presentation.icon}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="text-sm font-medium leading-snug text-foreground">
                      {entry.summary}
                    </p>
                    {entry.details && (
                      <p className="text-xs leading-snug text-muted-foreground">
                        {entry.details}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <span title={entry.actor.email}>
                        {shortActor(entry.actor.email)}
                      </span>
                      {" · "}
                      <span title={formatAbsoluteTime(entry.timestamp)}>
                        {formatRelativeTime(entry.timestamp)}
                      </span>
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
