/**
 * Helpers for surfacing the "X viewed your trip" / "X edited your trip"
 * activity stamps on TripShare rows. Shared between the desktop dialog
 * and the mobile bottom sheet so the two stay in sync — extracting was
 * cheaper than re-implementing the relative-time formatter twice.
 */

import type { TripShare } from "@travel-app/shared";

export interface ShareActivity {
  kind: "viewed" | "edited";
  at: string;
}

/**
 * The most recent activity worth surfacing. Edit beats view because
 * editing implies viewing — "Edited 5m ago" is the more interesting
 * fact when both timestamps land in the same window. Returns null
 * when neither stamp is present (a freshly-created share, or one the
 * recipient hasn't opened yet).
 */
export function latestShareActivity(share: TripShare): ShareActivity | null {
  const view = share.lastViewedAt;
  const edit = share.lastEditedAt;
  if (!view && !edit) return null;
  if (edit && (!view || edit >= view)) return { kind: "edited", at: edit };
  // view is defined here because !view && !edit was caught above.
  return { kind: "viewed", at: view! };
}

const RELATIVE_TIME =
  typeof Intl !== "undefined" && typeof Intl.RelativeTimeFormat === "function"
    ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
    : null;

/**
 * Format an ISO timestamp as "5m ago" / "2h ago" / "3d ago", picking
 * the largest unit that fits so the label stays compact (it has to
 * fit inside an existing single line in the share row). SSR-safe:
 * falls back to a static "moments ago" if Intl.RelativeTimeFormat
 * isn't available.
 */
export function formatRelativeTime(iso: string): string {
  if (!RELATIVE_TIME) return "moments ago";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffSec = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return RELATIVE_TIME.format(diffSec, "second");
  if (abs < 3600) return RELATIVE_TIME.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return RELATIVE_TIME.format(Math.round(diffSec / 3600), "hour");
  if (abs < 2592000) return RELATIVE_TIME.format(Math.round(diffSec / 86400), "day");
  if (abs < 31536000) return RELATIVE_TIME.format(Math.round(diffSec / 2592000), "month");
  return RELATIVE_TIME.format(Math.round(diffSec / 31536000), "year");
}

/**
 * Combined "Viewed 5m ago" / "Edited 5m ago" label. Returns null when
 * there's no activity yet — the row should suppress the line entirely
 * rather than render an empty placeholder.
 */
export function shareActivityLabel(share: TripShare): string | null {
  const activity = latestShareActivity(share);
  if (!activity) return null;
  const verb = activity.kind === "viewed" ? "Viewed" : "Edited";
  return `${verb} ${formatRelativeTime(activity.at)}`;
}
