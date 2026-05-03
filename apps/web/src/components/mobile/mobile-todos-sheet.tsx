"use client";

import { useEffect, useMemo, useState } from "react";
import type { Todo, TodoCategory } from "@travel-app/shared";
import { useUpdateTodo } from "@travel-app/api-client";
import {
  Briefcase,
  Check,
  ChevronRight,
  MapPin,
  Plus,
  Search,
  Utensils,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MobileBottomSheet } from "./mobile-bottom-sheet";
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
    accent: "text-purple-600",
  },
  research: { label: "Research", icon: Search, accent: "text-blue-600" },
  activities: {
    label: "Activities",
    icon: MapPin,
    accent: "text-green-600",
  },
  meals: { label: "Meals", icon: Utensils, accent: "text-amber-600" },
  uncategorized: {
    label: "Other",
    icon: Briefcase,
    accent: "text-muted-foreground",
  },
};

function groupByCategory(
  todos: readonly Todo[],
): Record<TodoCategory | "uncategorized", Todo[]> {
  const groups: Record<TodoCategory | "uncategorized", Todo[]> = {
    meals: [],
    activities: [],
    research: [],
    logistics: [],
    uncategorized: [],
  };
  for (const todo of todos) {
    const key = todo.category ?? "uncategorized";
    groups[key].push(todo);
  }
  for (const key of Object.keys(groups) as (keyof typeof groups)[]) {
    groups[key].sort(
      (a, b) =>
        Number(a.isCompleted) - Number(b.isCompleted) ||
        a.sortOrder - b.sortOrder,
    );
  }
  return groups;
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
          updateTodo.mutate({
            todoId: todo.id,
            isCompleted: !todo.isCompleted,
          });
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
            <span
              className={cn(
                "mt-0.5 block truncate text-xs leading-snug text-muted-foreground",
                todo.isCompleted && "line-through",
              )}
            >
              {todo.details}
            </span>
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
  open,
  onClose,
}: {
  tripId: string;
  todos: readonly Todo[];
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const groups = useMemo(() => groupByCategory(todos), [todos]);
  const [editTarget, setEditTarget] = useState<TodoFormTarget>(null);

  // If the parent closes the sheet while the form is open, close the form
  // too so we don't leave a stale dialog mounted.
  useEffect(() => {
    if (!open) setEditTarget(null);
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
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
            CATEGORY_ORDER.map((key) => {
              const items = groups[key];
              if (items.length === 0) return null;
              const meta = CATEGORY_META[key];
              const Icon = meta.icon;
              const groupCompleted = items.filter((t) => t.isCompleted).length;
              return (
                <section key={key} className="mt-3 first:mt-1">
                  <div className="flex items-center gap-2 px-2 pb-1.5 pt-1">
                    <Icon className={cn("h-3.5 w-3.5", meta.accent)} />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {meta.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground/70">
                      {groupCompleted}/{items.length}
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
            })
          )}
        </div>
      </MobileBottomSheet>

      <MobileTodoFormSheet
        tripId={tripId}
        target={editTarget}
        onClose={() => setEditTarget(null)}
      />
    </>
  );
}
