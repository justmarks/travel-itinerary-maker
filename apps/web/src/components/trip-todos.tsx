"use client";

import { useState } from "react";
import type { Todo, TodoCategory, TripDay } from "@travel-app/shared";
import {
  useUpdateTodo,
  useCreateTodo,
} from "@travel-app/api-client";
import { CheckSquare2, Square, Plus, X, Sparkles } from "lucide-react";
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
import { cn } from "@/lib/utils";

const CATEGORY_STYLES: Record<string, string> = {
  meals:      "bg-amber-100  text-amber-700",
  activities: "bg-green-100  text-green-700",
  research:   "bg-blue-100   text-blue-700",
  logistics:  "bg-purple-100 text-purple-700",
};

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
}) {
  const updateTodo = useUpdateTodo(tripId);
  const createTodo = useCreateTodo(tripId);

  const [showAdd, setShowAdd] = useState(false);
  const [newText, setNewText] = useState("");
  const [newCategory, setNewCategory] = useState<string>("");
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);

  const sorted = [...todos].sort((a, b) => a.sortOrder - b.sortOrder);
  const completedCount = sorted.filter((t) => t.isCompleted).length;

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) return;
    createTodo.mutate(
      {
        text: newText.trim(),
        category: (newCategory as TodoCategory) || undefined,
      },
      {
        onSuccess: () => {
          setNewText("");
          setNewCategory("");
          setShowAdd(false);
        },
      },
    );
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">To-do</h2>
        <div className="flex items-center gap-2">
          {sorted.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {completedCount}/{sorted.length}
            </span>
          )}
          {showSuggestButton && days && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => setSuggestOpen(true)}
              title="Suggest to-dos for missing meals"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              Suggest meals
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setShowAdd(!showAdd)}
            title="Add todo"
          >
            {showAdd ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="mb-3 space-y-2">
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
            <Button
              type="submit"
              size="sm"
              disabled={!newText.trim() || createTodo.isPending}
            >
              Add
            </Button>
          </div>
        </form>
      )}

      {sorted.length === 0 && !showAdd ? (
        <p className="text-sm text-muted-foreground">No tasks yet.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {sorted.map((todo) => (
            <li key={todo.id}>
              <div className="flex w-full items-start gap-2 rounded-md px-1 py-1.5 text-sm transition-colors hover:bg-muted/50">
                <button
                  onClick={() =>
                    updateTodo.mutate({
                      todoId: todo.id,
                      isCompleted: !todo.isCompleted,
                    })
                  }
                  className="mt-0.5 shrink-0"
                  title={todo.isCompleted ? "Mark incomplete" : "Mark complete"}
                >
                  {todo.isCompleted ? (
                    <CheckSquare2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <Square className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingTodoId(todo.id)}
                  className="min-w-0 flex-1 text-left"
                  title="Edit"
                >
                  <div
                    className={cn(
                      "leading-snug",
                      todo.isCompleted && "text-muted-foreground line-through",
                    )}
                  >
                    {todo.text}
                  </div>
                  {todo.details && (
                    <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                      {todo.details}
                    </div>
                  )}
                </button>
                {todo.category && (
                  <button
                    type="button"
                    onClick={() => setEditingTodoId(todo.id)}
                    className={cn(
                      "mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize transition-opacity hover:opacity-80",
                      CATEGORY_STYLES[todo.category] ?? "bg-gray-100 text-gray-700",
                    )}
                    title="Edit"
                  >
                    {todo.category}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {sorted.map((todo) => (
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
          todos={sorted}
          open={suggestOpen}
          onOpenChange={setSuggestOpen}
        />
      )}
    </div>
  );
}
