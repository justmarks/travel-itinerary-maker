/**
 * Tiny wrapper around Microsoft Graph HTTP calls. We deliberately do
 * NOT use `@microsoft/microsoft-graph-client` — the SDK adds 200+kB
 * of dependencies for what amounts to "fetch with an Authorization
 * header." Direct `fetch` keeps the dependency surface small, makes
 * tests trivial to mock (override `global.fetch`), and avoids the
 * SDK's odd typing conventions.
 *
 * The wrapper is intentionally low-level:
 *  - Caller provides the access token (refresh logic lives one layer
 *    up, where it can read the user's `connections` row).
 *  - Caller provides the relative path; we prepend the Graph v1
 *    base URL.
 *  - Errors are surfaced as `GraphError` instances carrying the HTTP
 *    status + Graph error code + message — so the calling connector
 *    can map specific failure modes (401 token expired, 403 missing
 *    scope, 404 event not found → recreate) without parsing strings.
 */

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

export class GraphError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

export interface GraphRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /**
   * OData query parameters: `$filter`, `$top`, `$select`, `$orderby`,
   * `$expand`. Pre-encoded by callers (the wrapper concatenates as
   * `?$filter=foo&$top=N`).
   */
  query?: Record<string, string>;
}

/**
 * Performs an authenticated Graph request and returns the parsed JSON
 * body. Returns `null` for 204 No Content (typical for DELETE).
 *
 * Throws `GraphError` on any non-2xx response. The thrown error
 * carries the Graph-specific `code` from the response envelope when
 * present, so callers can branch on (e.g.) `code === "ErrorItemNotFound"`
 * for the calendar event recreate-on-404 case.
 */
export async function graphRequest<T = unknown>(
  accessToken: string,
  path: string,
  options: GraphRequestOptions = {},
): Promise<T | null> {
  const { method = "GET", body, query } = options;

  const url = new URL(`${GRAPH_BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };
  let requestBody: string | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestBody = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: requestBody,
  });

  if (res.status === 204) {
    return null;
  }

  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Graph always returns JSON for both success and error responses
      // when there's a body — non-JSON means something deep is wrong.
      throw new GraphError(
        res.status,
        undefined,
        `Microsoft Graph returned non-JSON response: ${text.slice(0, 200)}`,
      );
    }
  }

  if (!res.ok) {
    const errorEnvelope =
      typeof parsed === "object" && parsed !== null && "error" in parsed
        ? (parsed as { error: { code?: string; message?: string } }).error
        : null;
    throw new GraphError(
      res.status,
      errorEnvelope?.code,
      errorEnvelope?.message ?? `Microsoft Graph error ${res.status}`,
    );
  }

  return parsed as T;
}

/**
 * Microsoft Graph paginates responses with an `@odata.nextLink`
 * absolute URL. Helper that walks the chain and concatenates the
 * `value` arrays — used by `listCalendars` / `listMailFolders` etc.
 * Bounds the walk at `maxPages` to avoid runaway iteration when an
 * upstream bug points the nextLink at itself.
 */
export async function graphPaginate<T>(
  accessToken: string,
  initialPath: string,
  options: GraphRequestOptions = {},
  maxPages = 20,
): Promise<T[]> {
  const results: T[] = [];
  let nextUrl: string | null = null;
  let page = 0;

  // First page goes through the normal helper for path + query handling.
  const first = await graphRequest<{ value: T[]; "@odata.nextLink"?: string }>(
    accessToken,
    initialPath,
    options,
  );
  if (first) {
    results.push(...first.value);
    nextUrl = first["@odata.nextLink"] ?? null;
  }

  while (nextUrl && page < maxPages) {
    const res = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const text = await res.text();
    const parsed = text ? (JSON.parse(text) as {
      value?: T[];
      "@odata.nextLink"?: string;
      error?: { code?: string; message?: string };
    }) : null;
    if (!res.ok) {
      throw new GraphError(
        res.status,
        parsed?.error?.code,
        parsed?.error?.message ?? `Microsoft Graph error ${res.status}`,
      );
    }
    if (parsed?.value) results.push(...parsed.value);
    nextUrl = parsed?.["@odata.nextLink"] ?? null;
    page++;
  }

  return results;
}
