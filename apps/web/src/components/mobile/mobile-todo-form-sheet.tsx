"use client";

import { useEffect, useState } from "react";
import {
  useCreateTodo,
  useDeleteTodo,
  useUpdateTodo,
} from "@travel-app/api-client";
import type { Todo, TodoCategory } from "@travel-app/shared";
import { Briefcase, MapPin, Search, Trash2, Utensils, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MobileBottomSheet } from "./mobile-bottom-sheet";

const CATEGORY_OPTIONS: {
  value: TodoCategory | "";
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  iconClass?: string;
}[] = [
  { value: "", label: "None" },
  {
    value: "logistics",
    label: "Logistics",
    icon: Briefcase,
    iconClass: "text-purple-600",
  },
  {
    value: "research",
    label: "Research",
    icon: Search,
    iconClass: "text-blue-600",
  },
  {
    value: "activities",
    label: "Activities",
    icon: MapPin,
    iconClass: "text-green-600",
  },
  {
    value: "meals",
    label: "Meals",
    icon: Utensils,
    iconClass: "text-amber-600",
  },
];

export type TodoFormTarget = Todo | "new" | null;

/**
 * Bottom-sheet form for creating, editing, and deleting trip to-dos. Mirrors
 * the desktop edit-todo dialog but tuned for thumb input: large category
 * pills, a single text field, and an optional details textarea.
 *
 * `target` drives the mode:
 *   - `null`  → sheet is closed
 *   - `"new"` → "Add" mode, form starts blank
 *   - `Todo`  → "Edit" mode, form pre-populated, delete button shown
 */
export function MobileTodoFormSheet({
  tripId,
  target,
  onClose,
}: {
  tripId: string;
  target: TodoFormTarget;
  onClose: () => void;
}): React.JSX.Element {
  const createTodo = useCreateTodo(tripId);
  const updateTodo = useUpdateTodo(tripId);
  const deleteTodo = useDeleteTodo(tripId);

  const isAdd = target === "new";
  const isEdit = target !== null && target !== "new";
  const open = target !== null;

  const [text, setText] = useState("");
  const [category, setCategory] = useState<TodoCategory | "">("");
  const [details, setDetails] = useState("");

  // Sync form state with `target` whenever the sheet (re)opens.
  useEffect(() => {
    if (target === "new") {
      setText("");
      setCategory("");
      setDetails("");
    } else if (target) {
      setText(target.text);
      setCategory(target.category ?? "");
      setDetails(target.details ?? "");
    }
  }, [target]);

  const trimmed = text.trim();
  const canSave = trimmed.length > 0;
  const isPending = createTodo.isPending || updateTodo.isPending;

  const handleSave = () => {
    if (!canSave) return;
    if (isAdd) {
      createTodo.mutate(
        {
          text: trimmed,
          category: category || undefined,
          details: details.trim() || undefined,
        },
        { onSuccess: onClose },
      );
    } else if (isEdit) {
      updateTodo.mutate(
        {
          todoId: target.id,
          text: trimmed,
          category: category || undefined,
          // Empty string clears the field (route handler treats `null` and
          // `""` the same — see updateTodoSchema in shared/validators).
          details: details.trim() || null,
        },
        { onSuccess: onClose },
      );
    }
  };

  const handleDelete = () => {
    if (!isEdit) return;
    if (typeof window !== "undefined" && !window.confirm("Delete this to-do?")) {
      return;
    }
    deleteTodo.mutate(target.id, { onSuccess: onClose });
  };

  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      ariaLabel={isAdd ? "Add to-do" : "Edit to-do"}
    >
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-1">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            To-do
          </p>
          <h2 className="mt-0.5 text-lg font-semibold leading-snug">
            {isAdd ? "Add to-do" : "Edit to-do"}
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
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
        className="flex flex-1 flex-col overflow-y-auto px-5 pb-3"
      >
        <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Task
        </label>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What needs to happen?"
          autoFocus={isAdd}
          className="mt-1 h-11 w-full rounded-xl border bg-background px-3 text-base text-foreground outline-none focus:border-foreground"
        />

        <p className="mt-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Category
        </p>
        <div className="mt-1 flex flex-wrap gap-2">
          {CATEGORY_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = category === opt.value;
            return (
              <button
                key={opt.value || "none"}
                type="button"
                onClick={() => setCategory(opt.value)}
                aria-pressed={active}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-foreground",
                )}
              >
                {Icon && (
                  <Icon
                    className={cn(
                      "h-3.5 w-3.5",
                      active ? "" : opt.iconClass ?? "text-muted-foreground",
                    )}
                  />
                )}
                {opt.label}
              </button>
            );
          })}
        </div>

        <label className="mt-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Notes
        </label>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Optional details, links, references…"
          rows={4}
          className="mt-1 w-full resize-none rounded-xl border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-foreground"
        />
      </form>

      {/* Action bar */}
      <div className="flex shrink-0 items-center gap-2 border-t bg-background px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        {isEdit && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleteTodo.isPending}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-destructive hover:bg-destructive/10 disabled:opacity-50"
            aria-label="Delete to-do"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="h-11 flex-1 rounded-full border bg-background text-sm font-medium text-foreground active:bg-muted/40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave || isPending}
          className="h-11 flex-1 rounded-full bg-foreground text-sm font-semibold text-background disabled:opacity-50"
        >
          {isAdd ? "Add" : "Save"}
        </button>
      </div>
    </MobileBottomSheet>
  );
}
