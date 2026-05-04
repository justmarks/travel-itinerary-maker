"use client";

import type { TripHistoryEntry, TripHistoryKind } from "@travel-app/shared";
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
 * Map each history entry kind to a small icon and short verb-class hint.
 * The hint feeds the icon's background colour so create / update / delete
 * scan visually at a glance ("green check = something completed", "red trash
 * = something removed").
 */
const KIND_PRESENTATION: Record<
  TripHistoryKind,
  { icon: ReactNode; tone: "create" | "update" | "delete" | "info" }
> = {
  "trip.update": { icon: <Pencil className="h-3.5 w-3.5" />, tone: "update" },
  "trip.day_update": { icon: <MapPin className="h-3.5 w-3.5" />, tone: "update" },
  "segment.create": { icon: <Plus className="h-3.5 w-3.5" />, tone: "create" },
  "segment.update": { icon: <Pencil className="h-3.5 w-3.5" />, tone: "update" },
  "segment.delete": { icon: <Trash2 className="h-3.5 w-3.5" />, tone: "delete" },
  "segment.confirm": { icon: <CheckCircle2 className="h-3.5 w-3.5" />, tone: "info" },
  "todo.create": { icon: <Plus className="h-3.5 w-3.5" />, tone: "create" },
  "todo.update": { icon: <Pencil className="h-3.5 w-3.5" />, tone: "update" },
  "todo.delete": { icon: <Trash2 className="h-3.5 w-3.5" />, tone: "delete" },
  "share.create": { icon: <Share2 className="h-3.5 w-3.5" />, tone: "create" },
  "share.revoke": { icon: <Share2 className="h-3.5 w-3.5" />, tone: "delete" },
  "share.leave": { icon: <Share2 className="h-3.5 w-3.5" />, tone: "delete" },
  "bulk.import_xlsx": { icon: <FileSpreadsheet className="h-3.5 w-3.5" />, tone: "info" },
  "bulk.email_apply": { icon: <Mail className="h-3.5 w-3.5" />, tone: "info" },
  "bulk.confirm_all": { icon: <Layers className="h-3.5 w-3.5" />, tone: "info" },
};

const TONE_CLASSES: Record<"create" | "update" | "delete" | "info", string> = {
  create: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  update: "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300",
  delete: "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300",
  info: "bg-muted text-muted-foreground",
};

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 30) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatAbsoluteTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
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
    return date.toLocaleDateString(undefined, { weekday: "long" });
  }
  return date.toLocaleDateString(undefined, {
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
      <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">
        <HistoryIcon className="mx-auto mb-2 h-6 w-6 opacity-60" />
        <p>No changes recorded yet.</p>
        <p className="mt-1 text-xs">
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
        <section key={dayKey} className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">
            {dayLabel(dayEntries[0].timestamp)}
          </h3>
          <ol className="space-y-2">
            {dayEntries.map((entry) => {
              const presentation = KIND_PRESENTATION[entry.kind] ?? {
                icon: <HistoryIcon className="h-3.5 w-3.5" />,
                tone: "info" as const,
              };
              return (
                <li
                  key={entry.id}
                  className="flex items-start gap-3 rounded-lg border bg-card p-3"
                >
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${TONE_CLASSES[presentation.tone]}`}
                    aria-hidden
                  >
                    {presentation.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">{entry.summary}</p>
                    {entry.details && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {entry.details}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
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
