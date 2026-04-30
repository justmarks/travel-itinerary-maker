"use client";

import { useMemo, useState } from "react";
import {
  useCreateShare,
  useDeleteShare,
  useShares,
} from "@travel-app/api-client";
import type { TripShare } from "@travel-app/shared";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  Pencil,
  Share2,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

function buildShareUrl(token: string): string {
  // Path form (`/shared/<token>`) so the Cloudflare Pages Edge runtime
  // can resolve the token in `generateMetadata` and produce a per-trip
  // unfurl preview. The recipient lands at /shared/<token> and the
  // in-app smart redirect bumps mobile viewports to /m/shared/<token>.
  // Carry `?demo=true` through to the recipient when the sharer is in
  // demo mode so the mock client boots and resolves the (deterministic)
  // demo token. No-op for real shares.
  const slug = encodeURIComponent(token);
  if (typeof window === "undefined") return `/shared/${slug}`;
  const isDemo =
    new URLSearchParams(window.location.search).get("demo") === "true";
  const demoSuffix = isDemo ? "?demo=true" : "";
  return `${window.location.origin}/shared/${slug}${demoSuffix}`;
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
  onRevoke,
}: {
  share: TripShare;
  onRevoke: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <li className="flex items-start gap-2 rounded-lg border bg-card px-3 py-2.5">
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

/**
 * Dialog for creating + managing trip share links.
 *
 * Two states:
 *   - "form" (default): permission picker, optional email, costs/todos
 *     toggles, and the create-link CTA. The active-shares list lives at
 *     the bottom for quick revoke + copy.
 *   - "success": after a successful create, the form is replaced with a
 *     success view that focuses on the new URL (copy + close + create
 *     another). Avoids the previous mixed UI where the form sat below
 *     the green "share link ready" box and the user couldn't tell what
 *     to do next.
 */
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

  const reset = () => {
    setPermission("view");
    setEmail("");
    setShowCosts(false);
    setShowTodos(false);
    setCreatedToken(null);
    setCreatedCopied(false);
    setError(null);
  };

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
          // Hold form values until "Create another" so the user has the
          // option to immediately copy the success URL without losing
          // their selections.
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

  const inSuccessState = createdToken !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      {/* `overflow-hidden` + `[&>*]:min-w-0` defends against children that
          contain long unbreakable strings (the share URL, recipient email)
          forcing the dialog wider than its constraints. shadcn's
          DialogContent uses a CSS grid which lets `min-content` items
          push the parent unless we explicitly clamp the children. */}
      <DialogContent className="overflow-hidden sm:max-w-md [&>*]:min-w-0">
        <DialogHeader>
          {/* pr-8 keeps the title from sliding under the absolute-positioned
              close button shadcn renders at top-4 right-4. */}
          <DialogTitle className="pr-8">Share trip</DialogTitle>
          <DialogDescription className="pr-8">
            {inSuccessState
              ? "Send this link to anyone you want to share with."
              : "Send a link so others can view — or invite a Gmail account that can edit."}
          </DialogDescription>
        </DialogHeader>

        {inSuccessState ? (
          /* ── Success state: link + copy + close + create another ── */
          <>
            <div className="rounded-lg border border-green-300 bg-green-50 p-3">
              <p className="inline-flex items-center gap-1.5 text-sm font-medium text-green-900">
                <CheckCircle2 className="h-4 w-4" />
                Share link ready
              </p>
              {/* min-w-0 on the parent flex item is critical: without it the
                  long URL forces the dialog wider than the viewport because
                  flex children default to min-content sizing. */}
              <div className="mt-2 flex min-w-0 items-center gap-2">
                <code className="min-w-0 flex-1 overflow-hidden truncate rounded bg-white px-2 py-1.5 text-xs text-green-900">
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
              {createdToken && (
                <p className="mt-2 text-xs text-green-900/80">
                  {permission === "edit"
                    ? `${trimmedEmail || "Contributor"} will need to sign in with this Gmail to edit.`
                    : "Anyone with this link can view."}
                </p>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setCreatedToken(null);
                  setCreatedCopied(false);
                  setEmail("");
                }}
              >
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Create another
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </div>
          </>
        ) : (
          /* ── Form state: pick permission, configure, create ── */
          <>
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

            {/* Email input — required for edit; optional label for view */}
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

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              onClick={handleCreate}
              disabled={!canCreate}
              className="w-full"
            >
              <Share2 className="mr-2 h-4 w-4" />
              {createShare.isPending ? "Creating…" : "Create share link"}
            </Button>
          </>
        )}

        {/* Existing shares — visible in both states so the user can manage
            previously created links without dismissing. */}
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
                  onRevoke={() => {
                    if (!window.confirm("Revoke this share link?")) return;
                    // Optimistic mutation removes the row immediately;
                    // surface a toast on success or failure (the row
                    // restores itself on error).
                    deleteShare.mutate(share.id, {
                      onSuccess: () => toast.success("Share link revoked"),
                      onError: (err) =>
                        toast.error("Couldn't revoke share link", {
                          description:
                            err instanceof Error ? err.message : undefined,
                        }),
                    });
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
