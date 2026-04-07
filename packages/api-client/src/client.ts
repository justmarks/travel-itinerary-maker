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
} from "@travel-app/shared";

export interface TripSummary {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  status: string;
  dayCount: number;
  todoCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CostSummaryResponse {
  items: CostSummaryItem[];
  totalsByCurrency: Record<string, number>;
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
  constructor(private baseUrl: string) {}

  private async request<T>(
    path: string,
    options?: RequestInit,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        "Content-Type": "application/json",
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
}
