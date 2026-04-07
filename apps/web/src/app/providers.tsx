"use client";

import { ApiClientProvider } from "@travel-app/api-client";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ApiClientProvider baseUrl={API_BASE_URL}>{children}</ApiClientProvider>
  );
}
