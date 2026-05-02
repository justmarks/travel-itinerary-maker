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
  queryClient: queryClientProp,
  children,
}: {
  baseUrl?: string;
  client?: ApiClient;
  getAccessToken?: () => string | null;
  /**
   * Optional QueryClient to use instead of creating one. Pass when the
   * consumer needs to wire up extras like persistence (e.g. localStorage
   * cache for offline use) outside of this package.
   */
  queryClient?: QueryClient;
  children: React.ReactNode;
}) {
  const client = useMemo(
    () => clientProp ?? new ApiClient(baseUrl!, { getAccessToken }),
    // getAccessToken intentionally excluded — callers should provide a
    // stable function ref (e.g. via useCallback + useRef) so the ApiClient
    // instance is only recreated when baseUrl or clientProp changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clientProp, baseUrl],
  );
  const fallbackClient = useMemo(
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
  const queryClient = queryClientProp ?? fallbackClient;

  return (
    <QueryClientProvider client={queryClient}>
      <ApiClientContext.Provider value={client}>
        {children}
      </ApiClientContext.Provider>
    </QueryClientProvider>
  );
}
