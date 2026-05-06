"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

/**
 * In-app confirmation dialog backed by ShadCN `AlertDialog`. Replaces
 * `window.confirm(...)` so destructive flows (delete trip, revoke
 * share, leave shared trip, …) get an on-brand modal instead of the
 * browser's native popup, which on mobile in particular looks foreign
 * and breaks the visual flow.
 *
 * API mirrors `window.confirm` — async returning boolean — so callsites
 * can swap `if (!confirm(...))` for `if (!(await confirm(...)))` with
 * minimal restructuring. The shape of the imperative call is:
 *
 *     const confirm = useConfirm();
 *     if (!(await confirm({
 *       title: "Revoke this share link?",
 *       description: "Anyone using the old link will lose access.",
 *       confirmText: "Revoke",
 *       destructive: true,
 *     }))) return;
 *
 * Mounted once near the top of the component tree (in
 * `app/providers.tsx`) so a single dialog instance handles every call,
 * regardless of which route triggered it. Concurrent calls to
 * `confirm()` are unsupported — the second resolves to `false`
 * immediately while the first one is still open.
 */

export interface ConfirmOptions {
  /** Required. The bold prompt question. */
  title: string;
  /** Optional supporting copy under the title. */
  description?: string;
  /** Defaults to "Confirm". */
  confirmText?: string;
  /** Defaults to "Cancel". */
  cancelText?: string;
  /**
   * When true, the confirm button uses the destructive (red) styling.
   * Use for delete / revoke / leave actions.
   */
  destructive?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) {
    throw new Error(
      "useConfirm() must be used inside <ConfirmDialogProvider>",
    );
  }
  return fn;
}

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

export function ConfirmDialogProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      // If a previous confirm is still mounted (concurrent calls),
      // reject the new one immediately rather than queue. Real callers
      // shouldn't hit this — destructive flows are sequenced — but it
      // keeps a misuse from silently swallowing the second call.
      setPending((current) => {
        if (current) {
          resolve(false);
          return current;
        }
        return { options, resolve };
      });
    });
  }, []);

  const handleResult = useCallback(
    (result: boolean) => {
      setPending((current) => {
        current?.resolve(result);
        return null;
      });
    },
    [],
  );

  // Stable context value so descendants don't re-render on every state
  // change here.
  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          // Radix fires this on Esc / outside-click / explicit close.
          // Treat any non-explicit-confirm close as "cancel."
          if (!open) handleResult(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.options.title}</AlertDialogTitle>
            {pending?.options.description && (
              <AlertDialogDescription>
                {pending.options.description}
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => handleResult(false)}>
              {pending?.options.cancelText ?? "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleResult(true)}
              className={cn(
                pending?.options.destructive &&
                  "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/30",
              )}
            >
              {pending?.options.confirmText ?? "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}
