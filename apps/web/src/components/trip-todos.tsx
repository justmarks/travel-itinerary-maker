"use client";

import { useState } from "react";
import type { Todo, TodoCategory } from "@travel-app/shared";
import {
  useUpdateTodo,
  useCreateTodo,
  useDeleteTodo,
} from "@travel-app/api-client";
import { CheckSquare2, Square, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

export function TripTodos({ tripId, todos }: { tripId: string; todos: Todo[] }) {
  const updateTodo = useUpdateTodo(tripId);
  const createTodo = useCreateTodo(tripId);
  const deleteTodo = useDeleteTodo(tripId);

  const [showAdd, setShowAdd] = useState(false);
  const [newText, setNewText] = useState("");
  const [newCategory, setNewCategory] = useState<string>("");

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
            <li key={todo.id} className="group/todo">
              <div className="flex w-full items-start gap-2 rounded-md px-1 py-1.5 text-sm transition-colors hover:bg-muted/50">
                <button
                  onClick={() =>
                    updateTodo.mutate({
                      todoId: todo.id,
                      isCompleted: !todo.isCompleted,
                    })
                  }
                  className="mt-0.5 shrink-0"
                >
                  {todo.isCompleted ? (
                    <CheckSquare2 className="h-4 w-4 text-green-500" />
                  ) : (
                    <Square className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
                <span
                  className={cn(
                    "flex-1 leading-snug",
                    todo.isCompleted && "text-muted-foreground line-through",
                  )}
                >
                  {todo.text}
                </span>
                {todo.category && (
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize",
                      CATEGORY_STYLES[todo.category] ?? "bg-gray-100 text-gray-700",
                    )}
                  >
                    {todo.category}
                  </span>
                )}
                <button
                  onClick={() => deleteTodo.mutate(todo.id)}
                  className="mt-0.5 shrink-0 opacity-0 transition-opacity group-hover/todo:opacity-100"
                  title="Delete"
                  disabled={deleteTodo.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
