"use client";

import { useState, useEffect } from "react";
import { useUpdateTodo, useDeleteTodo } from "@travel-app/api-client";
import type { Todo, TodoCategory } from "@travel-app/shared";
import { toast } from "sonner";
import { describeError } from "@/lib/api-error";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2 } from "lucide-react";
import { MarkdownText } from "@/components/markdown-text";

const TODO_CATEGORIES: { value: TodoCategory; label: string }[] = [
  { value: "meals", label: "Meals" },
  { value: "activities", label: "Activities" },
  { value: "research", label: "Research" },
  { value: "logistics", label: "Logistics" },
];

const NO_CATEGORY = "__none__";

export function EditTodoDialog({
  tripId,
  todo,
  open,
  onOpenChange,
}: {
  tripId: string;
  todo: Todo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [text, setText] = useState(todo.text);
  const [details, setDetails] = useState(todo.details ?? "");
  const [category, setCategory] = useState<string>(todo.category ?? NO_CATEGORY);

  const updateTodo = useUpdateTodo(tripId);
  const deleteTodo = useDeleteTodo(tripId);

  // Re-seed local state whenever the dialog opens against a (possibly
  // different) todo, so cancelling and re-opening a different row doesn't
  // leak the previous draft.
  useEffect(() => {
    if (open) {
      setText(todo.text);
      setDetails(todo.details ?? "");
      setCategory(todo.category ?? NO_CATEGORY);
    }
  }, [open, todo]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;

    updateTodo.mutate(
      {
        todoId: todo.id,
        text: trimmed,
        // Empty string clears notes server-side.
        details: details.trim() ? details : "",
        category:
          category === NO_CATEGORY ? undefined : (category as TodoCategory),
      },
      {
        onError: (err) => {
          toast.error("Couldn't save to-do", {
            description: describeError(err),
          });
        },
      },
    );
    onOpenChange(false);
  };

  const handleDelete = () => {
    if (!confirm(`Delete "${todo.text}"?`)) return;
    deleteTodo.mutate(todo.id, {
      onError: (err) => {
        toast.error("Couldn't delete to-do", {
          description: describeError(err),
        });
      },
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit to-do</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="todo-text">Task</Label>
            <Input
              id="todo-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="todo-category">Tag</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="todo-category">
                <SelectValue placeholder="No tag" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CATEGORY}>No tag</SelectItem>
                {TODO_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="todo-details">Notes</Label>
            <Textarea
              id="todo-details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Add details, links, or context. Markdown is supported — try [link text](https://example.com) or paste a URL."
              rows={5}
            />
            {details.trim() && (
              <div className="rounded-md border border-dashed bg-muted/40 px-3 py-2">
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Preview
                </div>
                <MarkdownText className="text-sm">{details}</MarkdownText>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleDelete}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!text.trim()}>
                Save
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
