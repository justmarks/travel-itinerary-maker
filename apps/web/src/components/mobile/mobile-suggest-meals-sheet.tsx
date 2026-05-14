"use client";

import { useEffect, useMemo, useState } from "react";
import {
  suggestMealTodos,
  dedupeAgainstExistingTodos,
  type MealSuggestion,
  type Todo,
  type TripDay,
} from "@travel-app/shared";
import { useCreateTodo } from "@travel-app/api-client";
import { Loader2, Sandwich, ShoppingBag, Sparkles, Utensils, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { describeError } from "@/lib/api-error";
import { MobileBottomSheet } from "./mobile-bottom-sheet";

/**
 * Mobile counterpart to the desktop `SuggestMealsDialog`. Scans the
 * trip's days for missing lunches and dinners and lets the user
 * one-tap-add the gaps as to-dos. Renders inside a bottom sheet that
 * sits over the parent `MobileTodosSheet` while open.
 *
 * Suggestion engine, dedup against existing to-dos, and per-row
 * payload shape are all shared with desktop via
 * `@travel-app/shared`'s `suggestMealTodos` + `dedupeAgainstExistingTodos`,
 * so the two surfaces can't recommend different meals for the same
 * trip.
 */
export function MobileSuggestMealsSheet({
  tripId,
  days,
  todos,
  open,
  onClose,
}: {
  tripId: string;
  days: readonly TripDay[];
  todos: readonly Todo[];
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  // Compute suggestions once per sheet session against the current
  // trip. Re-runs only when the underlying data changes, not on each
  // toggle, so checking a row doesn't flicker the list.
  const suggestions = useMemo(() => {
    // `suggestMealTodos` takes a mutable `TripDay[]` signature even though
    // it only reads the array. Hand it a shallow copy so the page-level
    // `readonly` prop chain doesn't have to widen.
    const all = suggestMealTodos([...days]);
    return dedupeAgainstExistingTodos(
      all,
      todos.map((t) => t.text),
    );
  }, [days, todos]);

  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const createTodo = useCreateTodo(tripId);

  // Clear the per-session selection state whenever the sheet closes
  // so the next open starts from the "everything included" default.
  useEffect(() => {
    if (!open) {
      setExcluded(new Set());
      setAdding(false);
    }
  }, [open]);

  const toggle = (key: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selected = suggestions.filter((s) => !excluded.has(s.key));

  const handleAdd = async () => {
    if (selected.length === 0) return;
    setAdding(true);
    let added = 0;
    let failed = 0;
    let lastError: unknown = null;
    try {
      // Sequential adds. With N≈5–15 the perceived latency is fine and
      // React Query gets a clean invalidation per write. Per-row
      // try/catch so a single network blip doesn't lose the whole
      // batch — surviving adds stay in place and the user gets a
      // count of what failed.
      for (const s of selected) {
        try {
          await createTodo.mutateAsync({
            text: s.text,
            category: s.category,
            details: s.details,
          });
          added++;
        } catch (err) {
          failed++;
          lastError = err;
        }
      }
      if (failed > 0) {
        toast.error(`Couldn't add ${failed} to-do${failed === 1 ? "" : "s"}`, {
          description: describeError(lastError),
        });
      }
      if (added > 0) onClose();
    } finally {
      setAdding(false);
    }
  };

  // Don't let the user dismiss mid-batch — the in-flight writes would
  // still complete but the sheet would no longer be there to report
  // partial failures.
  const handleDismiss = () => {
    if (adding) return;
    onClose();
  };

  const primaryLabel = adding
    ? "Adding…"
    : `Add ${selected.length} to-do${selected.length === 1 ? "" : "s"}`;

  return (
    <MobileBottomSheet
      open={open}
      onClose={handleDismiss}
      ariaLabel="Suggest meals"
    >
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-2 pt-1">
        <div className="min-w-0 flex-1">
          <p className="text-kicker font-semibold text-muted-foreground">
            AI suggestions
          </p>
          <h2 className="mt-0.5 flex items-center gap-2 text-2xl font-bold leading-tight">
            <Sparkles className="h-5 w-5" style={{ color: "var(--brand)" }} />
            Suggest meals
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            We scan every day for missing lunches and dinners. Days where
            you&apos;re in transit during lunch get a takeaway suggestion
            instead.
          </p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Close"
          disabled={adding}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {suggestions.length === 0 ? (
          <div className="mx-2 mt-4 rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            <Utensils className="mx-auto mb-2 h-6 w-6 opacity-50" />
            All meals are planned (or already on your to-do list).
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5 px-1 pt-2">
            {suggestions.map((s) => (
              <SuggestionRow
                key={s.key}
                suggestion={s}
                excluded={excluded.has(s.key)}
                onToggle={() => toggle(s.key)}
                disabled={adding}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Footer — pinned so the primary action stays reachable on long
          suggestion lists. Safe-area padding so the button isn't
          eaten by the iOS home indicator. */}
      <div className="shrink-0 border-t bg-background px-4 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        {suggestions.length === 0 ? (
          <button
            type="button"
            onClick={handleDismiss}
            className="flex h-11 w-full items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground active:opacity-90"
          >
            Close
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDismiss}
              disabled={adding}
              className="flex h-11 flex-1 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground active:opacity-90 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={selected.length === 0 || adding}
              className="flex h-11 flex-[2] items-center justify-center gap-1.5 rounded-full bg-primary text-sm font-semibold text-primary-foreground active:opacity-90 disabled:opacity-50"
            >
              {adding && <Loader2 className="h-4 w-4 animate-spin" />}
              {primaryLabel}
            </button>
          </div>
        )}
      </div>
    </MobileBottomSheet>
  );
}

function SuggestionRow({
  suggestion,
  excluded,
  onToggle,
  disabled,
}: {
  suggestion: MealSuggestion;
  excluded: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  const Icon = suggestion.takeaway
    ? ShoppingBag
    : suggestion.meal === "lunch"
    ? Sandwich
    : Utensils;

  return (
    <li>
      <label
        className={cn(
          "flex w-full cursor-pointer items-start gap-3 rounded-xl border bg-card px-3 py-2.5 transition-colors active:bg-muted/40",
          excluded && "opacity-50",
          disabled && "pointer-events-none",
        )}
      >
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 shrink-0 rounded"
          checked={!excluded}
          onChange={onToggle}
          disabled={disabled}
        />
        <Icon
          className="mt-0.5 h-4 w-4 shrink-0"
          style={{ color: "var(--seg-dinner-fg)" }}
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm leading-snug">{suggestion.text}</div>
          {suggestion.details && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {suggestion.details}
            </div>
          )}
        </div>
      </label>
    </li>
  );
}
