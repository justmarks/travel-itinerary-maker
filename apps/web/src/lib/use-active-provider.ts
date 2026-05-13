"use client";

/**
 * Resolves "which provider serves email / calendar features for this
 * user RIGHT NOW?" — the unified feature-gate the scan + sync UIs
 * use. Handles three populations:
 *
 *  1. Supabase-authed user with `/connections` rows (Phase 4b+) —
 *     return the provider that owns the most-recently-active
 *     connection for the capability. Microsoft-first when both
 *     exist (matches the server's resolver, so the UI's "what
 *     provider would this hit" matches what the server will do).
 *  2. Legacy Google-authed user with a Gmail link in `TokenStore`
 *     (pre-Phase-4c) — `useAuth().hasGmailLink` is true → email
 *     resolves to Google. Calendar resolves to Google when
 *     `hasScope(CALENDAR_SCOPE)` is true.
 *  3. No link of any kind — return null. Caller renders a
 *     "Connect …" advertisement pointing at /settings/account.
 *
 * The legacy branches let users on the old auth flow keep using
 * the features without re-linking, which matters until Phase 5
 * migration finishes.
 */

import { useMemo } from "react";
import { useConnections } from "@itinly/api-client";
import { useAuth } from "@/lib/auth";
import { useDemoMode } from "@/lib/demo";
import { CALENDAR_SCOPE } from "@/lib/oauth";

export type EmailProvider = "google" | "microsoft";
export type CalendarProvider = "google" | "microsoft";

interface ActiveProviderResult<TProvider> {
  /** The provider serving this capability today, or null if none. */
  provider: TProvider | null;
  /** True while we're still loading the source of truth. */
  isLoading: boolean;
}

/**
 * `enabled` defaults to true; pass false to skip the underlying
 * `/connections` fetch when the caller knows it's not needed (e.g.
 * the dialog hasn't opened yet). Mirrors the `useGmailLabels` knob.
 */
export function useActiveEmailProvider(
  enabled = true,
): ActiveProviderResult<EmailProvider> {
  const { hasGmailLink, isAuthenticated } = useAuth();
  const isDemo = useDemoMode();
  // Skip the /connections fetch when no auth path could possibly
  // serve email — saves a network call on the marketing / login
  // pages. Demo mode short-circuits below anyway.
  const {
    data: connectionsData,
    isLoading,
  } = useConnections(enabled && isAuthenticated && !isDemo);

  return useMemo(() => {
    if (isDemo) {
      // Demo mode acts as if everything is connected via Google so
      // the scan UI fully renders without real auth.
      return { provider: "google", isLoading: false };
    }
    if (hasGmailLink) {
      // Legacy Gmail link path (TokenStore). Even if the user has
      // since linked an Outlook connection, the legacy link still
      // works — but Microsoft-first matches the server resolver, so
      // we check connections first.
    }
    if (connectionsData) {
      const emailRows = connectionsData.connections.filter(
        (c) => c.capability === "email" && c.status === "active",
      );
      if (emailRows.length > 0) {
        // Microsoft-first matches the server's resolver in
        // server/src/connectors/resolve.ts.
        const microsoft = emailRows.find((c) => c.provider === "microsoft");
        if (microsoft) return { provider: "microsoft", isLoading: false };
        return { provider: "google", isLoading: false };
      }
    }
    // No connections-row match. Fall back to legacy Gmail link.
    if (hasGmailLink) {
      return { provider: "google", isLoading: false };
    }
    return { provider: null, isLoading };
  }, [isDemo, hasGmailLink, connectionsData, isLoading]);
}

export function useActiveCalendarProvider(
  enabled = true,
): ActiveProviderResult<CalendarProvider> {
  const { hasScope, isAuthenticated } = useAuth();
  const isDemo = useDemoMode();
  const legacyCalendarGranted = hasScope(CALENDAR_SCOPE);
  const {
    data: connectionsData,
    isLoading,
  } = useConnections(enabled && isAuthenticated && !isDemo);

  return useMemo(() => {
    if (isDemo) return { provider: "google", isLoading: false };
    if (connectionsData) {
      const calRows = connectionsData.connections.filter(
        (c) => c.capability === "calendar" && c.status === "active",
      );
      if (calRows.length > 0) {
        const microsoft = calRows.find((c) => c.provider === "microsoft");
        if (microsoft) return { provider: "microsoft", isLoading: false };
        return { provider: "google", isLoading: false };
      }
    }
    if (legacyCalendarGranted) {
      return { provider: "google", isLoading: false };
    }
    return { provider: null, isLoading };
  }, [isDemo, legacyCalendarGranted, connectionsData, isLoading]);
}

interface ConnectedProvidersResult<TProvider> {
  /**
   * All providers the user has actively linked for this capability,
   * Microsoft-first to match the server's auto-pick. Empty when none.
   */
  providers: TProvider[];
  isLoading: boolean;
}

/**
 * Lists every active calendar provider for the current user. Used by
 * sync dialogs to decide whether to render the inline provider picker
 * — show it when `providers.length > 1`.
 */
export function useConnectedCalendarProviders(
  enabled = true,
): ConnectedProvidersResult<CalendarProvider> {
  const { hasScope, isAuthenticated } = useAuth();
  const isDemo = useDemoMode();
  const legacyCalendarGranted = hasScope(CALENDAR_SCOPE);
  const { data, isLoading } = useConnections(
    enabled && isAuthenticated && !isDemo,
  );

  return useMemo(() => {
    if (isDemo) return { providers: ["google"], isLoading: false };
    const set = new Set<CalendarProvider>();
    if (data) {
      for (const c of data.connections) {
        if (c.capability === "calendar" && c.status === "active") {
          set.add(c.provider);
        }
      }
    }
    if (legacyCalendarGranted) set.add("google");
    // Microsoft-first ordering matches the server resolver.
    const providers: CalendarProvider[] = [];
    if (set.has("microsoft")) providers.push("microsoft");
    if (set.has("google")) providers.push("google");
    return { providers, isLoading };
  }, [isDemo, legacyCalendarGranted, data, isLoading]);
}

/**
 * Lists every active email provider for the current user. Used by
 * scan dialogs to render the inline provider picker when both Gmail
 * and Outlook are linked.
 */
export function useConnectedEmailProviders(
  enabled = true,
): ConnectedProvidersResult<EmailProvider> {
  const { hasGmailLink, isAuthenticated } = useAuth();
  const isDemo = useDemoMode();
  const { data, isLoading } = useConnections(
    enabled && isAuthenticated && !isDemo,
  );

  return useMemo(() => {
    if (isDemo) return { providers: ["google"], isLoading: false };
    const set = new Set<EmailProvider>();
    if (data) {
      for (const c of data.connections) {
        if (c.capability === "email" && c.status === "active") {
          set.add(c.provider);
        }
      }
    }
    if (hasGmailLink) set.add("google");
    const providers: EmailProvider[] = [];
    if (set.has("microsoft")) providers.push("microsoft");
    if (set.has("google")) providers.push("google");
    return { providers, isLoading };
  }, [isDemo, hasGmailLink, data, isLoading]);
}

/**
 * Provider-aware label/folder copy. Gmail organises mail by labels;
 * Outlook by folders. Both expose the same `EmailLabel` API but the
 * UI reads more naturally when it uses the right term.
 */
export function emailLabelNoun(provider: EmailProvider | null): string {
  return provider === "microsoft" ? "folder" : "label";
}

export function emailProviderLabel(provider: EmailProvider | null): string {
  if (provider === "microsoft") return "Outlook";
  if (provider === "google") return "Gmail";
  return "Email";
}

export function calendarProviderLabel(
  provider: CalendarProvider | null,
): string {
  if (provider === "microsoft") return "Outlook Calendar";
  if (provider === "google") return "Google Calendar";
  return "Calendar";
}
