import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type {
  Trip,
  Segment,
  Todo,
  TripShare,
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
import { generateId } from "@travel-app/shared";
import type {
  TripSummary,
  CostSummaryResponse,
  SharedTripResponse,
} from "./client";
import { useApiClient } from "./provider";

// ─── Query Keys ───────────────────────────────────────────

export const queryKeys = {
  trips: ["trips"] as const,
  trip: (id: string) => ["trips", id] as const,
  days: (tripId: string) => ["trips", tripId, "days"] as const,
  segments: (tripId: string) => ["trips", tripId, "segments"] as const,
  costs: (tripId: string) => ["trips", tripId, "costs"] as const,
  todos: (tripId: string) => ["trips", tripId, "todos"] as const,
  shares: (tripId: string) => ["trips", tripId, "shares"] as const,
  shared: (token: string) => ["shared", token] as const,
  gmailLabels: ["gmail", "labels"] as const,
  processedEmails: ["emails", "processed"] as const,
  pushConfig: ["push", "config"] as const,
  pushStatus: (endpoint?: string) =>
    endpoint ? (["push", "status", endpoint] as const) : (["push", "status"] as const),
};

// ─── Trip Queries ─────────────────────────────────────────

export function useTrips(
  options?: Omit<UseQueryOptions<TripSummary[]>, "queryKey" | "queryFn">,
) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.trips,
    queryFn: () => client.listTrips(),
    ...options,
  });
}

export function useTrip(
  tripId: string,
  options?: Omit<UseQueryOptions<Trip>, "queryKey" | "queryFn">,
) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.trip(tripId),
    queryFn: () => client.getTrip(tripId),
    ...options,
  });
}

// ─── Trip Mutations ───────────────────────────────────────

export function useCreateTrip() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTripInput) => client.createTrip(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.trips });
    },
  });
}

export function useUpdateTrip(tripId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateTripInput) => client.updateTrip(tripId, input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.trip(tripId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.trips });
      const prevTrip = queryClient.getQueryData<Trip>(queryKeys.trip(tripId));
      const prevTrips = queryClient.getQueryData<TripSummary[]>(
        queryKeys.trips,
      );
      if (prevTrip) {
        queryClient.setQueryData<Trip>(queryKeys.trip(tripId), {
          ...prevTrip,
          ...input,
        });
      }
      if (prevTrips) {
        queryClient.setQueryData<TripSummary[]>(
          queryKeys.trips,
          prevTrips.map((t) => (t.id === tripId ? { ...t, ...input } : t)),
        );
      }
      return { prevTrip, prevTrips };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prevTrip) {
        queryClient.setQueryData(queryKeys.trip(tripId), ctx.prevTrip);
      }
      if (ctx?.prevTrips) {
        queryClient.setQueryData(queryKeys.trips, ctx.prevTrips);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.trip(tripId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.trips });
    },
  });
}

export function useDeleteTrip() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tripId: string) => client.deleteTrip(tripId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.trips });
    },
  });
}

/**
 * Mutation for importing a full trip from an XLSX workbook. On success,
 * invalidates the trips list so the new trip appears in the dashboard.
 */
export function useImportXlsxTrip() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: XlsxImportRequest) => client.importXlsxTrip(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.trips });
    },
  });
}

// ─── Day Mutations ────────────────────────────────────────

export function useUpdateDay(tripId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { date: string; city: string }) =>
      client.updateDay(tripId, input.date, { city: input.city }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.trip(tripId) });
      const prev = queryClient.getQueryData<Trip>(queryKeys.trip(tripId));
      if (prev) {
        queryClient.setQueryData<Trip>(queryKeys.trip(tripId), {
          ...prev,
          days: prev.days.map((d) =>
            d.date === input.date ? { ...d, city: input.city } : d,
          ),
        });
      }
      return { prev };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(queryKeys.trip(tripId), ctx.prev);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.trip(tripId) });
    },
  });
}

// ─── Segment Queries & Mutations ──────────────────────────

export function useSegments(
  tripId: string,
  filters?: { type?: string; needs_review?: boolean },
) {
  const client = useApiClient();
  return useQuery({
    queryKey: [...queryKeys.segments(tripId), filters],
    queryFn: () => client.listSegments(tripId, filters),
  });
}

export function useCreateSegment(tripId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { date: string } & CreateSegmentInput) => {
      const { date, ...segmentData } = input;
      return client.createSegment(tripId, date, segmentData);
    },
    onSuccess: (newSegment) => {
      // Read calendarId before invalidating so we get it from current cache
      const trip = queryClient.getQueryData<Trip>(queryKeys.trip(tripId));
      queryClient.invalidateQueries({ queryKey: queryKeys.trip(tripId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.segments(tripId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.costs(tripId) });
      if (trip?.calendarId) {
        // Sync only the newly created segment, not the entire trip
        client.syncSegment(tripId, newSegment.id, trip.calendarId).then(() => {
          queryClient.invalidateQueries({ queryKey: queryKeys.trip(tripId) });
        }).catch(() => { /* silent — user can manually refresh */ });
      }
    },
  });
}

export function useUpdateSegment(tripId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { segmentId: string } & Partial<Segment>) => {
      const { segmentId, ...data } = input;
      return client.updateSegment(tripId, segmentId, data);
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.trip(tripId) });
      const prev = queryClient.getQueryData<Trip>(queryKeys.trip(tripId));
      if (prev) {
        const { segmentId, ...patch } = input;
        queryClient.setQueryData<Trip>(queryKeys.trip(tripId), {
          ...prev,
          days: prev.days.map((d) => ({
            ...d,
            segments: d.segments.map((s) =>
              s.id === segmentId ? { ...s, ...patch } : s,
            ),
          })),
        });
      }
      return { prev };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(queryKeys.trip(tripId), ctx.prev);
      }
    },
    onSuccess: (_data, variables) => {
      // Sync only the edited segment, not the entire trip
      const trip = queryClient.getQueryData<Trip>(queryKeys.trip(tripId));
      if (trip?.calendarId) {
        client.syncSegment(tripId, variables.segmentId, trip.calendarId).then(() => {
          queryClient.invalidateQueries({ queryKey: queryKeys.trip(tripId) });
        }).catch(() => { /* silent — user can manually refresh */ });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.trip(tripId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.segments(tripId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.costs(tripId) });
    },
  });
}

export function useDeleteSegment(tripId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (segmentId: string) =>
      client.deleteSegment(tripId, segmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.trip(tripId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.segments(tripId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.costs(tripId) });
    },
  });
}

export function useConfirmSegment(tripId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  // Shared mutation key so we can ask "how many confirm-segment mutations
  // for this trip are still in flight?" in onSettled. Without it, each
  // mutation's onSettled invalidates the trip, triggering a refetch whose
  // response reflects the server *between* siblings' PATCHes — so segments
  // confirmed optimistically but not yet PATCHed get clobbered back to
  // needsReview, then flip to confirmed again when their PATCH lands.
  const mutationKey = ["confirm-segment", tripId];
  return useMutation({
    mutationKey,
    mutationFn: (segmentId: string) =>
      client.confirmSegment(tripId, segmentId),
    onMutate: async (segmentId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.trip(tripId) });
      const prev = queryClient.getQueryData<Trip>(queryKeys.trip(tripId));
      if (prev) {
        queryClient.setQueryData<Trip>(queryKeys.trip(tripId), {
          ...prev,
          days: prev.days.map((d) => ({
            ...d,
            segments: d.segments.map((s) =>
              s.id === segmentId
                ? { ...s, needsReview: false, source: "email_confirmed" }
                : s,
            ),
          })),
        });
      }
      return { prev };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(queryKeys.trip(tripId), ctx.prev);
      }
    },
    onSettled: () => {
      // Only invalidate once the last confirm in the current batch has
      // settled. isMutating returns 1 when this is the final mutation
      // still resolving (the caller is counted until onSettled finishes).
      if (queryClient.isMutating({ mutationKey }) === 1) {
        queryClient.invalidateQueries({ queryKey: queryKeys.trip(tripId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.segments(tripId) });
      }
    },
  });
}

export function useConfirmAllSegments(tripId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => client.confirmAllSegments(tripId),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: queryKeys.trip(tripId) });
      const prev = queryClient.getQueryData<Trip>(queryKeys.trip(tripId));
      if (prev) {
        queryClient.setQueryData<Trip>(queryKeys.trip(tripId), {
          ...prev,
          days: prev.days.map((d) => ({
            ...d,
            segments: d.segments.map((s) =>
              s.needsReview
                ? { ...s, needsReview: false, source: "email_confirmed" }
                : s,
            ),
          })),
        });
      }
      return { prev };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(queryKeys.trip(tripId), ctx.prev);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.trip(tripId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.segments(tripId) });
    },
  });
}

// ─── Cost Summary ─────────────────────────────────────────

export function useCostSummary(tripId: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.costs(tripId),
    queryFn: () => client.getCostSummary(tripId),
  });
}

// ─── Todo Queries & Mutations ─────────────────────────────

export function useTodos(tripId: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.todos(tripId),
    queryFn: () => client.listTodos(tripId),
  });
}

export function useCreateTodo(tripId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTodoInput) => client.createTodo(tripId, input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.todos(tripId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.trip(tripId) });
      const prevTodos = queryClient.getQueryData<Todo[]>(
        queryKeys.todos(tripId),
      );
      const prevTrip = queryClient.getQueryData<Trip>(queryKeys.trip(tripId));
      const prevTrips = queryClient.getQueryData<TripSummary[]>(
        queryKeys.trips,
      );
      const baseLength =
        prevTodos?.length ?? prevTrip?.todos.length ?? 0;
      const optimistic: Todo = {
        id: `temp_${generateId()}`,
        text: input.text,
        isCompleted: false,
        category: input.category,
        details: input.details ?? undefined,
        sortOrder: baseLength,
      };
      if (prevTodos) {
        queryClient.setQueryData<Todo[]>(queryKeys.todos(tripId), [
          ...prevTodos,
          optimistic,
        ]);
      }
      if (prevTrip) {
        queryClient.setQueryData<Trip>(queryKeys.trip(tripId), {
          ...prevTrip,
          todos: [...prevTrip.todos, optimistic],
        });
      }
      if (prevTrips) {
        queryClient.setQueryData<TripSummary[]>(
          queryKeys.trips,
          prevTrips.map((t) =>
            t.id === tripId ? { ...t, todoCount: t.todoCount + 1 } : t,
          ),
        );
      }
      return { prevTodos, prevTrip, prevTrips };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prevTodos) {
        queryClient.setQueryData(queryKeys.todos(tripId), ctx.prevTodos);
      }
      if (ctx?.prevTrip) {
        queryClient.setQueryData(queryKeys.trip(tripId), ctx.prevTrip);
      }
      if (ctx?.prevTrips) {
        queryClient.setQueryData(queryKeys.trips, ctx.prevTrips);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos(tripId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.trip(tripId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.trips });
    },
  });
}

export function useUpdateTodo(tripId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  // Shared mutation key so multiple in-flight checkbox toggles don't clobber
  // each other's optimistic state when the first PUT response lands. Same
  // pattern as useConfirmSegment.
  const mutationKey = ["update-todo", tripId];
  return useMutation({
    mutationKey,
    mutationFn: (input: { todoId: string } & UpdateTodoInput) => {
      const { todoId, ...data } = input;
      return client.updateTodo(tripId, todoId, data);
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.todos(tripId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.trip(tripId) });
      const prevTodos = queryClient.getQueryData<Todo[]>(
        queryKeys.todos(tripId),
      );
      const prevTrip = queryClient.getQueryData<Trip>(queryKeys.trip(tripId));
      const { todoId, ...rawPatch } = input;
      // UpdateTodoInput permits `null` to clear optional fields; locally we
      // normalise to `undefined` so the cached Todo type stays clean.
      const patch: Partial<Todo> = {
        ...(rawPatch.text !== undefined && { text: rawPatch.text }),
        ...(rawPatch.isCompleted !== undefined && {
          isCompleted: rawPatch.isCompleted,
        }),
        ...(rawPatch.sortOrder !== undefined && {
          sortOrder: rawPatch.sortOrder,
        }),
        ...("category" in rawPatch && {
          category: rawPatch.category ?? undefined,
        }),
        ...("details" in rawPatch && {
          details: rawPatch.details ?? undefined,
        }),
      };
      if (prevTodos) {
        queryClient.setQueryData<Todo[]>(
          queryKeys.todos(tripId),
          prevTodos.map((t) => (t.id === todoId ? { ...t, ...patch } : t)),
        );
      }
      if (prevTrip) {
        queryClient.setQueryData<Trip>(queryKeys.trip(tripId), {
          ...prevTrip,
          todos: prevTrip.todos.map((t) =>
            t.id === todoId ? { ...t, ...patch } : t,
          ),
        });
      }
      return { prevTodos, prevTrip };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prevTodos) {
        queryClient.setQueryData(queryKeys.todos(tripId), ctx.prevTodos);
      }
      if (ctx?.prevTrip) {
        queryClient.setQueryData(queryKeys.trip(tripId), ctx.prevTrip);
      }
    },
    onSettled: () => {
      // Defer the refetch until the last sibling toggle settles, otherwise
      // a refetch fired between two in-flight PUTs reflects only the first
      // change and visually undoes the second.
      if (queryClient.isMutating({ mutationKey }) === 1) {
        queryClient.invalidateQueries({ queryKey: queryKeys.todos(tripId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.trip(tripId) });
      }
    },
  });
}

export function useDeleteTodo(tripId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (todoId: string) => client.deleteTodo(tripId, todoId),
    onMutate: async (todoId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.todos(tripId) });
      await queryClient.cancelQueries({ queryKey: queryKeys.trip(tripId) });
      const prevTodos = queryClient.getQueryData<Todo[]>(
        queryKeys.todos(tripId),
      );
      const prevTrip = queryClient.getQueryData<Trip>(queryKeys.trip(tripId));
      const prevTrips = queryClient.getQueryData<TripSummary[]>(
        queryKeys.trips,
      );
      if (prevTodos) {
        queryClient.setQueryData<Todo[]>(
          queryKeys.todos(tripId),
          prevTodos.filter((t) => t.id !== todoId),
        );
      }
      if (prevTrip) {
        queryClient.setQueryData<Trip>(queryKeys.trip(tripId), {
          ...prevTrip,
          todos: prevTrip.todos.filter((t) => t.id !== todoId),
        });
      }
      if (prevTrips) {
        queryClient.setQueryData<TripSummary[]>(
          queryKeys.trips,
          prevTrips.map((t) =>
            t.id === tripId
              ? { ...t, todoCount: Math.max(0, t.todoCount - 1) }
              : t,
          ),
        );
      }
      return { prevTodos, prevTrip, prevTrips };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.prevTodos) {
        queryClient.setQueryData(queryKeys.todos(tripId), ctx.prevTodos);
      }
      if (ctx?.prevTrip) {
        queryClient.setQueryData(queryKeys.trip(tripId), ctx.prevTrip);
      }
      if (ctx?.prevTrips) {
        queryClient.setQueryData(queryKeys.trips, ctx.prevTrips);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos(tripId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.trip(tripId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.trips });
    },
  });
}

// ─── Share Queries & Mutations ────────────────────────────

export function useShares(tripId: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.shares(tripId),
    queryFn: () => client.listShares(tripId),
  });
}

export function useCreateShare(tripId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateShareInput) =>
      client.createShare(tripId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shares(tripId) });
    },
  });
}

export function useDeleteShare(tripId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  // Shared mutation key so we can ask "how many delete-share mutations
  // for this trip are still in flight?" in onSettled. Without it, each
  // sibling's onSettled invalidates the cache and triggers a refetch
  // whose response reflects the server *between* siblings' DELETEs —
  // so shares optimistically removed but not yet DELETEd on the server
  // flicker back into the list, then disappear again as their own
  // DELETE lands. Same pattern as `useConfirmSegment` above.
  const mutationKey = ["delete-share", tripId];
  return useMutation({
    mutationKey,
    mutationFn: (shareId: string) => client.deleteShare(tripId, shareId),
    // Optimistic remove from the cached shares list so the UI updates the
    // moment the user taps "revoke", even when the network round-trip is
    // slow. On error we restore the prior list and the caller can surface
    // a toast.
    onMutate: async (shareId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.shares(tripId) });
      const previous = queryClient.getQueryData<TripShare[]>(
        queryKeys.shares(tripId),
      );
      if (previous) {
        queryClient.setQueryData<TripShare[]>(
          queryKeys.shares(tripId),
          previous.filter((s) => s.id !== shareId),
        );
      }
      return { previous };
    },
    onError: (_err, _shareId, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(queryKeys.shares(tripId), ctx.previous);
      }
    },
    onSettled: () => {
      // Only invalidate once the last delete in the current batch has
      // settled. isMutating returns 1 when this is the final mutation
      // still resolving (the caller is counted until onSettled finishes).
      if (queryClient.isMutating({ mutationKey }) === 1) {
        queryClient.invalidateQueries({ queryKey: queryKeys.shares(tripId) });
      }
    },
  });
}

// ─── Shared Trip (public) ─────────────────────────────────

export function useSharedTrip(token: string) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.shared(token),
    queryFn: () => client.getSharedTrip(token),
  });
}

// ─── Push Notifications ──────────────────────────────────

export function usePushStatus(endpoint?: string, enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.pushStatus(endpoint),
    queryFn: () => client.getPushStatus(endpoint),
    enabled,
  });
}

export function useSubscribePush() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { subscription: PushSubscriptionInput; userAgent?: string }) =>
      client.subscribePush(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["push"] });
    },
  });
}

export function useUnsubscribePush() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (endpoint: string) => client.unsubscribePush(endpoint),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["push"] });
    },
  });
}

// ─── Email Scanning ──────────────────────────────────────

export function usePendingEmails(enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.processedEmails,
    queryFn: () => client.getPendingEmails(),
    enabled,
  });
}

export function useGmailLabels(enabled = true) {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.gmailLabels,
    queryFn: () => client.getGmailLabels(),
    enabled,
  });
}

export function useScanEmails() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input?: EmailScanRequest) => client.scanEmails(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.processedEmails });
    },
  });
}

export function useImportHtmlEmail() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: HtmlImportRequest) => client.importHtmlEmail(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.processedEmails });
    },
  });
}

export function useApplyParsedSegments() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ApplyParsedSegmentsInput) =>
      client.applyParsedSegments(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.trips });
      queryClient.invalidateQueries({ queryKey: queryKeys.processedEmails });
    },
  });
}

export function useProcessedEmails() {
  const client = useApiClient();
  return useQuery({
    queryKey: queryKeys.processedEmails,
    queryFn: () => client.getProcessedEmails(),
  });
}

export function useDismissEmail() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (emailId: string) => client.dismissEmail(emailId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.processedEmails });
    },
  });
}
