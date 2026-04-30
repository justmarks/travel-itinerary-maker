"use client";

import { useCallback, useEffect, useRef } from "react";
import { ApiClientProvider } from "@travel-app/api-client";
import { AuthProvider, useAuth } from "@/lib/auth";
import { DemoProvider, useDemoMode } from "@/lib/demo";
import { MockApiClient } from "@/lib/mock-client";
import { initMonitoring } from "@/lib/monitoring";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

const mockClient = new MockApiClient();

/**
 * Chooses between MockApiClient (demo) and real ApiClient (authenticated).
 * Reads demo mode from the URL querystring via useDemoMode().
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

  if (isDemo) {
    return (
      <ApiClientProvider baseUrl={API_BASE_URL} client={mockClient}>
        {children}
      </ApiClientProvider>
    );
  }

  return (
    <ApiClientProvider
      baseUrl={API_BASE_URL}
      getAccessToken={getAccessToken}
    >
      {children}
    </ApiClientProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }): React.JSX.Element {
  // Boot Sentry once on client hydration. No-op when NEXT_PUBLIC_SENTRY_DSN
  // is unset (dev, CI, and any deployment that hasn't opted in yet).
  useEffect(() => {
    initMonitoring();
  }, []);

  return (
    <AuthProvider>
      <DemoProvider>
        <ApiProviderSwitcher>{children}</ApiProviderSwitcher>
      </DemoProvider>
    </AuthProvider>
  );
}
