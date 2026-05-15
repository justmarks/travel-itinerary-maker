"use client";

import { useEffect, useMemo, useState } from "react";
import type { Todo, TodoCategory, TripDay } from "@itinly/shared";
import { useUpdateTodo } from "@itinly/api-client";
import {
  Briefcase,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  MapPin,
  Plus,
  Search,
  Sparkles,
  Utensils,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toastMutationError } from "@/lib/api-error";
import { MarkdownText } from "@/components/markdown-text";
import { MobileBottomSheet } from "./mobile-bottom-sheet";
import { MobileSuggestMealsSheet } from "./mobile-suggest-meals-sheet";
import {
  MobileTodoFormSheet,
  type TodoFormTarget,
} from "./mobile-todo-form-sheet";

const CATEGORY_ORDER: (TodoCategory | "uncategorized")[] = [
  "logistics",
  "research",
  "activities",
  "meals",
  "uncategorized",
];

const CATEGORY_META: Record<
  TodoCategory | "uncategorized",
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    accent: string;
  }
> = {
  logistics: {
    label: "Logistics",
    icon: Briefcase,
    accent: "text-[color:var(--todo-logistics-fg)]",
  },
  research: { label: "Research", icon: Search, accent: "text-[color:var(--todo-research-fg)]" },
  activities: {
    label: "Activities",
    icon: MapPin,
    accent: "text-[color:var(--todo-activities-fg)]",
  },
  meals: { label: "Meals", icon: Utensils, accent: "text-[color:var(--todo-meals-fg)]" },
  uncategorized: {
    label: "Other",
    icon: Briefcase,
    accent: "text-muted-foreground",
  },
};

function groupByCategory(
  todos: readonly Todo[],
): {
  active: Record<TodoCategory | "uncategorized", Todo[]>;
  completed: Todo[];
} {
  const active: Record<TodoCategory | "uncategorized", Todo[]> = {
    meals: [],
    activities: [],
    research: [],
    logistics: [],
    uncategorized: [],
  };
  const completed: Todo[] = [];
  for (const todo of todos) {
    if (todo.isCompleted) {
      completed.push(todo);
      continue;
    }
    const key = todo.category ?? "uncategorized";
    active[key].push(todo);
  }
  for (const key of Object.keys(active) as (keyof typeof active)[]) {
    active[key].sort((a, b) => a.sortOrder - b.sortOrder);
  }
  completed.sort((a, b) => a.sortOrder - b.sortOrder);
  return { active, completed };
}

function TodoRow({
  todo,
  tripId,
  onOpenDetails,
}: {
  todo: Todo;
  tripId: string;
  onOpenDetails: (todo: Todo) => void;
}): React.JSX.Element {
  const updateTodo = useUpdateTodo(tripId);
  return (
    <li className="flex items-start gap-1 rounded-xl px-1 py-1">
      {/* Checkbox tap target — toggles only this todo. Kept separate from
          the row body so a tap on the body opens details instead. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          updateTodo.mutate(
            {
              todoId: todo.id,
              isCompleted: !todo.isCompleted,
            },
            {
              onError: toastMutationError("update to-do"),
            },
          );
        }}
        disabled={updateTodo.isPending}
        aria-label={todo.isCompleted ? "Mark incomplete" : "Mark complete"}
        className="flex h-9 w-9 shrink-0 items-center justify-center"
      >
        <span
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded-md border-2 transition-colors",
            todo.isCompleted
              ? "border-primary bg-primary text-primary-foreground"
              : "border-muted-foreground/40 bg-background",
          )}
          aria-hidden
        >
          {todo.isCompleted && <Check className="h-3 w-3" />}
        </span>
      </button>

      {/* Body — tap opens the edit sheet. */}
      <button
        type="button"
        onClick={() => onOpenDetails(todo)}
        className="flex min-w-0 flex-1 items-start gap-2 rounded-lg py-1.5 pr-1 text-left active:bg-muted/40"
      >
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-sm leading-snug",
              todo.isCompleted &&
                "text-muted-foreground line-through decoration-muted-foreground/60",
            )}
          >
            {todo.text}
          </span>
          {todo.details && (
            // Mirrors the desktop sidebar (`trip-todos.tsx`) so markdown
            // links / bare URLs render as clickable text instead of raw
            // `[label](url)` syntax. `line-clamp-1` keeps the details to a
            // single row inside this dense list — `truncate` only works
            // on text-bearing elements, but MarkdownText wraps content in
            // a `<div>` + `<p>`, so we use line-clamp which respects
            // nested elements.
            <MarkdownText
              className={cn(
                "mt-0.5 line-clamp-1 text-xs leading-snug text-muted-foreground",
                todo.isCompleted && "line-through",
              )}
            >
              {todo.details}
            </MarkdownText>
          )}
        </span>
        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/60" />
      </button>
    </li>
  );
}

export function MobileTodosSheet({
  tripId,
  todos,
  days,
  canEdit,
  open,
  onClose,
}: {
  tripId: string;
  todos: readonly Todo[];
  /** Trip days drive the meal-suggester; omit when the caller has no
   *  edit permission and the suggest entry isn't surfaced. */
  days?: readonly TripDay[];
  /** Mirrors desktop `showSuggestButton={!isReadOnly}`. Gates the
   *  "Suggest meals" entry point — view-only collaborators see the
   *  list but not the affordance. */
  canEdit?: boolean;
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const { active: groups, completed: completedTodos } = useMemo(
    () => groupByCategory(todos),
    [todos],
  );
  const [editTarget, setEditTarget] = useState<TodoFormTarget>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  // Completed group stays collapsed by default — the whole point is that
  // checked-off items shouldn't crowd the active list. The user can
  // expand to undo a check, edit, or just review.
  const [completedExpanded, setCompletedExpanded] = useState(false);

  // If the parent closes the sheet while the form is open, close the form
  // too so we don't leave a stale dialog mounted. Also collapse the
  // Completed section so it's minimized again next time the sheet opens.
  useEffect(() => {
    if (!open) {
      setEditTarget(null);
      setSuggestOpen(false);
      setCompletedExpanded(false);
    }
  }, [open]);

  // Keep the in-flight form target in sync with the latest data — if the
  // user toggles a todo from the row and we're showing its detail form,
  // the form should reflect the new isCompleted state on next open.
  useEffect(() => {
    if (editTarget && editTarget !== "new") {
      const fresh = todos.find((t) => t.id === editTarget.id);
      if (fresh && fresh !== editTarget) setEditTarget(fresh);
    }
  }, [todos, editTarget]);

  const totalCount = todos.length;
  const completedCount = todos.filter((t) => t.isCompleted).length;

  return (
    <>
      <MobileBottomSheet open={open} onClose={onClose} ariaLabel="Trip to-dos">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-2 pt-1">
          <div className="min-w-0 flex-1">
            <p className="text-kicker font-semibold text-muted-foreground">
              To-dos
            </p>
            <h2 className="mt-0.5 text-2xl font-bold leading-tight">
              {completedCount}
              <span className="text-base font-medium text-muted-foreground">
                {" "}
                / {totalCount}
              </span>
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {canEdit && days && (
              <button
                type="button"
                onClick={() => setSuggestOpen(true)}
                aria-label="Suggest meals"
                className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
              >
                <Sparkles className="h-4 w-4 text-brand" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setEditTarget("new")}
              aria-label="Add to-do"
              className="flex h-9 items-center gap-1 rounded-full bg-primary px-3 text-xs font-semibold text-primary-foreground active:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-3 pb-6">
          {totalCount === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <p className="text-sm text-muted-foreground">
                No to-dos for this trip yet.
              </p>
              <button
                type="button"
                onClick={() => setEditTarget("new")}
                className="mt-2 inline-flex h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground active:opacity-90"
              >
                <Plus className="h-4 w-4" />
                Add the first one
              </button>
            </div>
          ) : (
            <>
              {CATEGORY_ORDER.map((key) => {
                const items = groups[key];
                if (items.length === 0) return null;
                const meta = CATEGORY_META[key];
                const Icon = meta.icon;
                return (
                  <section key={key} className="mt-3 first:mt-1">
                    <div className="flex items-center gap-2 px-2 pb-1.5 pt-1">
                      <Icon className={cn("h-3.5 w-3.5", meta.accent)} />
                      <span className="text-kicker font-semibold text-muted-foreground">
                        {meta.label}
                      </span>
                      <span className="text-[11px] text-muted-foreground/70">
                        {items.length}
                      </span>
                    </div>
                    <ul className="flex flex-col">
                      {items.map((todo) => (
                        <TodoRow
                          key={todo.id}
                          todo={todo}
                          tripId={tripId}
                          onOpenDetails={setEditTarget}
                        />
                      ))}
                    </ul>
                  </section>
                );
              })}
              {completedTodos.length > 0 && (
                <section className="mt-3 first:mt-1">
                  <button
                    type="button"
                    onClick={() => setCompletedExpanded((v) => !v)}
                    aria-expanded={completedExpanded}
                    className="flex w-full items-center gap-2 rounded-md px-2 pb-1.5 pt-1 text-left active:bg-muted/40"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-kicker font-semibold text-muted-foreground">
                      Completed
                    </span>
                    <span className="text-[11px] text-muted-foreground/70">
                      {completedTodos.length}
                    </span>
                    <ChevronDown
                      className={cn(
                        "ml-auto h-4 w-4 text-muted-foreground transition-transform",
                        completedExpanded && "rotate-180",
                      )}
                      aria-hidden
                    />
                  </button>
                  {completedExpanded && (
                    <ul className="flex flex-col">
                      {completedTodos.map((todo) => (
                        <TodoRow
                          key={todo.id}
                          todo={todo}
                          tripId={tripId}
                          onOpenDetails={setEditTarget}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </MobileBottomSheet>

      <MobileTodoFormSheet
        tripId={tripId}
        target={editTarget}
        onClose={() => setEditTarget(null)}
      />

      {canEdit && days && (
        <MobileSuggestMealsSheet
          tripId={tripId}
          days={days}
          todos={todos}
          open={suggestOpen}
          onClose={() => setSuggestOpen(false)}
        />
      )}
    </>
  );
}
