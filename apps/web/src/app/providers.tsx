"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { ThemeProvider } from "next-themes";
import { polyfillCountryFlagEmojis } from "country-flag-emoji-polyfill";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { ApiClientProvider } from "@travel-app/api-client";
import { AuthProvider, useAuth } from "@/lib/auth";
import { DemoProvider, useDemoMode } from "@/lib/demo";
import { MockApiClient } from "@/lib/mock-client";
import { initMonitoring } from "@/lib/monitoring";
import { createWebQueryClient } from "@/lib/query-client";
import { ServiceWorkerRegister } from "@/components/pwa/sw-register";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

const mockClient = new MockApiClient();

/**
 * Chooses between MockApiClient (demo) and real ApiClient (authenticated).
 * Reads demo mode from the URL querystring via useDemoMode().
 *
 * When persistence is enabled (real auth, not demo) the children are wrapped
 * in `PersistQueryClientProvider` — that gates queries from running until the
 * `localStorage` cache has been restored. Without this gate, a cold offline
 * launch would race: `useTrips` fires, queryFn rejects (no network), the
 * query lands in `isError`, and even when hydration completes a tick later
 * the user has already seen the offline error. With the gate, the cache is
 * in place before the first queryFn call, so cached trips render
 * immediately.
 */
function ApiProviderSwitcher({ children }: { children: React.ReactNode }) {
  const isDemo = useDemoMode();
  const { accessToken } = useAuth();

  // Keep a stable function reference that always returns the latest token.
  // This avoids recreating the ApiClient on every render while ensuring
  // requests always use the current access token.
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;
  const getAccessToken = useCallback(() => tokenRef.current, []);

  // One QueryClient per session. Demo mode opts out of localStorage
  // persistence so sample data doesn't leak between visits or collide with
  // real-account data.
  const { queryClient, persistOptions } = useMemo(
    () => createWebQueryClient({ enabled: !isDemo }),
    [isDemo],
  );

  const apiTree = isDemo ? (
    <ApiClientProvider
      baseUrl={API_BASE_URL}
      client={mockClient}
      queryClient={queryClient}
    >
      {children}
    </ApiClientProvider>
  ) : (
    <ApiClientProvider
      baseUrl={API_BASE_URL}
      getAccessToken={getAccessToken}
      queryClient={queryClient}
    >
      {children}
    </ApiClientProvider>
  );

  if (!persistOptions) return apiTree;

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      {apiTree}
    </PersistQueryClientProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }): React.JSX.Element {
  // Boot Sentry once on client hydration. No-op when NEXT_PUBLIC_SENTRY_DSN
  // is unset (dev, CI, and any deployment that hasn't opted in yet).
  //
  // The flag polyfill injects an `@font-face` rule pointing at a small
  // Twemoji subset. Windows + Chrome doesn't ship a flag-emoji font and
  // would otherwise render trip-card flags as country-code letters.
  // Idempotent — safe to call from a useEffect that re-runs on HMR.
  useEffect(() => {
    initMonitoring();
    polyfillCountryFlagEmojis();
  }, []);

  return (
    // next-themes toggles `.dark` on <html> based on the active theme. Pairs
    // with the `@custom-variant dark` override in globals.css so Tailwind's
    // `dark:` utilities respond to the user's explicit choice rather than
    // only `prefers-color-scheme`. `defaultTheme="system"` honours the OS
    // preference until the user picks Light or Dark from the user menu.
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <AuthProvider>
        <DemoProvider>
          <ApiProviderSwitcher>{children}</ApiProviderSwitcher>
          <ServiceWorkerRegister />
        </DemoProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
