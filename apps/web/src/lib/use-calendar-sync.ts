"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "@travel-app/api-client";
import { toast } from "sonner";
import { useDemoMode } from "@/lib/demo";
import { CALENDAR_SCOPE, requestAdditionalScopes } from "@/lib/oauth";
import { useActiveCalendarProvider } from "@/lib/use-active-provider";

export type CalendarOption = {
  id: string;
  summary: string;
  primary: boolean;
};

type CalendarSyncTrip = {
  id: string;
  calendarId?: string;
  days: Array<{ segments: Array<{ calendarEventId?: string }> }>;
};

/**
 * Shared calendar-sync state machine used by the desktop trip header
 * dropdown and the mobile overflow sheet. Handles:
 *
 * - Scope gating (demo bypasses, real users land on a "Connect Calendar"
 *   CTA before any Google call).
 * - Loading the user's writable calendar list.
 * - Initial sync, refresh, and unsync (with delete-vs-keep choice),
 *   including the matching toasts on success / partial / error.
 *
 * This hook intentionally does **not** own the dialog/sheet open state —
 * desktop renders three radix dialogs while mobile uses a single bottom
 * sheet with steps, so each surface drives its own UI shell.
 */
export function useCalendarSync(trip: CalendarSyncTrip) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const isDemo = useDemoMode();
  // Resolve "is there ANY calendar provider linked for this user?":
  //   - Demo → google (mocks everything)
  //   - Supabase user with a `calendar` connection (google or microsoft)
  //   - Legacy Google user with `hasScope(CALENDAR_SCOPE)`
  //   - Nothing → null → gate stays closed and the UI renders the
  //     Connect CTA / NotConnectedNotice
  const { provider: activeCalendarProvider } = useActiveCalendarProvider();
  const calendarGranted = isDemo || activeCalendarProvider !== null;

  const [syncing, setSyncing] = useState(false);
  const [calendars, setCalendars] = useState<CalendarOption[] | null>(null);
  const [loadingCalendars, setLoadingCalendars] = useState(false);

  const syncedSegments = trip.days
    .flatMap((d) => d.segments)
    .filter((s) => s.calendarEventId);
  const isSynced = syncedSegments.length > 0;
  const syncedCount = syncedSegments.length;
  const syncedCalendarName = calendars?.find((c) => c.id === trip.calendarId)
    ?.summary;

  const loadCalendars = async (): Promise<CalendarOption[]> => {
    setLoadingCalendars(true);
    setCalendars(null);
    try {
      const cals = await client.listCalendars();
      setCalendars(cals);
      return cals;
    } catch {
      setCalendars([]);
      return [];
    } finally {
      setLoadingCalendars(false);
    }
  };

  const requestCalendarScope = (): void => {
    const returnTo = window.location.pathname + window.location.search;
    requestAdditionalScopes([CALENDAR_SCOPE], returnTo);
  };

  const sync = async (calendarId: string): Promise<void> => {
    setSyncing(true);
    try {
      const result = await client.syncCalendar(trip.id, calendarId);
      await queryClient.invalidateQueries({ queryKey: ["trips", trip.id] });
      const total = result.created + result.updated;
      if (result.failed > 0) {
        toast.warning(
          `${total} event${total !== 1 ? "s" : ""} synced, ${result.failed} failed`,
        );
      } else {
        toast.success(
          `${total} event${total !== 1 ? "s" : ""} synced to your calendar`,
        );
      }
    } catch {
      toast.error("Sync failed — check that Calendar access is granted.");
    } finally {
      setSyncing(false);
    }
  };

  const refresh = async (): Promise<void> => {
    setSyncing(true);
    try {
      const result = await client.syncCalendar(trip.id, trip.calendarId);
      await queryClient.invalidateQueries({ queryKey: ["trips", trip.id] });
      const total = result.created + result.updated;
      if (result.failed > 0) {
        toast.warning(
          `${total} event${total !== 1 ? "s" : ""} synced, ${result.failed} failed`,
        );
      } else {
        toast.success(
          `Calendar refreshed — ${total} event${total !== 1 ? "s" : ""} up to date`,
        );
      }
    } catch {
      toast.error("Refresh failed — check that Calendar access is granted.");
    } finally {
      setSyncing(false);
    }
  };

  const unsync = async (deleteEvents: boolean): Promise<void> => {
    setSyncing(true);
    try {
      const result = await client.unsyncCalendar(trip.id, { deleteEvents });
      await queryClient.invalidateQueries({ queryKey: ["trips", trip.id] });
      if (deleteEvents) {
        toast.success(
          `Removed ${result.removed} calendar event${result.removed !== 1 ? "s" : ""}`,
        );
      } else {
        toast.success("Sync removed — calendar events kept");
      }
    } catch {
      toast.error("Failed to remove sync.");
    } finally {
      setSyncing(false);
    }
  };

  return {
    calendarGranted,
    /**
     * Exposed so callers can show a provider-specific notice
     * (e.g. "Connect Google or Microsoft Calendar in Settings"
     * when null vs no notice when populated).
     */
    activeCalendarProvider,
    isSynced,
    syncedCount,
    syncedCalendarName,
    syncing,
    calendars,
    loadingCalendars,
    loadCalendars,
    requestCalendarScope,
    sync,
    refresh,
    unsync,
  };
}
