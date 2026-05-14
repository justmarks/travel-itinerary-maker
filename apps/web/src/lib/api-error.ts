import { ApiError } from "@travel-app/api-client";
import { toast } from "sonner";

/**
 * Extracts a human-readable message from a thrown error. ApiError bodies are
 * typically `{ error: string }` or `{ error: ZodIssue[] }` from validators;
 * everything else falls back to `error.message` or "Unknown error".
 */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body;
    if (body && typeof body === "object" && "error" in body) {
      const detail = (body as { error: unknown }).error;
      if (typeof detail === "string") return detail;
      if (Array.isArray(detail)) {
        const first = detail[0];
        if (first && typeof first === "object" && "message" in first) {
          return String((first as { message: unknown }).message);
        }
      }
    }
    return `Request failed (${err.status})`;
  }
  if (err instanceof Error) return err.message;
  return "Unknown error";
}

/**
 * React-Query `onError` handler that shows the canonical
 * `"Couldn't <verb>"` Sonner toast with `describeError` as the
 * description. Use this at every mutation call site so the failure
 * copy and the server-message extraction stay aligned — the CLAUDE.md
 * error-surfacing table mandates both.
 *
 *   useDeleteSegment().mutate(id, { onError: toastMutationError("delete segment") })
 */
export function toastMutationError(verb: string): (err: unknown) => void {
  return (err) => {
    toast.error(`Couldn't ${verb}`, { description: describeError(err) });
  };
}
