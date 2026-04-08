"use client";

import { createContext, useContext, useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiClient } from "./client";

const ApiClientContext = createContext<ApiClient | null>(null);

export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext);
  if (!client) {
    throw new Error("useApiClient must be used within an ApiClientProvider");
  }
  return client;
}

export function ApiClientProvider({
  baseUrl,
  client: clientProp,
  getAccessToken,
  children,
}: {
  baseUrl?: string;
  client?: ApiClient;
  getAccessToken?: () => string | null;
  children: React.ReactNode;
}) {
  const client = useMemo(
    () => clientProp ?? new ApiClient(baseUrl!, { getAccessToken }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clientProp, baseUrl],
  );
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ApiClientContext.Provider value={client}>
        {children}
      </ApiClientContext.Provider>
    </QueryClientProvider>
  );
}
