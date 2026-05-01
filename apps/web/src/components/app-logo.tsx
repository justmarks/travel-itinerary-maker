import { cn } from "@/lib/utils";

/**
 * Brand mark — terracotta map pin as the dot of a lowercase "i" on a
 * zinc rounded square. Inline SVG so sizing works through Tailwind
 * classes (the same way Lucide icons do) and so the logo doesn't pop
 * in after a separate image fetch. Mirrors the favicon at
 * apps/web/src/app/icon.svg — keep them in sync.
 */
export function AppLogo({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label="itinly"
      className={cn("h-7 w-7", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="64" height="64" rx="14" fill="#18181b" />
      <path
        d="M 32 8 C 27 8 23 12 23 17 C 23 22.5 32 30 32 30 C 32 30 41 22.5 41 17 C 41 12 37 8 32 8 Z"
        fill="#c2502e"
      />
      <circle cx="32" cy="16" r="2.6" fill="#18181b" />
      <rect x="29" y="36" width="6" height="22" rx="2" fill="#fafafa" />
    </svg>
  );
}
