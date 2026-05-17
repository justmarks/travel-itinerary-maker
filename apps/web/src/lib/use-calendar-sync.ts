"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApiClient, useTripCalendarSync } from "@itinly/api-client";
import { toast } from "sonner";
import { describeError } from "@/lib/api-error";
import { useDemoMode } from "@/lib/demo";
import { CALENDAR_SCOPE, requestAdditionalScopes } from "@/lib/oauth";
import {
  useActiveCalendarProvider,
  useConnectedCalendarProviders,
  type CalendarProvider,
} from "@/lib/use-active-provider";

export type CalendarOption = {
  id: string;
  summary: string;
  primary: boolean;
};

/**
 * The hook only needs the trip's id — its sync state comes from a
 * dedicated per-user query (`useTripCalendarSync`). The legacy
 * shape with `trip.calendarId` + `segment.calendarEventId` is gone:
 * those moved server-side into `trip_user_calendar_syncs` so each
 * user (owner + shared-edit recipients) has their own row.
 */
type CalendarSyncTrip = {
  id: string;
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
/**
 * Per-trip localStorage key for the user's last calendar-provider
 * choice. Scoped to trip so the picker can default to whatever was
 * last used for THIS trip — switching trips shouldn't drag a stale
 * choice along.
 */
function providerStorageKey(tripId: string): string {
  return `itinly:calendar-provider:${tripId}`;
}

export function readStoredCalendarProvider(
  tripId: string,
): CalendarProvider | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(providerStorageKey(tripId));
  return raw === "google" || raw === "microsoft" ? raw : null;
}

export function writeStoredCalendarProvider(
  tripId: string,
  provider: CalendarProvider,
): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(providerStorageKey(tripId), provider);
}

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
  const { providers: connectedProviders } = useConnectedCalendarProviders();
  const calendarGranted = isDemo || activeCalendarProvider !== null;

  // Default = stored choice if it's still a connected provider; else
  // the resolver's auto-pick (Microsoft-first). null means "let the
  // server auto-pick" and is the right default during initial load.
  const stored = readStoredCalendarProvider(trip.id);
  const defaultProvider: CalendarProvider | null =
    stored && connectedProviders.includes(stored)
      ? stored
      : activeCalendarProvider;
  const [selectedProvider, setSelectedProviderState] =
    useState<CalendarProvider | null>(defaultProvider);

  const setSelectedProvider = (provider: CalendarProvider): void => {
    setSelectedProviderState(provider);
    writeStoredCalendarProvider(trip.id, provider);
  };

  const [syncing, setSyncing] = useState(false);
  const [calendars, setCalendars] = useState<CalendarOption[] | null>(null);
  const [loadingCalendars, setLoadingCalendars] = useState(false);

  // Per-user sync state from the server. Replaces the legacy reads
  // off the trip object. `enabled` is gated on `calendarGranted` so
  // we don't fire a 401 / connect-prompt query for users who haven't
  // linked a calendar yet.
  const { data: syncState } = useTripCalendarSync(trip.id, {
    enabled: calendarGranted,
  });
  const syncedCount = syncState
    ? Object.keys(syncState.segmentEventMap).length
    : 0;
  const isSynced = syncedCount > 0;
  const syncedCalendarId = syncState?.calendarId;
  const syncedCalendarName = calendars?.find((c) => c.id === syncedCalendarId)
    ?.summary;

  const effectiveProvider = (): CalendarProvider | undefined =>
    selectedProvider ?? defaultProvider ?? undefined;

  /**
   * `providerOverride` lets the caller force a specific provider for
   * this call. Needed because `setSelectedProvider` is async (state
   * update) — a "click Outlook → reload" handler that called
   * `loadCalendars()` immediately after would hit the closure with
   * the OLD `selectedProvider` and request the wrong account's list,
   * which is exactly the bug a user hit in production (clicked
   * Outlook, server hit Google API, got a Google-shaped 401).
   */
  const loadCalendars = async (
    providerOverride?: CalendarProvider,
  ): Promise<CalendarOption[]> => {
    setLoadingCalendars(true);
    setCalendars(null);
    try {
      const cals = await client.listCalendars(
        providerOverride ?? effectiveProvider(),
      );
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

  // Invalidate the per-user sync query (calendarId + segmentEventMap)
  // on every mutation. The trip query no longer carries calendar
  // state, so the legacy `["trips", id]` invalidation is gone.
  const invalidateSyncQuery = async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: ["trips", trip.id, "calendar-sync"],
    });
  };

  const sync = async (calendarId: string): Promise<void> => {
    setSyncing(true);
    try {
      const result = await client.syncCalendar(
        trip.id,
        calendarId,
        effectiveProvider(),
      );
      await invalidateSyncQuery();
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
    } catch (err) {
      toast.error("Sync failed — check that Calendar access is granted.", {
        description: describeError(err),
      });
    } finally {
      setSyncing(false);
    }
  };

  const refresh = async (): Promise<void> => {
    setSyncing(true);
    try {
      const result = await client.syncCalendar(
        trip.id,
        syncedCalendarId,
        effectiveProvider(),
      );
      await invalidateSyncQuery();
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
    } catch (err) {
      toast.error("Refresh failed — check that Calendar access is granted.", {
        description: describeError(err),
      });
    } finally {
      setSyncing(false);
    }
  };

  const unsync = async (deleteEvents: boolean): Promise<void> => {
    setSyncing(true);
    try {
      const result = await client.unsyncCalendar(trip.id, {
        deleteEvents,
        provider: effectiveProvider(),
      });
      await invalidateSyncQuery();
      if (deleteEvents) {
        toast.success(
          `Removed ${result.removed} calendar event${result.removed !== 1 ? "s" : ""}`,
        );
      } else {
        toast.success("Sync removed — calendar events kept");
      }
    } catch (err) {
      toast.error("Couldn't remove sync", {
        description: describeError(err),
      });
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
    /**
     * Every linked calendar provider for this user, in Microsoft-first
     * order. Dialogs render the inline picker when length > 1.
     */
    connectedProviders,
    /**
     * The provider currently driving sync calls — defaults to the
     * stored last-choice (per trip) or the auto-picked active provider.
     */
    selectedProvider: selectedProvider ?? defaultProvider,
    setSelectedProvider,
    isSynced,
    syncedCount,
    /** The user's currently-synced calendar id (or undefined). */
    syncedCalendarId,
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
