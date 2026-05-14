import type {
  Trip,
  TripDay,
  Segment,
  Todo,
  TripShare,
  TripShareRule,
  CostSummaryItem,
  CreateTripInput,
  UpdateTripInput,
  CreateSegmentInput,
  CreateTodoInput,
  UpdateTodoInput,
  CreateShareInput,
  CreateShareRuleInput,
  UpdateShareRuleInput,
  PushSubscriptionInput,
  EmailScanResult,
  GmailLabel,
  ApplyParsedSegmentsInput,
  EmailScanRequest,
  HtmlImportRequest,
  ImportSharedRequest,
  XlsxImportRequest,
} from "@itinly/shared";

export interface PushStatusResponse {
  subscribed: boolean;
  deviceCount: number;
}

export interface PushConfigResponse {
  publicKey: string | null;
  enabled: boolean;
}

export interface XlsxImportResponse {
  trip: Trip;
  warnings: string[];
  unmatchedCosts: Array<{
    category: string;
    amount: number;
    currency: string;
    details?: string;
  }>;
}

export interface TripSummary {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  status: string;
  dayCount: number;
  todoCount: number;
  /**
   * The city the user spends the most days in, derived server-side from
   * `TripDay.city`. Undefined for trips with no usable city data (e.g. a
   * freshly-created trip whose days are all blank, or a cruise where every
   * day is "At Sea"). Used by the trip card to pick a hero image.
   */
  primaryCity?: string;
  /** ISO 3166-1 alpha-2 code for `primaryCity`, when known. */
  primaryCountryCode?: string;
  /** Display country name for `primaryCity`, when known. */
  primaryCountry?: string;
  createdAt: string;
  updatedAt: string;
  /**
   * Set on trips the user does NOT own — populated when the trip is in
   * the user's list because someone shared it with them. Carries the
   * owner's email so the UI can render an attribution like "Shared by
   * alice@…". Absent for the user's own trips.
   */
  sharedFromEmail?: string;
  /**
   * Permission granted on a shared trip — "view" for read-only access,
   * "edit" for contributor write access. Absent on owned trips.
   */
  sharedPermission?: "view" | "edit";
  /**
   * Per-share visibility flag — `false` means the owner asked us to hide
   * costs from this recipient. The contributor UI gates its Costs pill
   * / sheet / tab on this. Absent on owned trips.
   */
  sharedShowCosts?: boolean;
  /**
   * Same idea for the to-do list. The summary's `todoCount` is also
   * forced to 0 server-side when this is `false` so the trip card
   * doesn't leak the count.
   */
  sharedShowTodos?: boolean;
  /**
   * The id of the share row that grants the current user access — what
   * the trip card / detail page POSTs to the leave-trip endpoint when
   * the recipient wants to self-remove. Absent on owned trips.
   */
  sharedShareId?: string;
}

export interface CostSummaryResponse {
  items: CostSummaryItem[];
  totalsByCurrency: Record<string, number>;
  /**
   * Grand total converted to USD. Only includes items whose currency has a
   * supported FX rate. Undefined if no items had a USD conversion available.
   */
  totalUsd?: number;
}

export interface SharedTripResponse {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  status: string;
  days: TripDay[];
  todos: Todo[];
  permission: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API error ${status}`);
    this.name = "ApiError";
  }
}

export class ApiClient {
  private getAccessToken?: () => string | null;

  constructor(
    private baseUrl: string,
    options?: { getAccessToken?: () => string | null },
  ) {
    this.getAccessToken = options?.getAccessToken;
  }

  private async request<T>(
    path: string,
    options?: RequestInit,
  ): Promise<T> {
    const token = this.getAccessToken?.();
    const authHeaders: Record<string, string> = token
      ? { Authorization: `Bearer ${token}` }
      : {};

    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...authHeaders,
        ...options?.headers,
      },
      ...options,
    });

    if (res.status === 204) return undefined as T;

    // Try to decode the body as JSON. Non-JSON error responses
    // (HTML 502 from a load balancer, plain-text gateway timeouts)
    // would otherwise throw `SyntaxError: Unexpected token '<'`
    // and the user-facing toast would read "Unexpected token..."
    // instead of "Request failed (502)". `describeError` lifts the
    // ApiError shape's status into a friendlier default.
    const text = await res.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: text.slice(0, 200) };
      }
    }
    if (!res.ok) throw new ApiError(res.status, body);
    return body as T;
  }

  // ─── Trips ──────────────────────────────────────────────

  listTrips(): Promise<TripSummary[]> {
    return this.request("/trips");
  }

  getTrip(tripId: string): Promise<Trip> {
    return this.request(`/trips/${tripId}`);
  }

  createTrip(input: CreateTripInput): Promise<Trip> {
    return this.request("/trips", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  updateTrip(tripId: string, input: UpdateTripInput): Promise<Trip> {
    return this.request(`/trips/${tripId}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  deleteTrip(tripId: string): Promise<void> {
    return this.request(`/trips/${tripId}`, { method: "DELETE" });
  }

  importXlsxTrip(input: XlsxImportRequest): Promise<XlsxImportResponse> {
    return this.request("/trips/import-xlsx", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  // ─── Days ───────────────────────────────────────────────

  listDays(tripId: string): Promise<TripDay[]> {
    return this.request(`/trips/${tripId}/days`);
  }

  updateDay(
    tripId: string,
    date: string,
    input: { city?: string },
  ): Promise<TripDay> {
    return this.request(`/trips/${tripId}/days/${date}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  // ─── Segments ───────────────────────────────────────────

  listSegments(
    tripId: string,
    filters?: { type?: string; needs_review?: boolean },
  ): Promise<(Segment & { date: string })[]> {
    const params = new URLSearchParams();
    if (filters?.type) params.set("type", filters.type);
    if (filters?.needs_review) params.set("needs_review", "true");
    const qs = params.toString();
    return this.request(`/trips/${tripId}/segments${qs ? `?${qs}` : ""}`);
  }

  createSegment(
    tripId: string,
    date: string,
    input: CreateSegmentInput,
  ): Promise<Segment> {
    return this.request(`/trips/${tripId}/segments`, {
      method: "POST",
      body: JSON.stringify({ date, ...input }),
    });
  }

  updateSegment(
    tripId: string,
    segmentId: string,
    input: Partial<Segment>,
  ): Promise<Segment> {
    return this.request(`/trips/${tripId}/segments/${segmentId}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  deleteSegment(tripId: string, segmentId: string): Promise<void> {
    return this.request(`/trips/${tripId}/segments/${segmentId}`, {
      method: "DELETE",
    });
  }

  confirmSegment(tripId: string, segmentId: string): Promise<Segment> {
    return this.request(`/trips/${tripId}/segments/${segmentId}/confirm`, {
      method: "POST",
    });
  }

  confirmAllSegments(tripId: string): Promise<{ confirmed: number }> {
    return this.request(`/trips/${tripId}/segments/confirm-all`, {
      method: "POST",
    });
  }

  // ─── Costs ──────────────────────────────────────────────

  getCostSummary(tripId: string): Promise<CostSummaryResponse> {
    return this.request(`/trips/${tripId}/costs`);
  }

  // ─── Todos ──────────────────────────────────────────────

  listTodos(tripId: string): Promise<Todo[]> {
    return this.request(`/trips/${tripId}/todos`);
  }

  createTodo(tripId: string, input: CreateTodoInput): Promise<Todo> {
    return this.request(`/trips/${tripId}/todos`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  updateTodo(
    tripId: string,
    todoId: string,
    input: UpdateTodoInput,
  ): Promise<Todo> {
    return this.request(`/trips/${tripId}/todos/${todoId}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  deleteTodo(tripId: string, todoId: string): Promise<void> {
    return this.request(`/trips/${tripId}/todos/${todoId}`, {
      method: "DELETE",
    });
  }

  // ─── Shares ─────────────────────────────────────────────

  listShares(tripId: string): Promise<TripShare[]> {
    return this.request(`/trips/${tripId}/shares`);
  }

  createShare(tripId: string, input: CreateShareInput): Promise<TripShare> {
    return this.request(`/trips/${tripId}/share`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  deleteShare(tripId: string, shareId: string): Promise<void> {
    return this.request(`/trips/${tripId}/shares/${shareId}`, {
      method: "DELETE",
    });
  }

  // ─── Auto-Share Rules ──────────────────────────────────

  listShareRules(): Promise<TripShareRule[]> {
    return this.request("/share-rules");
  }

  createShareRule(
    input: CreateShareRuleInput,
  ): Promise<{ rule: TripShareRule; spawnedShareCount: number; upgradedShareCount: number }> {
    return this.request("/share-rules", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  updateShareRule(
    ruleId: string,
    input: UpdateShareRuleInput,
  ): Promise<{ rule: TripShareRule; updatedShareCount: number }> {
    return this.request(`/share-rules/${ruleId}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }

  deleteShareRule(
    ruleId: string,
    opts: { cascade: boolean },
  ): Promise<{ revokedShareCount: number }> {
    return this.request(
      `/share-rules/${ruleId}?cascade=${opts.cascade ? "true" : "false"}`,
      { method: "DELETE" },
    );
  }

  // ─── Shared (public) ───────────────────────────────────

  getSharedTrip(token: string): Promise<SharedTripResponse> {
    return this.request(`/shared/${token}`);
  }

  // ─── Push Notifications ────────────────────────────────

  getPushConfig(): Promise<PushConfigResponse> {
    return this.request("/push/config");
  }

  getPushStatus(endpoint?: string): Promise<PushStatusResponse> {
    const qs = endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : "";
    return this.request(`/push/status${qs}`);
  }

  subscribePush(input: {
    subscription: PushSubscriptionInput;
    userAgent?: string;
  }): Promise<{ ok: true }> {
    return this.request("/push/subscribe", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  unsubscribePush(endpoint: string): Promise<void> {
    return this.request("/push/unsubscribe", {
      method: "POST",
      body: JSON.stringify({ endpoint }),
    });
  }

  // ─── Calendar Sync ──────────────────────────────────────

  listCalendars(
    provider?: "google" | "microsoft",
  ): Promise<Array<{ id: string; summary: string; primary: boolean }>> {
    const qs = provider ? `?provider=${provider}` : "";
    return this.request(`/trips/calendar/list${qs}`);
  }

  syncCalendar(
    tripId: string,
    calendarId?: string,
    provider?: "google" | "microsoft",
  ): Promise<{ created: number; updated: number; failed: number; calendarId: string }> {
    const params = new URLSearchParams();
    if (calendarId) params.set("calendarId", calendarId);
    if (provider) params.set("provider", provider);
    const qs = params.size ? `?${params}` : "";
    return this.request(`/trips/${tripId}/calendar/sync${qs}`, { method: "POST" });
  }

  syncSegment(
    tripId: string,
    segmentId: string,
    calendarId?: string,
    provider?: "google" | "microsoft",
  ): Promise<{ created: number; updated: number; failed: number; eventId?: string }> {
    const params = new URLSearchParams();
    if (calendarId) params.set("calendarId", calendarId);
    if (provider) params.set("provider", provider);
    const qs = params.size ? `?${params}` : "";
    return this.request(`/trips/${tripId}/segments/${segmentId}/calendar/sync${qs}`, { method: "POST" });
  }

  unsyncCalendar(
    tripId: string,
    opts?: { calendarId?: string; deleteEvents?: boolean; provider?: "google" | "microsoft" },
  ): Promise<{ removed: number; failed: number }> {
    const params = new URLSearchParams();
    if (opts?.calendarId) params.set("calendarId", opts.calendarId);
    if (opts?.deleteEvents === false) params.set("deleteEvents", "false");
    if (opts?.provider) params.set("provider", opts.provider);
    const qs = params.size ? `?${params}` : "";
    return this.request(`/trips/${tripId}/calendar/sync${qs}`, { method: "DELETE" });
  }

  // ─── Export ─────────────────────────────────────────────

  async exportMarkdown(
    tripId: string,
    exclude?: string[],
  ): Promise<string> {
    const qs = exclude?.length ? `?exclude=${exclude.join(",")}` : "";
    const res = await fetch(
      `${this.baseUrl}/trips/${tripId}/export/markdown${qs}`,
    );
    if (!res.ok) {
      const body = await res.json();
      throw new ApiError(res.status, body);
    }
    return res.text();
  }

  // ─── Email Scanning ─────────────────────────────────────

  getGmailLabels(provider?: "google" | "microsoft"): Promise<GmailLabel[]> {
    const qs = provider ? `?provider=${provider}` : "";
    return this.request(`/emails/labels${qs}`);
  }

  /**
   * Lists the current user's active OAuth connections — the per-
   * capability links written by the Phase 4c Connect flows.
   * `identity` rows confirm sign-in via a provider; `email` /
   * `calendar` rows back the feature-gating decisions in the UI
   * (e.g. "should we offer the email-scan button at all?").
   */
  listConnections(): Promise<{
    connections: Array<{
      id: string;
      provider: "google" | "microsoft";
      capability: "identity" | "email" | "calendar";
      accountEmail: string;
      scopes: string[];
      status: "active" | "revoked";
      expiresAt: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
  }> {
    return this.request("/connections");
  }

  getPendingEmails(): Promise<{ results: EmailScanResult[] }> {
    return this.request("/emails/pending");
  }

  scanEmails(input?: EmailScanRequest): Promise<{ results: EmailScanResult[]; pendingCount?: number; newCount?: number; message?: string }> {
    return this.request("/emails/scan", {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    });
  }

  /**
   * Streaming variant of `scanEmails`. The server pushes Server-Sent
   * Events as it works through the mailbox so the UI can render
   * progress. Callbacks fire on:
   *   - `onFound(total)`            — once the mailbox listing returns.
   *   - `onPlan(newCount, pending)` — after dedup against the
   *                                   already-processed set.
   *   - `onProgress(parsed, total,  — emitted before each Claude
   *                 subject, from)`   parse so the spinner can advance.
   *
   * Resolves with the same shape as the non-streaming `/emails/scan`
   * endpoint once the server emits the terminal `done` event.
   * Rejects with `ApiError(status, body)` if the server emits an
   * `error` event (matches the JSON endpoint's failure semantics —
   * `body.results` may be populated with partial parses on 402/503).
   *
   * Aborting the AbortSignal closes the stream; the server detects
   * the disconnect and stops processing further emails on the next
   * iteration.
   */
  async streamScanEmails(
    input: EmailScanRequest | undefined,
    callbacks: {
      onFound?: (total: number) => void;
      onPlan?: (newCount: number, pendingCount: number) => void;
      onProgress?: (parsed: number, total: number, current?: { subject: string; from: string }) => void;
    },
    signal?: AbortSignal,
  ): Promise<{ results: EmailScanResult[]; pendingCount?: number; newCount?: number; message?: string }> {
    const token = this.getAccessToken?.();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${this.baseUrl}/emails/scan/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify(input ?? {}),
      signal,
    });

    // Non-2xx responses (validation 400, missing-auth 401, etc.) come
    // back as JSON, not SSE — the server returns those before opening
    // the stream. Surface them as the existing ApiError so call sites
    // can branch on `err.status` / `err.body.code` the same way they
    // do for the JSON endpoint.
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body);
    }
    if (!res.body) {
      throw new ApiError(500, { error: "Stream not supported by runtime" });
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalPayload:
      | { results: EmailScanResult[]; pendingCount?: number; newCount?: number; message?: string }
      | undefined;
    let errorPayload: { status?: number; [k: string]: unknown } | undefined;

    const handleFrame = (frame: string) => {
      let event = "message";
      let data = "";
      for (const line of frame.split("\n")) {
        // Comment lines (`: ping` heartbeats) are ignored per SSE spec.
        if (line.startsWith(":") || line.length === 0) continue;
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += (data ? "\n" : "") + line.slice(6);
      }
      if (!data) return;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(data);
      } catch {
        return;
      }
      switch (event) {
        case "found":
          callbacks.onFound?.(payload.total as number);
          break;
        case "plan":
          callbacks.onPlan?.(payload.newCount as number, payload.pendingCount as number);
          break;
        case "progress":
          callbacks.onProgress?.(
            payload.parsed as number,
            payload.total as number,
            payload.subject !== undefined
              ? { subject: payload.subject as string, from: payload.from as string }
              : undefined,
          );
          break;
        case "done":
          finalPayload = payload as typeof finalPayload;
          break;
        case "error":
          errorPayload = payload as typeof errorPayload;
          break;
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      if (done) break;
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        handleFrame(frame);
      }
      if (errorPayload || finalPayload) {
        // Server signalled terminal state — stop reading. The server
        // will close the stream after writing the terminal event.
        break;
      }
    }

    if (errorPayload) {
      const status = typeof errorPayload.status === "number" ? errorPayload.status : 500;
      // Strip `status` from the body so call sites see the same shape
      // as the JSON endpoint (which doesn't include status in the body).
      const { status: _status, ...body } = errorPayload;
      throw new ApiError(status, body);
    }
    if (!finalPayload) {
      throw new ApiError(500, { error: "Stream ended without a result" });
    }
    return finalPayload;
  }

  importHtmlEmail(input: HtmlImportRequest): Promise<{ result: EmailScanResult }> {
    return this.request("/emails/import-html", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  /**
   * POST a PWA share-target intent (title/text/url) to the server,
   * which feeds it through the same parser as Gmail-scanned emails
   * and returns a single EmailScanResult ready for the review UI.
   */
  importSharedContent(
    input: ImportSharedRequest,
  ): Promise<{ result: EmailScanResult }> {
    return this.request("/emails/import-shared", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  applyParsedSegments(
    input: ApplyParsedSegmentsInput,
  ): Promise<{
    created: Array<{ tripId: string; segmentId: string; title: string }>;
    updated?: Array<{ tripId: string; segmentId: string; title: string; action: "merge" | "replace" }>;
  }> {
    return this.request("/emails/apply", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  getProcessedEmails(): Promise<Array<{
    gmailMessageId: string;
    subject?: string;
    fromAddress?: string;
    parseStatus: string;
    createdAt: string;
  }>> {
    return this.request("/emails/processed");
  }

  dismissEmail(emailId: string): Promise<{ status: string }> {
    return this.request(`/emails/dismiss/${emailId}`, {
      method: "POST",
    });
  }

  // ─── Export ─────────────────────────────────────────────

  async exportOneNote(
    tripId: string,
    exclude?: string[],
  ): Promise<string> {
    const qs = exclude?.length ? `?exclude=${exclude.join(",")}` : "";
    const res = await fetch(
      `${this.baseUrl}/trips/${tripId}/export/onenote${qs}`,
    );
    if (!res.ok) {
      const body = await res.json();
      throw new ApiError(res.status, body);
    }
    return res.text();
  }

  async exportIcal(tripId: string): Promise<Blob> {
    const token = this.getAccessToken?.();
    const authHeaders: Record<string, string> = token
      ? { Authorization: `Bearer ${token}` }
      : {};
    const res = await fetch(
      `${this.baseUrl}/trips/${tripId}/export/ical`,
      { headers: authHeaders },
    );
    if (!res.ok) {
      const body = await res.json();
      throw new ApiError(res.status, body);
    }
    return res.blob();
  }

  async exportPdf(tripId: string, exclude?: string[]): Promise<Blob> {
    const qs = exclude?.length ? `?exclude=${exclude.join(",")}` : "";
    const token = this.getAccessToken?.();
    const authHeaders: Record<string, string> = token
      ? { Authorization: `Bearer ${token}` }
      : {};
    const res = await fetch(
      `${this.baseUrl}/trips/${tripId}/export/pdf${qs}`,
      { headers: authHeaders },
    );
    if (!res.ok) {
      const body = await res.json();
      throw new ApiError(res.status, body);
    }
    return res.blob();
  }
}
