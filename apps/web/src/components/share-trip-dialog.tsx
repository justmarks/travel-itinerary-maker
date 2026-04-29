"use client";

import { useMemo, useState } from "react";
import {
  useCreateShare,
  useDeleteShare,
  useShares,
} from "@travel-app/api-client";
import type { TripShare } from "@travel-app/shared";
import {
  Button,
} from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertCircle,
  Check,
  Copy,
  Eye,
  Pencil,
  Share2,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

function buildShareUrl(token: string): string {
  if (typeof window === "undefined") return `/shared/?token=${token}`;
  // Use the same origin + basePath the rest of the app is served from. The
  // recipient lands at /shared and the in-app smart redirect bumps mobile
  // viewports to /m/shared.
  const basePath =
    process.env.NEXT_PUBLIC_BASE_PATH ??
    (process.env.NODE_ENV === "production" ? "/travel-itinerary-maker" : "");
  return `${window.location.origin}${basePath}/shared/?token=${encodeURIComponent(token)}`;
}

function permissionLabel(p: TripShare["permission"]): string {
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
  value: TripShare["permission"];
  current: TripShare["permission"];
  onChange: (next: TripShare["permission"]) => void;
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
        <span className="block text-xs text-muted-foreground">
          {description}
        </span>
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

function ExistingShareRow({
  share,
  onCopy,
  onRevoke,
}: {
  share: TripShare;
  onCopy: () => void;
  onRevoke: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <li className="flex items-start gap-3 rounded-lg border bg-card px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {share.sharedWithEmail ?? "Anyone with link"}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {permissionLabel(share.permission)}
          {share.showCosts ? "" : " · No costs"}
          {share.showTodos ? "" : " · No to-dos"}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button
          variant="ghost"
          size="icon"
          aria-label={copied ? "Link copied" : "Copy link"}
          className="h-8 w-8"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(buildShareUrl(share.shareToken));
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
              onCopy();
            } catch {
              // Clipboard refused — silent.
            }
          }}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-600" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Revoke share"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          onClick={onRevoke}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}

export function ShareTripDialog({
  tripId,
  open,
  onOpenChange,
}: {
  tripId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const { data: shares = [], isLoading } = useShares(tripId);
  const createShare = useCreateShare(tripId);
  const deleteShare = useDeleteShare(tripId);

  // Form state
  const [permission, setPermission] = useState<TripShare["permission"]>("view");
  const [email, setEmail] = useState("");
  const [showCosts, setShowCosts] = useState(false);
  const [showTodos, setShowTodos] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [createdCopied, setCreatedCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedEmail = email.trim();
  const emailValid = useMemo(() => {
    if (!trimmedEmail) return permission === "view";
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);
  }, [trimmedEmail, permission]);

  const canCreate =
    !createShare.isPending &&
    (permission === "view" || trimmedEmail.length > 0) &&
    emailValid;

  const handleCreate = () => {
    setError(null);
    setCreatedCopied(false);
    if (permission === "edit" && !trimmedEmail) {
      setError("Add the contributor's Gmail address.");
      return;
    }
    createShare.mutate(
      {
        permission,
        sharedWithEmail: trimmedEmail || undefined,
        showCosts,
        showTodos,
      },
      {
        onSuccess: (share) => {
          setCreatedToken(share.shareToken);
          setEmail("");
        },
        onError: (err) => {
          setError(err instanceof Error ? err.message : "Couldn't create share.");
        },
      },
    );
  };

  const handleCopyJustCreated = async () => {
    if (!createdToken) return;
    try {
      await navigator.clipboard.writeText(buildShareUrl(createdToken));
      setCreatedCopied(true);
      window.setTimeout(() => setCreatedCopied(false), 1500);
    } catch {
      // Clipboard refused — silent.
    }
  };

  const reset = () => {
    setPermission("view");
    setEmail("");
    setShowCosts(false);
    setShowTodos(false);
    setCreatedToken(null);
    setCreatedCopied(false);
    setError(null);
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
          <DialogTitle>Share trip</DialogTitle>
          <DialogDescription>
            Send a link so others can view — or invite a Gmail account that
            can edit.
          </DialogDescription>
        </DialogHeader>

        {/* Permission picker */}
        <div className="flex gap-2">
          <PermissionRadio
            value="view"
            current={permission}
            onChange={setPermission}
            icon={Eye}
            label="View only"
            description="Anyone with the link"
          />
          <PermissionRadio
            value="edit"
            current={permission}
            onChange={setPermission}
            icon={Pencil}
            label="Can edit"
            description="Specific Gmail"
          />
        </div>

        {/* Email input */}
        {permission === "edit" || email ? (
          <div className="space-y-1">
            <Label htmlFor="share-email" className="text-xs">
              {permission === "edit"
                ? "Contributor's Gmail address"
                : "Recipient (optional, just for your records)"}
            </Label>
            <Input
              id="share-email"
              type="email"
              placeholder="name@gmail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEmail(" ")}
            className="self-start text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            + Add recipient label (optional)
          </button>
        )}

        {/* Toggles */}
        <div className="flex flex-col gap-2">
          <ToggleRow
            label="Include costs"
            description="Show segment prices on the shared trip"
            checked={showCosts}
            onChange={setShowCosts}
          />
          <ToggleRow
            label="Include to-dos"
            description="Show the to-do checklist"
            checked={showTodos}
            onChange={setShowTodos}
          />
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Just-created link */}
        {createdToken && (
          <div className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm">
            <p className="font-medium text-green-900">Share link ready</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 text-xs text-green-900">
                {buildShareUrl(createdToken)}
              </code>
              <Button
                size="sm"
                variant="outline"
                className="h-8 shrink-0"
                onClick={handleCopyJustCreated}
              >
                {createdCopied ? (
                  <>
                    <Check className="mr-1.5 h-3.5 w-3.5 text-green-600" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                    Copy
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Create action */}
        <Button
          onClick={handleCreate}
          disabled={!canCreate}
          className="w-full"
        >
          <Share2 className="mr-2 h-4 w-4" />
          {createShare.isPending ? "Creating…" : "Create share link"}
        </Button>

        {/* Existing shares */}
        {!isLoading && shares.length > 0 && (
          <div className="border-t pt-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Active shares · {shares.length}
            </p>
            <ul className="flex flex-col gap-2">
              {shares.map((share) => (
                <ExistingShareRow
                  key={share.id}
                  share={share}
                  onCopy={() => {}}
                  onRevoke={() => {
                    if (window.confirm("Revoke this share link?")) {
                      deleteShare.mutate(share.id);
                    }
                  }}
                />
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
