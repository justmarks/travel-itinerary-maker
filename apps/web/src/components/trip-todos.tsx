"use client";

import { useState } from "react";
import type { Todo, TodoCategory, TripDay } from "@itinly/shared";
import {
  useUpdateTodo,
  useCreateTodo,
} from "@itinly/api-client";
import {
  CheckSquare2,
  ChevronDown,
  Square,
  Plus,
  X,
  Sparkles,
} from "lucide-react";
import { toastMutationError } from "@/lib/api-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EditTodoDialog } from "@/components/edit-todo-dialog";
import { SuggestMealsDialog } from "@/components/suggest-meals-dialog";
import { AppLogo } from "@/components/app-logo";
import { MarkdownText } from "@/components/markdown-text";
import { cn } from "@/lib/utils";

/**
 * Each todo-category chip uses the matching `--todo-{category}-{bg,fg}`
 * design-system token. Tokens alias to the status palette
 * (`--status-warn` for meals, `--status-ok` for activities, etc.) so a
 * palette tweak in `globals.css` propagates without component edits.
 */
function todoCategoryStyle(category: string): React.CSSProperties {
  return {
    backgroundColor: `var(--todo-${category}-bg)`,
    color: `var(--todo-${category}-fg)`,
  };
}

const TODO_CATEGORIES: { value: TodoCategory; label: string }[] = [
  { value: "meals", label: "Meals" },
  { value: "activities", label: "Activities" },
  { value: "research", label: "Research" },
  { value: "logistics", label: "Logistics" },
];

export function TripTodos({
  tripId,
  todos,
  days,
  showSuggestButton = false,
  readOnly = false,
}: {
  tripId: string;
  todos: Todo[];
  /** Required when `showSuggestButton` is true — the meal suggester reads it. */
  days?: TripDay[];
  /**
   * Show the "Suggest meals" button. Only enabled on the dedicated To-do
   * tab; the sidebar render on the Itinerary tab keeps the chrome minimal.
   */
  showSuggestButton?: boolean;
  /**
   * View-only mode for shared trips with `permission === "view"`. Hides
   * add / edit affordances and disables the checkbox toggle so a viewer
   * can read the list but not mutate it.
   */
  readOnly?: boolean;
}): React.JSX.Element {
  const updateTodo = useUpdateTodo(tripId);
  const createTodo = useCreateTodo(tripId);

  const [showAdd, setShowAdd] = useState(false);
  const [newText, setNewText] = useState("");
  const [newCategory, setNewCategory] = useState<string>("");
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  // Completed group is hidden by default — checked-off items shouldn't
  // crowd the active list. Mirrors the mobile sheet's behavior.
  const [completedExpanded, setCompletedExpanded] = useState(false);

  const activeTodos = [...todos]
    .filter((t) => !t.isCompleted)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const completedTodos = [...todos]
    .filter((t) => t.isCompleted)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const completedCount = completedTodos.length;

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) return;
    createTodo.mutate(
      {
        text: newText.trim(),
        category: (newCategory as TodoCategory) || undefined,
      },
      {
        onError: toastMutationError("add to-do"),
      },
    );
    setNewText("");
    setNewCategory("");
    setShowAdd(false);
  };

  const renderTodoRow = (todo: Todo) => (
    <li key={todo.id}>
      <div className="flex w-full items-start gap-2 rounded-md px-1 py-1.5 text-sm transition-colors hover:bg-muted/50">
        <button
          type="button"
          role="checkbox"
          aria-checked={todo.isCompleted}
          aria-label="Toggle complete"
          onClick={() => {
            if (readOnly) return;
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
          disabled={readOnly}
          className={cn(
            "mt-0.5 shrink-0",
            readOnly && "cursor-default",
          )}
          title={
            readOnly
              ? undefined
              : todo.isCompleted
                ? "Mark incomplete"
                : "Mark complete"
          }
        >
          {/* Render both icons and toggle visibility — keeps the
              <svg> nodes stable across rapid clicks instead of
              unmount/mount-ing a different Lucide component each
              time, which broke `await button.click(); await
              button.click()` chains (CLAUDE.md: "tappable in
              rapid succession"). */}
          <CheckSquare2
            className={cn(
              "h-4 w-4 text-muted-foreground",
              !todo.isCompleted && "hidden",
            )}
            aria-hidden
          />
          <Square
            className={cn(
              "h-4 w-4 text-muted-foreground",
              todo.isCompleted && "hidden",
            )}
            aria-hidden
          />
        </button>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => {
              if (readOnly) return;
              setEditingTodoId(todo.id);
            }}
            disabled={readOnly}
            className={cn(
              "w-full text-left",
              readOnly && "cursor-default",
            )}
            title={readOnly ? undefined : "Edit"}
          >
            <div
              className={cn(
                "leading-snug",
                todo.isCompleted && "text-muted-foreground line-through",
              )}
            >
              {todo.text}
            </div>
          </button>
          {todo.details && (
            <MarkdownText className="mt-0.5 text-xs text-muted-foreground">
              {todo.details}
            </MarkdownText>
          )}
        </div>
        {todo.category &&
          (readOnly ? (
            <span
              className="mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize"
              style={todoCategoryStyle(todo.category)}
            >
              {todo.category}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setEditingTodoId(todo.id)}
              className="mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize transition-opacity hover:opacity-80"
              style={todoCategoryStyle(todo.category)}
              title="Edit"
            >
              {todo.category}
            </button>
          ))}
      </div>
    </li>
  );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">To-do</h2>
        <div className="flex items-center gap-2">
          {todos.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {completedCount}/{todos.length}
            </span>
          )}
          {showSuggestButton && days && !readOnly && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => setSuggestOpen(true)}
              title="Suggest to-dos for missing meals"
            >
              <Sparkles className="h-3.5 w-3.5" style={{ color: "var(--brand)" }} />
              Suggest meals
            </Button>
          )}
          {!readOnly && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setShowAdd(!showAdd)}
              title="Add todo"
            >
              {showAdd ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            </Button>
          )}
        </div>
      </div>

      {showAdd && (
        <form
          onSubmit={handleAdd}
          // ESC anywhere inside the inline-add form closes it. The Plus
          // toggle on the header is hidden by the X icon while showAdd
          // is true, so without a keyboard escape hatch the user has
          // to mouse over to that X to bail out.
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setNewText("");
              setNewCategory("");
              setShowAdd(false);
            }
          }}
          className="mb-3 flex flex-col gap-2 rounded-md border bg-card p-3"
        >
          <Input
            placeholder="What needs to be done?"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2">
            <Select value={newCategory} onValueChange={setNewCategory}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {TODO_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" size="sm" disabled={!newText.trim()}>
              Add
            </Button>
          </div>
        </form>
      )}

      {todos.length === 0 && !showAdd ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-6 text-center">
          <AppLogo className="h-8 w-8 opacity-60" />
          <p className="text-sm text-muted-foreground">No tasks yet.</p>
        </div>
      ) : (
        <>
          {activeTodos.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {activeTodos.map(renderTodoRow)}
            </ul>
          )}
          {completedTodos.length > 0 && (
            <div className={cn(activeTodos.length > 0 && "mt-3")}>
              <button
                type="button"
                onClick={() => setCompletedExpanded((v) => !v)}
                aria-expanded={completedExpanded}
                className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-xs text-muted-foreground hover:bg-muted/50"
              >
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 transition-transform",
                    completedExpanded && "rotate-180",
                  )}
                  aria-hidden
                />
                <span className="font-medium">Completed</span>
                <span className="text-muted-foreground/70">
                  {completedTodos.length}
                </span>
              </button>
              {completedExpanded && (
                <ul className="mt-0.5 flex flex-col gap-0.5">
                  {completedTodos.map(renderTodoRow)}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      {todos.map((todo) => (
        <EditTodoDialog
          key={todo.id}
          tripId={tripId}
          todo={todo}
          open={editingTodoId === todo.id}
          onOpenChange={(open) =>
            setEditingTodoId(open ? todo.id : null)
          }
        />
      ))}

      {showSuggestButton && days && (
        <SuggestMealsDialog
          tripId={tripId}
          days={days}
          todos={todos}
          open={suggestOpen}
          onOpenChange={setSuggestOpen}
        />
      )}
    </div>
  );
}
