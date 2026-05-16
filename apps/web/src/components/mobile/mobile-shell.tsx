"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, WifiOff } from "lucide-react";
import { useDemoHref } from "@/lib/demo";
import { useOnlineStatus } from "@/lib/use-online-status";
import { cn } from "@/lib/utils";
import { PwaInstallHint } from "./pwa-install-hint";

/**
 * Constrains the mobile prototype to a phone-sized frame when previewed on
 * a desktop (mouse-primary, fine-pointer) browser, while letting it fill
 * the viewport on actual touch devices. Pixel 10 XL is ~430px wide in CSS
 * pixels, so we cap the frame at 430px and centre it.
 *
 * The cap is gated on `(pointer: fine)` so it kicks in for desktop preview
 * (laptops, mice) but NOT for iPads or large phones in landscape. Without
 * this gate, an iPad redirected to /m sees a 430px column flanked by empty
 * space — the "single thin column" bug we hit on iPad portrait (820/834).
 *
 * `widenInLandscape` opts a specific page out of the 430px cap when the
 * device is rotated to landscape — the timeline view turns this on so a
 * rotated phone can use the full viewport for its Gantt grid. Carousel
 * (and everything else) keeps the existing 430px feel on desktop preview.
 */
export function MobileFrame({
  children,
  className,
  widenInLandscape = false,
}: {
  children: ReactNode;
  className?: string;
  widenInLandscape?: boolean;
}): React.JSX.Element {
  const online = useOnlineStatus();
  return (
    <div className="min-h-screen bg-muted">
      <div
        className={cn(
          // Base: fill the viewport on a real touch device. The phone-frame
          // chrome (430px cap, rounded card, border, top/bottom margin,
          // shadow) is gated on `pointer-fine` so it ONLY kicks in on
          // mouse-primary devices (the desktop preview experience). iPads
          // and large phones in landscape — touch-primary — see the
          // mobile shell fill the viewport instead of getting framed as a
          // 430px column with empty space on either side.
          "relative mx-auto flex min-h-screen flex-col overflow-hidden bg-background",
          "pointer-fine:max-w-[430px] pointer-fine:shadow-xl pointer-fine:md:my-4 pointer-fine:md:min-h-[calc(100vh-2rem)] pointer-fine:md:rounded-3xl pointer-fine:md:border",
          // In landscape on a phone-sized device, drop the desktop-preview
          // chrome since a rotated phone uses the full viewport and the
          // framing reads as wasted space.
          widenInLandscape &&
            "pointer-fine:landscape:max-w-none pointer-fine:landscape:shadow-none pointer-fine:md:landscape:my-0 pointer-fine:md:landscape:rounded-none pointer-fine:md:landscape:border-0 pointer-fine:md:landscape:min-h-screen",
          className,
        )}
      >
        {!online && (
          <div
            role="status"
            aria-live="polite"
            className="flex shrink-0 items-center justify-center gap-1.5 px-3 py-1 text-[11px] font-medium" style={{ backgroundColor: "var(--status-warn-bg)", color: "var(--status-warn-fg)" }}
          >
            <WifiOff className="h-3 w-3" />
            <span>Offline — showing last loaded data</span>
          </div>
        )}
        {/* One-time PWA install nudge. Renders nothing on subsequent
            visits, when the app is already installed, or when neither
            install path is available. See `pwa-install-hint.tsx`. */}
        <PwaInstallHint />
        {children}
      </div>
    </div>
  );
}

export function MobileHeader({
  title,
  subtitle,
  backHref,
  right,
}: {
  /**
   * Header label. Optional — the trip-detail page omits it because the
   * carousel/timeline view renders its own larger title block, and a
   * second compact one in the sticky header reads as duplicate chrome.
   */
  title?: string;
  subtitle?: string;
  backHref?: string;
  right?: ReactNode;
}): React.JSX.Element {
  const homeHref = useDemoHref("/m");
  const href = backHref ?? homeHref;

  return (
    <header className="sticky top-0 z-30 flex shrink-0 items-center gap-2 border-b border-border/60 bg-background/85 px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <Link
        href={href}
        aria-label="Back"
        className="flex h-9 w-9 items-center justify-center rounded-full text-foreground/80 hover:bg-muted active:bg-muted/80"
      >
        <ArrowLeft className="h-5 w-5" />
      </Link>
      <div className="min-w-0 flex-1">
        {title && (
          <p className="truncate text-sm font-semibold leading-tight">{title}</p>
        )}
        {subtitle && (
          <p className="truncate text-xs leading-tight text-muted-foreground">
            {subtitle}
          </p>
        )}
      </div>
      {right}
    </header>
  );
}
