"use client";

import { useEffect, useState } from "react";
import {
  useCreateShare,
  useDeleteShare,
  useShares,
} from "@travel-app/api-client";
import type { TripShare } from "@travel-app/shared";
import {
  AlertCircle,
  Check,
  Copy,
  Eye,
  Pencil,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MobileBottomSheet } from "./mobile-bottom-sheet";

function buildShareUrl(token: string): string {
  if (typeof window === "undefined") return `/shared/?token=${token}`;
  const basePath =
    process.env.NEXT_PUBLIC_BASE_PATH ??
    (process.env.NODE_ENV === "production" ? "/travel-itinerary-maker" : "");
  return `${window.location.origin}${basePath}/shared/?token=${encodeURIComponent(token)}`;
}

function permissionLabel(p: TripShare["permission"]): string {
  return p === "edit" ? "Can edit" : "View only";
}

function PermissionPill({
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
        "flex flex-1 flex-col gap-1 rounded-xl border p-3 text-left transition-colors",
        active
          ? "border-foreground bg-muted"
          : "border-border bg-background active:bg-muted/40",
      )}
    >
      <span className="inline-flex items-center gap-1.5 text-sm font-medium">
        <Icon className="h-4 w-4" />
        {label}
      </span>
      <span className="text-xs leading-snug text-muted-foreground">
        {description}
      </span>
    </button>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 px-1 py-2">
      <span className="text-sm font-medium">{label}</span>
      <span
        role="switch"
        aria-checked={checked}
        className={cn(
          "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-foreground" : "bg-muted-foreground/30",
        )}
      >
        <span
          className={cn(
            "absolute h-5 w-5 rounded-full bg-background transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
    </label>
  );
}

function ExistingShareRow({
  share,
  onRevoke,
  shareUrl,
  tripTitle,
}: {
  share: TripShare;
  onRevoke: () => void;
  shareUrl: string;
  tripTitle: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleResend = async () => {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: tripTitle,
          text: `${tripTitle} · ${permissionLabel(share.permission)}`,
          url: shareUrl,
        });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        // fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // silent
    }
  };

  return (
    <li className="flex items-start gap-2 rounded-xl border bg-card p-3">
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
      <button
        type="button"
        onClick={handleResend}
        aria-label={copied ? "Link copied" : "Share again"}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground/80 active:bg-muted/40"
      >
        {copied ? (
          <Check className="h-4 w-4 text-green-600" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </button>
      <button
        type="button"
        onClick={onRevoke}
        aria-label="Revoke share"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground active:bg-destructive/10 active:text-destructive"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}

/**
 * Bottom-sheet for creating + managing trip share links on mobile. The
 * "Share link" action creates the share and immediately invokes the OS
 * share sheet via `navigator.share`, so the user picks the channel
 * (Messages, Mail, AirDrop, …) — we never collect the recipient
 * ourselves for view-only shares. Edit shares require a Gmail address
 * upfront because the server gates editing on auth-email match.
 */
export function MobileShareSheet({
  tripId,
  tripTitle,
  open,
  onClose,
}: {
  tripId: string;
  tripTitle: string;
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const { data: shares = [] } = useShares(tripId);
  const createShare = useCreateShare(tripId);
  const deleteShare = useDeleteShare(tripId);

  const [permission, setPermission] = useState<TripShare["permission"]>("view");
  const [email, setEmail] = useState("");
  const [showCosts, setShowCosts] = useState(false);
  const [showTodos, setShowTodos] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form on (re)open so each pull-up starts fresh.
  useEffect(() => {
    if (!open) return;
    setPermission("view");
    setEmail("");
    setShowCosts(false);
    setShowTodos(false);
    setError(null);
  }, [open]);

  const trimmedEmail = email.trim();
  const emailValid =
    !trimmedEmail || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail);

  const handleCreate = async () => {
    setError(null);
    if (permission === "edit" && !trimmedEmail) {
      setError("Add the contributor's Gmail address.");
      return;
    }
    if (!emailValid) {
      setError("That doesn't look like a valid email.");
      return;
    }

    let createdShare;
    try {
      createdShare = await createShare.mutateAsync({
        permission,
        sharedWithEmail: trimmedEmail || undefined,
        showCosts,
        showTodos,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create share.");
      return;
    }

    const url = buildShareUrl(createdShare.shareToken);

    // Hand the URL off to the OS share sheet so the user picks the
    // delivery channel (text, mail, AirDrop, etc.). The server has
    // already created the share regardless of whether the share sheet
    // is dismissed.
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function"
    ) {
      try {
        await navigator.share({
          title: tripTitle,
          text: `${tripTitle} · ${permissionLabel(permission)}`,
          url,
        });
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          // User dismissed the share sheet — leave the share intact in
          // the active list so they can resend it later.
        }
      }
    } else {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // silent
      }
    }

    onClose();
  };

  return (
    <MobileBottomSheet open={open} onClose={onClose} ariaLabel="Share trip">
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-1">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Share trip
          </p>
          <h2 className="mt-0.5 text-lg font-semibold leading-snug">
            {tripTitle}
          </h2>
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

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 pb-3">
        <div className="flex gap-2">
          <PermissionPill
            value="view"
            current={permission}
            onChange={setPermission}
            icon={Eye}
            label="View only"
            description="Anyone with the link"
          />
          <PermissionPill
            value="edit"
            current={permission}
            onChange={setPermission}
            icon={Pencil}
            label="Can edit"
            description="Specific Gmail"
          />
        </div>

        {permission === "edit" && (
          <div className="mt-4 space-y-1">
            <label
              htmlFor="share-email"
              className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
            >
              Contributor&apos;s Gmail
            </label>
            <input
              id="share-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@gmail.com"
              autoComplete="email"
              className="h-11 w-full rounded-xl border bg-background px-3 text-base text-foreground outline-none focus:border-foreground"
            />
          </div>
        )}

        <div className="mt-4 divide-y rounded-xl border">
          <ToggleRow
            label="Include costs"
            checked={showCosts}
            onChange={setShowCosts}
          />
          <ToggleRow
            label="Include to-dos"
            checked={showTodos}
            onChange={setShowTodos}
          />
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {shares.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Active shares · {shares.length}
            </p>
            <ul className="flex flex-col gap-2">
              {shares.map((share) => (
                <ExistingShareRow
                  key={share.id}
                  share={share}
                  shareUrl={buildShareUrl(share.shareToken)}
                  tripTitle={tripTitle}
                  onRevoke={() => {
                    if (
                      typeof window !== "undefined" &&
                      window.confirm("Revoke this share link?")
                    ) {
                      deleteShare.mutate(share.id);
                    }
                  }}
                />
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="flex shrink-0 gap-2 border-t bg-background px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        <button
          type="button"
          onClick={onClose}
          className="h-11 flex-1 rounded-full border bg-background text-sm font-medium text-foreground active:bg-muted/40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleCreate}
          disabled={createShare.isPending}
          className="flex h-11 flex-[2] items-center justify-center gap-1.5 rounded-full bg-foreground text-sm font-semibold text-background disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
          {createShare.isPending ? "Creating…" : "Share link"}
        </button>
      </div>
    </MobileBottomSheet>
  );
}
