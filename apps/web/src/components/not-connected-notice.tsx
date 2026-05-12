"use client";

/**
 * Inline banner shown when a feature can't run because the user
 * hasn't linked the underlying provider (Gmail/Outlook for email
 * scan; Google/Microsoft Calendar for sync). Routes the user to
 * `/settings/account` where the Connect buttons live.
 *
 * Pattern decision: we never toast NOT_CONNECTED errors. A toast
 * auto-dismisses; this error needs the user to take action on
 * another page. An inline notice keeps the call-to-action stable
 * where the user is already trying to do the work — they can read
 * + click without racing against a 5-second timeout.
 *
 * Pairs with the server-side 401 codes from Phase 4b-2:
 *   - `EMAIL_NOT_CONNECTED` → email-scan call sites render this
 *     with capability="email".
 *   - `CALENDAR_NOT_CONNECTED` → calendar-list / sync call sites
 *     render this with capability="calendar".
 */

import Link from "next/link";
import { Link2Off } from "lucide-react";

const COPY = {
  email: {
    title: "Connect an email account to scan for travel emails",
    body: "Granting read access to your mailbox lets the app find travel confirmations and turn them into trip segments.",
    cta: "Open Settings to connect Gmail or Outlook",
  },
  calendar: {
    title: "Connect a calendar to sync your trips",
    body: "Trip segments get pushed to your calendar so they show up next to the rest of your week.",
    cta: "Open Settings to connect Google or Microsoft Calendar",
  },
} as const;

export function NotConnectedNotice({
  capability,
  /**
   * `/m` for mobile callers so they land on the mobile settings
   * page; desktop callers default to `/settings/account`.
   */
  variant = "desktop",
}: {
  capability: "email" | "calendar";
  variant?: "desktop" | "mobile";
}): React.JSX.Element {
  const copy = COPY[capability];
  const href = variant === "mobile" ? "/m/settings/account" : "/settings/account";
  return (
    <div className="flex items-start gap-3 rounded-md border border-border bg-muted/40 p-4 text-sm">
      <Link2Off className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex flex-col gap-2">
        <div>
          <p className="font-medium">{copy.title}</p>
          <p className="text-muted-foreground">{copy.body}</p>
        </div>
        <Link
          href={href}
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          {copy.cta}
        </Link>
      </div>
    </div>
  );
}
