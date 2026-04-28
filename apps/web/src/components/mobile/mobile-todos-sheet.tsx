"use client";

import { useMemo } from "react";
import type { Todo, TodoCategory } from "@travel-app/shared";
import { useUpdateTodo } from "@travel-app/api-client";
import { Check, Utensils, MapPin, Search, Briefcase, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MobileBottomSheet } from "./mobile-bottom-sheet";

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
  // Sort each group: incomplete first, then by sortOrder.
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
}: {
  todo: Todo;
  tripId: string;
}): React.JSX.Element {
  const updateTodo = useUpdateTodo(tripId);
  return (
    <li>
      <button
        type="button"
        onClick={() =>
          updateTodo.mutate({ todoId: todo.id, isCompleted: !todo.isCompleted })
        }
        disabled={updateTodo.isPending}
        className="flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left active:bg-muted/40"
      >
        <span
          className={cn(
            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors",
            todo.isCompleted
              ? "border-foreground bg-foreground text-background"
              : "border-muted-foreground/40 bg-background",
          )}
          aria-hidden
        >
          {todo.isCompleted && <Check className="h-3 w-3" />}
        </span>
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
                "mt-0.5 block text-xs leading-snug text-muted-foreground",
                todo.isCompleted && "line-through",
              )}
            >
              {todo.details}
            </span>
          )}
        </span>
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

  const totalCount = todos.length;
  const completedCount = todos.filter((t) => t.isCompleted).length;

  return (
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
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-3 pb-6">
        {totalCount === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No to-dos for this trip yet.
          </p>
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
                    <TodoRow key={todo.id} todo={todo} tripId={tripId} />
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </MobileBottomSheet>
  );
}
