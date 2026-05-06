"use client";

import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isIosSafari, usePwaInstall } from "@/lib/pwa-install";
import { useHintActive } from "@/lib/onboarding-hints";

/**
 * One-time hint that surfaces the "install as PWA" affordance on the
 * mobile shell. Three branches:
 *
 *   1. Already installed (`display-mode: standalone` or iOS standalone
 *      flag) — render nothing, the hint is irrelevant.
 *   2. Browser fired `beforeinstallprompt` (Android / Chromium) —
 *      banner with an "Install" button that fires the deferred prompt.
 *   3. iOS Safari (no programmatic install) — banner with the manual
 *      "Share menu → Add to Home Screen" instruction; no button.
 *
 * Once the user dismisses (X) or successfully installs, the dismissal
 * is persisted to localStorage so the banner never reappears on this
 * device. See `lib/onboarding-hints.ts` for the storage convention.
 */
export function PwaInstallHint(): React.JSX.Element | null {
  const { canInstall, isInstalled, promptInstall } = usePwaInstall();
  const { active, dismiss } = useHintActive("pwa-install");
  const [iosSafari, setIosSafari] = useState(false);

  useEffect(() => {
    setIosSafari(isIosSafari());
  }, []);

  if (isInstalled) return null;
  if (!active) return null;
  // Hide if neither install path is available — Android pre-prompt,
  // desktop hitting `/m`, etc. The component renders again as soon as
  // `beforeinstallprompt` fires (state flips inside `usePwaInstall`).
  if (!canInstall && !iosSafari) return null;

  const handleInstall = async () => {
    const accepted = await promptInstall();
    if (accepted) dismiss();
    // If declined, leave the hint in place. The deferred prompt is
    // gone, so `canInstall` flips false and the hint hides naturally
    // on the next render.
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex shrink-0 items-start gap-3 border-b border-border/60 bg-card px-4 py-3"
    >
      <div
        className="mt-0.5 shrink-0 rounded-md p-1.5"
        style={{
          backgroundColor: "var(--status-info-bg)",
          color: "var(--status-info-fg)",
        }}
      >
        <Download className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight">
          Install itinly on your phone
        </p>
        {iosSafari ? (
          <p className="mt-1 text-xs leading-snug text-muted-foreground">
            Tap the <span className="font-medium">Share</span> icon in
            Safari, then{" "}
            <span className="font-medium">Add to Home Screen</span>.
          </p>
        ) : (
          <p className="mt-1 text-xs leading-snug text-muted-foreground">
            Use it like a native app — works offline, fewer taps.
          </p>
        )}
        {canInstall && (
          <Button
            size="sm"
            className="mt-2 h-7 text-xs"
            onClick={handleInstall}
          >
            Install
          </Button>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss install hint"
        className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
