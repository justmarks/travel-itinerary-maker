"use client";

import type { Todo } from "@travel-app/shared";
import { useUpdateTodo } from "@travel-app/api-client";
import { CheckSquare2, Square } from "lucide-react";
import { cn } from "@/lib/utils";

const CATEGORY_STYLES: Record<string, string> = {
  meals:      "bg-amber-100  text-amber-700",
  activities: "bg-green-100  text-green-700",
  research:   "bg-blue-100   text-blue-700",
  logistics:  "bg-purple-100 text-purple-700",
};

export function TripTodos({ tripId, todos }: { tripId: string; todos: Todo[] }) {
  const updateTodo = useUpdateTodo(tripId);

  const sorted = [...todos].sort((a, b) => a.sortOrder - b.sortOrder);
  const completedCount = sorted.filter((t) => t.isCompleted).length;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold">To-do</h2>
        {sorted.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {completedCount}/{sorted.length}
          </span>
        )}
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tasks yet.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {sorted.map((todo) => (
            <li key={todo.id}>
              <button
                onClick={() =>
                  updateTodo.mutate({ todoId: todo.id, isCompleted: !todo.isCompleted })
                }
                className="flex w-full items-start gap-2 rounded-md px-1 py-1.5 text-left text-sm transition-colors hover:bg-muted/50"
              >
                {todo.isCompleted ? (
                  <CheckSquare2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                ) : (
                  <Square className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
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
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
