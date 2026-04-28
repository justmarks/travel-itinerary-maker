"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useDemoHref } from "@/lib/demo";
import { cn } from "@/lib/utils";

/**
 * Constrains the mobile prototype to a phone-sized frame on desktop while
 * letting it fill the viewport on actual phones. Pixel 10 XL is ~430px wide
 * in CSS pixels, so we cap the frame at 430px and centre it.
 */
export function MobileFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className="min-h-screen bg-zinc-100">
      <div
        className={cn(
          "relative mx-auto flex min-h-screen max-w-[430px] flex-col overflow-hidden bg-background shadow-xl md:my-4 md:min-h-[calc(100vh-2rem)] md:rounded-3xl md:border",
          className,
        )}
      >
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
  title: string;
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
        <p className="truncate text-sm font-semibold leading-tight">{title}</p>
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
