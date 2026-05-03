import type {
  Trip,
  TripDay,
  Segment,
  Todo,
  TripShare,
  CostSummaryItem,
  CreateTripInput,
  UpdateTripInput,
  CreateSegmentInput,
  CreateTodoInput,
  UpdateTodoInput,
  CreateShareInput,
  PushSubscriptionInput,
  EmailScanResult,
  GmailLabel,
  ApplyParsedSegmentsInput,
  EmailScanRequest,
  HtmlImportRequest,
  XlsxImportRequest,
} from "@travel-app/shared";

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

    const body = await res.json();
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

  listCalendars(): Promise<Array<{ id: string; summary: string; primary: boolean }>> {
    return this.request("/trips/calendar/list");
  }

  syncCalendar(
    tripId: string,
    calendarId?: string,
  ): Promise<{ created: number; updated: number; failed: number; calendarId: string }> {
    const qs = calendarId ? `?calendarId=${encodeURIComponent(calendarId)}` : "";
    return this.request(`/trips/${tripId}/calendar/sync${qs}`, { method: "POST" });
  }

  syncSegment(
    tripId: string,
    segmentId: string,
    calendarId?: string,
  ): Promise<{ created: number; updated: number; failed: number; eventId?: string }> {
    const qs = calendarId ? `?calendarId=${encodeURIComponent(calendarId)}` : "";
    return this.request(`/trips/${tripId}/segments/${segmentId}/calendar/sync${qs}`, { method: "POST" });
  }

  unsyncCalendar(
    tripId: string,
    opts?: { calendarId?: string; deleteEvents?: boolean },
  ): Promise<{ removed: number; failed: number }> {
    const params = new URLSearchParams();
    if (opts?.calendarId) params.set("calendarId", opts.calendarId);
    if (opts?.deleteEvents === false) params.set("deleteEvents", "false");
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

  getGmailLabels(): Promise<GmailLabel[]> {
    return this.request("/emails/labels");
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

  importHtmlEmail(input: HtmlImportRequest): Promise<{ result: EmailScanResult }> {
    return this.request("/emails/import-html", {
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
