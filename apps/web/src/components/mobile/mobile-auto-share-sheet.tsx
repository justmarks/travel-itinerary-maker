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
import { describeError } from "@/lib/api-error";
import { MobileBottomSheet } from "./mobile-bottom-sheet";
import { Eye, Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function permissionLabel(p: TripShareRule["permission"]): string {
  return p === "edit" ? "Can edit" : "View only";
}

function PermissionPill({
  value,
  current,
  onChange,
  icon: Icon,
  label,
}: {
  value: TripShareRule["permission"];
  current: TripShareRule["permission"];
  onChange: (next: TripShareRule["permission"]) => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onChange(value)}
      aria-pressed={active}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-full border px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background text-foreground active:bg-muted/40",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
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
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border bg-background px-3 py-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 shrink-0 accent-foreground"
      />
    </label>
  );
}

function CreateForm({
  onDone,
  initialEmail,
}: {
  onDone: () => void;
  initialEmail?: string;
}) {
  const createRule = useCreateShareRule();
  const [email, setEmail] = useState(initialEmail ?? "");
  const [permission, setPermission] = useState<TripShareRule["permission"]>("view");
  const [showCosts, setShowCosts] = useState(false);
  const [showTodos, setShowTodos] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = email.trim();
  const emailValid = EMAIL_RE.test(trimmed);

  const handleCreate = () => {
    setError(null);
    if (!emailValid) {
      setError("Enter a valid email address.");
      return;
    }
    createRule.mutate(
      { sharedWithEmail: trimmed, permission, showCosts, showTodos },
      {
        onSuccess: ({ spawnedShareCount, upgradedShareCount }) => {
          const total = spawnedShareCount + upgradedShareCount;
          toast.success("Auto-share enabled", {
            description:
              total === 0
                ? `${trimmed} will be shared on every new trip.`
                : `Shared with ${total} existing trip${total === 1 ? "" : "s"}.`,
          });
          onDone();
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
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="space-y-1">
        <label htmlFor="rule-email" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Email
        </label>
        <input
          id="rule-email"
          type="email"
          inputMode="email"
          autoCapitalize="none"
          autoComplete="email"
          placeholder="friend@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="block w-full rounded-lg border bg-background px-3 py-2 text-base"
        />
      </div>
      <div className="flex gap-2">
        <PermissionPill value="view" current={permission} onChange={setPermission} icon={Eye} label="View" />
        <PermissionPill value="edit" current={permission} onChange={setPermission} icon={Pencil} label="Edit" />
      </div>
      <ToggleRow
        label="Show costs"
        description="Surface segment cost details."
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
      <button
        type="button"
        onClick={handleCreate}
        disabled={createRule.isPending}
        className="block w-full rounded-full bg-foreground px-4 py-3 text-sm font-semibold text-background active:bg-foreground/90 disabled:opacity-50"
      >
        {createRule.isPending ? "Creating…" : "Auto-share"}
      </button>
    </div>
  );
}

function RuleRow({ rule, onDelete }: { rule: TripShareRule; onDelete: (rule: TripShareRule) => void }) {
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
    <li className="flex items-start gap-2 rounded-xl border bg-card p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{rule.sharedWithEmail}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {permissionLabel(rule.permission)}
          {rule.showCosts ? "" : " · No costs"}
          {rule.showTodos ? "" : " · No to-dos"}
        </p>
      </div>
      <button
        type="button"
        onClick={togglePermission}
        aria-label="Toggle permission"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground/80 active:bg-muted/40"
      >
        {rule.permission === "edit" ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={() => onDelete(rule)}
        aria-label="Remove auto-share rule"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground active:bg-destructive/10 active:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}

function DeleteRulePanel({
  rule,
  onCancel,
}: {
  rule: TripShareRule;
  onCancel: () => void;
}) {
  const deleteRule = useDeleteShareRule();
  const handle = (cascade: boolean) => {
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
          onCancel();
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
    <div className="space-y-2 rounded-xl border bg-card p-4">
      <p className="text-sm font-medium">
        Stop auto-sharing with {rule.sharedWithEmail}?
      </p>
      <p className="text-xs text-muted-foreground">
        New trips you create won&apos;t be shared. Existing trips already shared
        by this rule:
      </p>
      <button
        type="button"
        onClick={() => handle(false)}
        disabled={deleteRule.isPending}
        className="block w-full rounded-full border bg-background px-4 py-3 text-sm font-medium active:bg-muted/40 disabled:opacity-50"
      >
        {deleteRule.isPending ? "Removing…" : "Keep existing shares"}
      </button>
      <button
        type="button"
        onClick={() => handle(true)}
        disabled={deleteRule.isPending}
        className="block w-full rounded-full bg-destructive px-4 py-3 text-sm font-semibold text-destructive-foreground active:opacity-90 disabled:opacity-50"
      >
        {deleteRule.isPending ? "Removing…" : "Also revoke from existing trips"}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={deleteRule.isPending}
        className="block w-full rounded-full px-4 py-2 text-sm text-muted-foreground disabled:opacity-50"
      >
        Cancel
      </button>
    </div>
  );
}

export function MobileAutoShareSheet({
  open,
  onClose,
  initialEmail,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * When set, the create form auto-expands with this email pre-filled.
   * Used by the mobile Share sheet's "Set up auto-share" CTA so the
   * user doesn't have to retype the recipient.
   */
  initialEmail?: string;
}): React.JSX.Element | null {
  const { data: rules = [] } = useShareRules();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<TripShareRule | null>(null);

  useEffect(() => {
    if (open && initialEmail) {
      setCreateOpen(true);
    }
  }, [open, initialEmail]);

  const sortedRules = useMemo(
    () => [...rules].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [rules],
  );

  return (
    <MobileBottomSheet open={open} onClose={onClose} ariaLabel="Auto-share">
      <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-1">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold leading-snug">Auto-share</h2>
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

      <div className="flex-1 space-y-3 overflow-y-auto px-5 pb-6">
        {deleting ? (
          <DeleteRulePanel rule={deleting} onCancel={() => setDeleting(null)} />
        ) : (
          <>
            {sortedRules.length === 0 ? (
              <p className="rounded-xl border border-dashed bg-card px-4 py-6 text-center text-sm text-muted-foreground">
                Auto-share every trip (existing and future) with someone.
              </p>
            ) : (
              <ul className="space-y-2">
                {sortedRules.map((rule) => (
                  <RuleRow key={rule.id} rule={rule} onDelete={setDeleting} />
                ))}
              </ul>
            )}

            {createOpen ? (
              <CreateForm
                onDone={() => setCreateOpen(false)}
                initialEmail={initialEmail}
              />
            ) : (
              <button
                type="button"
                onClick={() => setCreateOpen(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-full border bg-background px-4 py-3 text-sm font-medium active:bg-muted/40"
              >
                <Plus className="h-4 w-4" />
                Add auto-share
              </button>
            )}
          </>
        )}
      </div>
    </MobileBottomSheet>
  );
}
