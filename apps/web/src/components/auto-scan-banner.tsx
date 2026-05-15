"use client";

import Link from "next/link";
import { Inbox, X } from "lucide-react";
import { usePendingEmails } from "@itinly/api-client";
import { useDemoMode } from "@/lib/demo";
import { useEffect, useState } from "react";

const DISMISS_KEY = "itinly-autoscan-banner-dismissed-at";
/**
 * How long a "Dismiss" lasts before the banner reappears with a new
 * pending count. Mirrors the iOS "Show later" notification model.
 */
const DISMISS_TTL_MS = 6 * 60 * 60 * 1000; // 6h

/**
 * Top-of-page banner that surfaces when an auto-scan has parsed
 * email confirmations the user hasn't reviewed yet. Reuses the
 * existing `usePendingEmails` query (the same one that powers the
 * scan dialog's review step) so we don't introduce a separate "unread
 * notifications" counter on the server — pending parsed-but-not-yet-
 * applied results ARE the unread state.
 *
 * The banner intentionally renders nothing in demo mode (no real
 * mailbox to scan) and stays hidden when the user has explicitly
 * dismissed it in the last 6 hours.
 *
 * Layout: small horizontal pill on /m, slightly wider on desktop.
 * Click → /m (so notification taps on installed PWA land in the
 * mobile shell which has the review sheet).
 */
export function AutoScanBanner({
  href = "/m",
  variant = "desktop",
}: {
  /** Where the user lands when they click "Review". */
  href?: string;
  /** Visual treatment. Mobile uses a thinner row inside MobileFrame. */
  variant?: "desktop" | "mobile";
}): React.JSX.Element | null {
  const isDemo = useDemoMode();
  const { data } = usePendingEmails(!isDemo);
  const pending = data?.results ?? [];
  const segmentCount = pending.reduce(
    (n, r) => n + r.parsedSegments.length,
    0,
  );
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  // Hydrate the dismiss timestamp from localStorage on mount so a
  // refresh inside the dismiss window doesn't pop the banner again.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(DISMISS_KEY);
      const parsed = raw ? parseInt(raw, 10) : NaN;
      if (!Number.isNaN(parsed)) setDismissedAt(parsed);
    } catch {
      // localStorage disabled (private browsing) — banner just won't
      // remember dismisses across page loads, which is fine.
    }
  }, []);

  if (isDemo) return null;
  if (segmentCount === 0) return null;
  if (dismissedAt && Date.now() - dismissedAt < DISMISS_TTL_MS) return null;

  const onDismiss = () => {
    const now = Date.now();
    setDismissedAt(now);
    try {
      window.localStorage.setItem(DISMISS_KEY, String(now));
    } catch {
      // Same fallback as above — silent.
    }
  };

  return (
    <div
      role="status"
      className={
        variant === "mobile"
          ? "mx-3 mt-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"
          : "mx-auto mt-4 flex max-w-3xl items-center gap-2 rounded-lg border px-4 py-2.5 text-sm"
      }
      style={{
        backgroundColor: "var(--status-info-bg)",
        color: "var(--status-info-fg)",
        borderColor: "var(--status-info-rail)",
      }}
    >
      <Inbox className="h-4 w-4 shrink-0" />
      <p className="flex-1 truncate">
        <strong>{segmentCount}</strong> new booking
        {segmentCount === 1 ? "" : "s"} ready to review.
      </p>
      <Link
        href={href}
        className="rounded-full border border-current px-2.5 py-0.5 text-xs font-medium hover:bg-current/10"
      >
        Review
      </Link>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-current/10"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
