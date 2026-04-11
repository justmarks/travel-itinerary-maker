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
  EmailScanResult,
  GmailLabel,
  ApplyParsedSegmentsInput,
  EmailScanRequest,
  XlsxImportRequest,
} from "@travel-app/shared";
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
    onSuccess: () => {
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
    onSuccess: () => {
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.trip(tripId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.segments(tripId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.costs(tripId) });
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
    onSuccess: () => {
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
  return useMutation({
    mutationFn: (segmentId: string) =>
      client.confirmSegment(tripId, segmentId),
    onSuccess: () => {
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos(tripId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.trips });
    },
  });
}

export function useUpdateTodo(tripId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { todoId: string } & UpdateTodoInput) => {
      const { todoId, ...data } = input;
      return client.updateTodo(tripId, todoId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos(tripId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.trips });
    },
  });
}

export function useDeleteTodo(tripId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (todoId: string) => client.deleteTodo(tripId, todoId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.todos(tripId) });
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
  return useMutation({
    mutationFn: (shareId: string) => client.deleteShare(tripId, shareId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shares(tripId) });
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
