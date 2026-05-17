"use client";

import { useMemo, useState } from "react";
import {
  suggestMealTodos,
  dedupeAgainstExistingTodos,
  type MealSuggestion,
  type Todo,
  type TripDay,
} from "@itinly/shared";
import { useCreateTodo } from "@itinly/api-client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, Sandwich, Utensils, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import { describeError } from "@/lib/api-error";
import { cn } from "@/lib/utils";

export function SuggestMealsDialog({
  tripId,
  days,
  todos,
  open,
  onOpenChange,
}: {
  tripId: string;
  days: TripDay[];
  todos: Todo[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  // Compute suggestions whenever the dialog opens against the current trip.
  // Memoised so re-renders during the dialog session don't flicker the list.
  const suggestions = useMemo(() => {
    const all = suggestMealTodos(days);
    return dedupeAgainstExistingTodos(
      all,
      todos.map((t) => t.text),
    );
  }, [days, todos]);

  // Per-suggestion selection — defaults to "include everything", user can
  // uncheck rows they don't want. Keyed by the suggestion's stable `key`.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const createTodo = useCreateTodo(tripId);
  const [adding, setAdding] = useState(false);

  const toggle = (key: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectedSuggestions = suggestions.filter((s) => !excluded.has(s.key));

  const handleAdd = async () => {
    if (selectedSuggestions.length === 0) return;
    setAdding(true);
    let added = 0;
    let failed = 0;
    let lastError: unknown = null;
    try {
      // Create sequentially. With N≈5–15 the latency is fine and React
      // Query gets a clean invalidation per write. Track per-row outcomes
      // so a single network blip doesn't lose the whole batch — surviving
      // adds stay in place and the user gets a count of what failed.
      for (const s of selectedSuggestions) {
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
        toast.error(
          `Couldn't add ${failed} to-do${failed === 1 ? "" : "s"}`,
          { description: describeError(lastError) },
        );
      }
      if (added > 0) {
        onOpenChange(false);
        setExcluded(new Set());
      }
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !adding) {
          onOpenChange(false);
          setExcluded(new Set());
        }
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-brand" />
            Suggest meals
          </DialogTitle>
          <DialogDescription>
            We scan every day for missing lunches and dinners. Days where
            you&apos;re in transit during lunch get a takeaway suggestion
            instead.
          </DialogDescription>
        </DialogHeader>

        {/* Three-region layout (header / scrollable body / pinned footer)
            so the action buttons stay visible on short viewports when the
            suggestion list is long. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-1">
          {suggestions.length === 0 ? (
            <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              <Utensils className="mx-auto mb-2 h-6 w-6 opacity-50" />
              All meals are planned (or already on your to-do list).
            </div>
          ) : (
            <ul className="flex flex-col gap-1">
              {suggestions.map((s) => (
                <SuggestionRow
                  key={s.key}
                  suggestion={s}
                  excluded={excluded.has(s.key)}
                  onToggle={() => toggle(s.key)}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 flex shrink-0 justify-end gap-2 border-t pt-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={adding}
          >
            {suggestions.length === 0 ? "Close" : "Cancel"}
          </Button>
          {suggestions.length > 0 && (
            <Button
              type="button"
              onClick={handleAdd}
              disabled={selectedSuggestions.length === 0 || adding}
            >
              {adding ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Adding…
                </>
              ) : (
                `Add ${selectedSuggestions.length} to-do${selectedSuggestions.length === 1 ? "" : "s"}`
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SuggestionRow({
  suggestion,
  excluded,
  onToggle,
}: {
  suggestion: MealSuggestion;
  excluded: boolean;
  onToggle: () => void;
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
          "flex w-full cursor-pointer items-start gap-3 rounded-md border px-3 py-2 transition-colors hover:bg-muted/50",
          excluded && "opacity-50",
        )}
      >
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 rounded"
          checked={!excluded}
          onChange={onToggle}
        />
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
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
