"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useShareRules,
  useCreateShareRule,
  useDeleteShareRule,
  useUpdateShareRule,
} from "@travel-app/api-client";
import type { TripShareRule } from "@travel-app/shared";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { describeError } from "@/lib/api-error";
import { cn } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function permissionLabel(p: TripShareRule["permission"]): string {
  return p === "edit" ? "Can edit" : "View only";
}

function PermissionRadio({
  value,
  current,
  onChange,
  icon: Icon,
  label,
  description,
}: {
  value: TripShareRule["permission"];
  current: TripShareRule["permission"];
  onChange: (next: TripShareRule["permission"]) => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      aria-pressed={active}
      className={cn(
        "flex flex-1 flex-col gap-1 rounded-lg border p-3 text-left transition-colors",
        active
          ? "border-foreground bg-muted"
          : "border-border bg-background hover:bg-muted/40",
      )}
    >
      <span className="inline-flex items-center gap-1.5 text-sm font-medium">
        <Icon className="h-4 w-4" />
        {label}
      </span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </button>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2.5">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 shrink-0 accent-foreground"
      />
    </label>
  );
}

function CreateRuleDialog({
  open,
  onOpenChange,
  initialEmail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialEmail?: string;
}) {
  const createRule = useCreateShareRule();
  const [email, setEmail] = useState(initialEmail ?? "");
  const [permission, setPermission] = useState<TripShareRule["permission"]>("view");
  const [showCosts, setShowCosts] = useState(false);
  const [showTodos, setShowTodos] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pick up a fresh `initialEmail` whenever the dialog re-opens (the user may
  // open Auto-share from the Share dialog with a different recipient typed).
  useEffect(() => {
    if (open && initialEmail !== undefined) {
      setEmail(initialEmail);
    }
  }, [open, initialEmail]);

  const trimmed = email.trim();
  const emailValid = EMAIL_RE.test(trimmed);

  const reset = () => {
    setEmail("");
    setPermission("view");
    setShowCosts(false);
    setShowTodos(false);
    setError(null);
  };

  const handleCreate = () => {
    setError(null);
    if (!emailValid) {
      setError("Enter a valid email address.");
      return;
    }
    createRule.mutate(
      {
        sharedWithEmail: trimmed,
        permission,
        showCosts,
        showTodos,
      },
      {
        onSuccess: ({ spawnedShareCount, upgradedShareCount }) => {
          const total = spawnedShareCount + upgradedShareCount;
          toast.success("Auto-share enabled", {
            description:
              total === 0
                ? `${trimmed} will be shared on every new trip.`
                : `Shared with ${total} existing trip${total === 1 ? "" : "s"}.`,
          });
          reset();
          onOpenChange(false);
        },
        onError: (err) => {
          setError(describeError(err));
          toast.error("Couldn't create auto-share rule", {
            description: describeError(err),
          });
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Auto-share with someone</DialogTitle>
          <DialogDescription>
            Every trip you have, plus every trip you create from now on, will
            be shared with this person.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="rule-email">Email</Label>
            <Input
              id="rule-email"
              type="email"
              placeholder="friend@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div className="flex gap-2">
            <PermissionRadio
              value="view"
              current={permission}
              onChange={setPermission}
              icon={Eye}
              label="View only"
              description="Read the itinerary"
            />
            <PermissionRadio
              value="edit"
              current={permission}
              onChange={setPermission}
              icon={Pencil}
              label="Can edit"
              description="Add and edit segments"
            />
          </div>

          <ToggleRow
            label="Show costs"
            description="Surface segment cost details to this person."
            checked={showCosts}
            onChange={setShowCosts}
          />
          <ToggleRow
            label="Show to-dos"
            description="Surface the trip's to-do list."
            checked={showTodos}
            onChange={setShowTodos}
          />

          {error && (
            <p className="text-sm" style={{ color: "var(--status-danger-fg)" }}>
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={createRule.isPending}>
            {createRule.isPending ? "Creating…" : "Auto-share"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteRuleDialog({
  rule,
  onClose,
}: {
  rule: TripShareRule | null;
  onClose: () => void;
}) {
  const deleteRule = useDeleteShareRule();
  const handle = (cascade: boolean) => {
    if (!rule) return;
    deleteRule.mutate(
      { ruleId: rule.id, cascade },
      {
        onSuccess: ({ revokedShareCount }) => {
          toast.success(
            cascade
              ? `Stopped auto-sharing with ${rule.sharedWithEmail}`
              : `Auto-share rule removed`,
            cascade && revokedShareCount > 0
              ? {
                  description: `Revoked access on ${revokedShareCount} trip${revokedShareCount === 1 ? "" : "s"}.`,
                }
              : undefined,
          );
          onClose();
        },
        onError: (err) => {
          toast.error("Couldn't remove auto-share rule", {
            description: describeError(err),
          });
        },
      },
    );
  };

  return (
    <Dialog open={rule !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Stop auto-sharing with {rule?.sharedWithEmail}?</DialogTitle>
          <DialogDescription>
            New trips you create won&apos;t be shared. Choose what to do with
            existing trips already shared by this rule.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:flex-col">
          <Button
            variant="outline"
            onClick={() => handle(false)}
            disabled={deleteRule.isPending}
          >
            {deleteRule.isPending ? "Removing…" : "Keep existing shares"}
          </Button>
          <Button
            variant="destructive"
            onClick={() => handle(true)}
            disabled={deleteRule.isPending}
          >
            {deleteRule.isPending ? "Removing…" : "Also revoke from existing trips"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RuleRow({
  rule,
  onDelete,
}: {
  rule: TripShareRule;
  onDelete: (rule: TripShareRule) => void;
}) {
  const updateRule = useUpdateShareRule();

  const togglePermission = () => {
    const next: TripShareRule["permission"] =
      rule.permission === "view" ? "edit" : "view";
    updateRule.mutate(
      { ruleId: rule.id, input: { permission: next } },
      {
        onError: (err) => {
          toast.error("Couldn't update auto-share rule", {
            description: describeError(err),
          });
        },
      },
    );
  };

  return (
    <li className="flex items-start gap-2 rounded-lg border bg-card px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{rule.sharedWithEmail}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {permissionLabel(rule.permission)}
          {rule.showCosts ? "" : " · No costs"}
          {rule.showTodos ? "" : " · No to-dos"}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-8"
          onClick={togglePermission}
          aria-label="Toggle permission"
        >
          {rule.permission === "edit" ? (
            <Pencil className="h-3.5 w-3.5" />
          ) : (
            <Eye className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          aria-label="Remove auto-share rule"
          onClick={() => onDelete(rule)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}

export function AutoShareRulesDialog({
  open,
  onOpenChange,
  initialEmail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * When set, the inner CreateRuleDialog auto-opens with this email
   * pre-filled. Used by the Share dialog's "Set up auto-share" CTA so
   * the user doesn't have to retype the recipient.
   */
  initialEmail?: string;
}): React.JSX.Element {
  const { data: rules } = useShareRules();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<TripShareRule | null>(null);

  // Auto-open the create form with the pre-filled email whenever the
  // outer dialog opens with an initialEmail. Only fires on transitions
  // into open so a manual "Add" click after dismissing the create form
  // still gets a blank form.
  useEffect(() => {
    if (open && initialEmail) {
      setCreateOpen(true);
    }
  }, [open, initialEmail]);

  const sortedRules = useMemo(
    () => [...(rules ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [rules],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Auto-share</DialogTitle>
          <DialogDescription>
            Auto-share every trip (existing and future) with someone.
          </DialogDescription>
        </DialogHeader>

        {sortedRules.length > 0 && (
          <ul className="space-y-2">
            {sortedRules.map((rule) => (
              <RuleRow key={rule.id} rule={rule} onDelete={setDeleting} />
            ))}
          </ul>
        )}

        <Button variant="outline" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add auto-share
        </Button>

        <CreateRuleDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          initialEmail={initialEmail}
        />
        <DeleteRuleDialog rule={deleting} onClose={() => setDeleting(null)} />
      </DialogContent>
    </Dialog>
  );
}
