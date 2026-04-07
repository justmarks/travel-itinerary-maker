"use client";

import { ApiClientProvider } from "@travel-app/api-client";
import { MockApiClient } from "@/lib/mock-client";

const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

const mockClient = IS_DEMO ? new MockApiClient() : undefined;

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ApiClientProvider baseUrl={API_BASE_URL} client={mockClient}>
      {children}
    </ApiClientProvider>
  );
}
