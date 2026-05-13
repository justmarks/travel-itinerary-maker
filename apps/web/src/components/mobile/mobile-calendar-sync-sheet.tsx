"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CalendarCheck,
  CalendarPlus,
  CalendarX,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import type { Trip } from "@travel-app/shared";
import { cn } from "@/lib/utils";
import { useCalendarSync } from "@/lib/use-calendar-sync";
import {
  useActiveCalendarProvider,
  calendarProviderLabel,
} from "@/lib/use-active-provider";
import { MobileBottomSheet } from "./mobile-bottom-sheet";
import { NotConnectedNotice } from "@/components/not-connected-notice";

type Step = "scope" | "pick" | "info" | "confirm-remove";

/**
 * Bottom-sheet equivalent of the desktop CalendarSyncButton flow.
 * Mirrors the same four steps consolidated into one sheet:
 *
 * - `scope` — user hasn't granted Calendar access yet, prompt to connect.
 * - `pick`  — not yet synced; pick which calendar to sync to.
 * - `info`  — synced; show count + offer Refresh / Remove sync.
 * - `confirm-remove` — choose delete-from-Google vs unlink-only.
 *
 * The hook in `@/lib/use-calendar-sync` is shared with the desktop
 * dropdown so toast copy and behavior stay identical across surfaces.
 */
export function MobileCalendarSyncSheet({
  trip,
  open,
  onClose,
}: {
  trip: Trip;
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      ariaLabel="Sync to Calendar"
    >
      {open && <CalendarSyncBody trip={trip} onClose={onClose} />}
    </MobileBottomSheet>
  );
}

function CalendarSyncBody({
  trip,
  onClose,
}: {
  trip: Trip;
  onClose: () => void;
}): React.JSX.Element {
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

  const initialStep: Step = !calendarGranted
    ? "scope"
    : isSynced
      ? "info"
      : "pick";
  const [step, setStep] = useState<Step>(initialStep);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>(
    trip.calendarId ?? "primary",
  );
  const [deleteChoice, setDeleteChoice] = useState<"delete" | "keep">("delete");

  useEffect(() => {
    if (!calendarGranted) return;
    let cancelled = false;
    void loadCalendars().then((cals) => {
      if (cancelled) return;
      const primary = cals.find((c) => c.primary);
      setSelectedCalendarId(trip.calendarId ?? primary?.id ?? "primary");
    });
    return () => {
      cancelled = true;
    };
    // Loading runs once when the sheet body mounts; the hook owns the
    // `calendars` cache so re-running on every render would thrash the
    // request. The trip id keying on the parent ensures a fresh body per
    // trip switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSync = async () => {
    await sync(selectedCalendarId);
    onClose();
  };

  const handleRefresh = async () => {
    await refresh();
    onClose();
  };

  const handleRemove = async () => {
    await unsync(deleteChoice === "delete");
    onClose();
  };

  return (
    <>
      <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-1">
        <div className="min-w-0 flex-1">
          <p className="text-kicker font-semibold text-muted-foreground">
            {providerLabel}
          </p>
          <h2 className="mt-0.5 text-lg font-semibold leading-snug">
            {step === "scope" && "Connect Calendar"}
            {step === "pick" && "Sync to Calendar"}
            {step === "info" && "Calendar sync"}
            {step === "confirm-remove" && "Remove sync"}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 pb-3">
        {step === "scope" && (
          <NotConnectedNotice capability="calendar" variant="mobile" />
        )}

        {step === "pick" && (
          <>
            <p className="text-sm text-muted-foreground">
              Select the {providerLabel} to sync this trip&apos;s events to.
            </p>
            {loadingCalendars ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading calendars…
              </div>
            ) : calendars && calendars.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {calendars.map((cal) => {
                  const active = selectedCalendarId === cal.id;
                  return (
                    <li key={cal.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedCalendarId(cal.id)}
                        aria-pressed={active}
                        className={cn(
                          "flex w-full items-center justify-between gap-3 rounded-xl border bg-background px-4 py-3 text-left transition-colors",
                          active
                            ? "border-foreground bg-muted"
                            : "border-border active:bg-muted/40",
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {cal.summary}
                          {cal.primary && (
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                              (primary)
                            </span>
                          )}
                        </span>
                        {active && (
                          <CalendarCheck
                            className="h-4 w-4 shrink-0"
                            style={{ color: "var(--status-ok-fg)" }}
                          />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : calendarError ? (
              <div
                className="rounded-xl border p-3 text-sm"
                style={{
                  borderColor: "var(--status-danger-rail)",
                  background: "var(--status-danger-bg)",
                  color: "var(--status-danger-fg)",
                }}
              >
                Couldn&apos;t load calendars: {calendarError}
              </div>
            ) : (
              // Same reconnect CTA as desktop — an empty list almost
              // always means the connection can't authenticate.
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>No writable calendars found.</p>
                <p>
                  Your {providerLabel} connection may have expired.{" "}
                  <Link
                    href="/settings/account"
                    className="font-medium text-foreground underline underline-offset-2"
                    onClick={onClose}
                  >
                    Reconnect from Settings
                  </Link>
                  {" "}to re-grant calendar access.
                </p>
              </div>
            )}
          </>
        )}

        {step === "info" && (
          <p className="text-sm text-muted-foreground">
            {syncedCount} event{syncedCount !== 1 ? "s" : ""} synced
            {syncedCalendarName ? ` to ${syncedCalendarName}` : ""}. New and
            edited events are pushed automatically.
          </p>
        )}

        {step === "confirm-remove" && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              What should happen to the calendar events?
            </p>
            <label
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border p-3",
                deleteChoice === "delete"
                  ? "border-foreground bg-muted"
                  : "border-border bg-background",
              )}
            >
              <input
                type="radio"
                name="m-cal-delete-choice"
                value="delete"
                checked={deleteChoice === "delete"}
                onChange={() => setDeleteChoice("delete")}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-medium">
                  Delete from {providerLabel}
                </p>
                <p className="text-xs text-muted-foreground">
                  Remove all synced events from your calendar.
                </p>
              </div>
            </label>
            <label
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border p-3",
                deleteChoice === "keep"
                  ? "border-foreground bg-muted"
                  : "border-border bg-background",
              )}
            >
              <input
                type="radio"
                name="m-cal-delete-choice"
                value="keep"
                checked={deleteChoice === "keep"}
                onChange={() => setDeleteChoice("keep")}
                className="mt-0.5"
              />
              <div>
                <p className="text-sm font-medium">Keep in {providerLabel}</p>
                <p className="text-xs text-muted-foreground">
                  Events stay in your calendar but won&apos;t be updated by
                  this app.
                </p>
              </div>
            </label>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t bg-background px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        {step === "scope" && (
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-full border bg-background text-sm font-medium text-foreground active:bg-muted/40"
          >
            Close
          </button>
        )}

        {step === "pick" && (
          <>
            <button
              type="button"
              onClick={onClose}
              className="h-11 flex-1 rounded-full border bg-background text-sm font-medium text-foreground active:bg-muted/40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSync}
              disabled={syncing || loadingCalendars || !calendars?.length}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-foreground text-sm font-medium text-background active:opacity-80 disabled:opacity-50"
            >
              {syncing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CalendarPlus className="h-4 w-4" />
              )}
              {syncing ? "Syncing…" : "Sync"}
            </button>
          </>
        )}

        {step === "info" && (
          <>
            <button
              type="button"
              onClick={() => setStep("confirm-remove")}
              disabled={syncing}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full border bg-background text-sm font-medium text-foreground active:bg-muted/40 disabled:opacity-50"
            >
              <CalendarX className="h-4 w-4" />
              Remove
            </button>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={syncing}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-foreground text-sm font-medium text-background active:opacity-80 disabled:opacity-50"
            >
              {syncing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {syncing ? "Refreshing…" : "Refresh"}
            </button>
          </>
        )}

        {step === "confirm-remove" && (
          <>
            <button
              type="button"
              onClick={() => setStep("info")}
              disabled={syncing}
              className="h-11 flex-1 rounded-full border bg-background text-sm font-medium text-foreground active:bg-muted/40 disabled:opacity-50"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleRemove}
              disabled={syncing}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full text-sm font-medium text-background active:opacity-80 disabled:opacity-50"
              style={{ backgroundColor: "var(--status-danger-fg)" }}
            >
              {syncing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CalendarX className="h-4 w-4" />
              )}
              {syncing ? "Removing…" : "Remove sync"}
            </button>
          </>
        )}
      </div>
    </>
  );
}
