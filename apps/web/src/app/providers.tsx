"use client";

import { GoogleOAuthProvider } from "@react-oauth/google";
import { ApiClientProvider } from "@travel-app/api-client";
import { AuthProvider, useAuth } from "@/lib/auth";
import { MockApiClient } from "@/lib/mock-client";

const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

const mockClient = IS_DEMO ? new MockApiClient() : undefined;

function ApiProviderWithAuth({ children }: { children: React.ReactNode }) {
  const { accessToken } = useAuth();

  return (
    <ApiClientProvider
      baseUrl={API_BASE_URL}
      client={mockClient}
      getAccessToken={() => accessToken}
    >
      {children}
    </ApiClientProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  if (IS_DEMO) {
    return (
      <AuthProvider>
        <ApiClientProvider baseUrl={API_BASE_URL} client={mockClient}>
          {children}
        </ApiClientProvider>
      </AuthProvider>
    );
  }

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <AuthProvider>
        <ApiProviderWithAuth>{children}</ApiProviderWithAuth>
      </AuthProvider>
    </GoogleOAuthProvider>
  );
}
