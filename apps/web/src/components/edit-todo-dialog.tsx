"use client";

import { useState, useEffect } from "react";
import { useUpdateTodo, useDeleteTodo } from "@itinly/api-client";
import type { Todo, TodoCategory } from "@itinly/shared";
import { toastMutationError } from "@/lib/api-error";
import { useConfirm } from "@/lib/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
}): React.JSX.Element {
  const [text, setText] = useState(todo.text);
  const [details, setDetails] = useState(todo.details ?? "");
  const [category, setCategory] = useState<string>(todo.category ?? NO_CATEGORY);

  const confirm = useConfirm();
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
        // Empty string clears notes server-side; trim to drop accidental
        // leading/trailing whitespace from paste-and-edit.
        details: details.trim(),
        category:
          category === NO_CATEGORY ? undefined : (category as TodoCategory),
      },
      {
        onError: toastMutationError("save to-do"),
      },
    );
    onOpenChange(false);
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: `Delete "${todo.text}"?`,
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;
    deleteTodo.mutate(todo.id, {
      onError: toastMutationError("delete to-do"),
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle>Edit to-do</DialogTitle>
          <DialogDescription>
            Update or delete this to-do item.
          </DialogDescription>
        </DialogHeader>
        {/* Three-region layout (header / scrollable body / pinned footer)
            so Save / Cancel / Delete stay visible on short viewports. */}
        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* `px-1` (not `pr-1`) so the focus ring on the Task input —
              and any other focused control in the scroll area — has 4px
              of breathing room on the LEFT too. With right-only padding,
              `overflow-y-auto` clipped the ring's left edge against the
              container border. */}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
            <div className="space-y-1.5">
              <Label htmlFor="todo-text">To-do</Label>
              <Input
                id="todo-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoFocus
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="todo-category">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="todo-category">
                  <SelectValue placeholder="No category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CATEGORY}>No category</SelectItem>
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
                // Ctrl/Cmd + Enter submits the form. Plain Enter is left
                // alone so the user can still type multi-line notes.
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              {details.trim() && (
                <div className="rounded-md border border-dashed bg-muted/40 px-3 py-2">
                  <div className="mb-1 text-kicker text-muted-foreground">
                    Preview
                  </div>
                  <MarkdownText className="text-sm">{details}</MarkdownText>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 flex shrink-0 items-center justify-between gap-2 border-t pt-3">
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
