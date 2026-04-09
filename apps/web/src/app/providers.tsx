"use client";

import { GoogleOAuthProvider } from "@react-oauth/google";
import { ApiClientProvider } from "@travel-app/api-client";
import { AuthProvider, useAuth } from "@/lib/auth";
import { DemoProvider, useDemoMode } from "@/lib/demo";
import { MockApiClient } from "@/lib/mock-client";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

const mockClient = new MockApiClient();

/**
 * Chooses between MockApiClient (demo) and real ApiClient (authenticated).
 * Reads demo mode from the URL querystring via useDemoMode().
 */
function ApiProviderSwitcher({ children }: { children: React.ReactNode }) {
  const isDemo = useDemoMode();
  const { accessToken } = useAuth();

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
      getAccessToken={() => accessToken}
    >
      {children}
    </ApiClientProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <AuthProvider>
        <DemoProvider>
          <ApiProviderSwitcher>{children}</ApiProviderSwitcher>
        </DemoProvider>
      </AuthProvider>
    </GoogleOAuthProvider>
  );
}
