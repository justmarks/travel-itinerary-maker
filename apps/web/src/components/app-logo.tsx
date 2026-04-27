import { cn } from "@/lib/utils";

/**
 * Brand mark — paper plane on an indigo rounded square. Inline SVG so
 * sizing works through Tailwind classes (the same way Lucide icons do)
 * and so the logo doesn't pop in after a separate image fetch. Mirrors
 * the favicon at apps/web/src/app/icon.svg — keep them in sync.
 */
export function AppLogo({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label="Travel Itinerary Maker"
      className={cn("h-7 w-7", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="64" height="64" rx="14" fill="#4f46e5" />
      <path
        d="M48 16 L14 30 L26 34 L30 48 L34 38 L48 16 Z M26 34 L34 38"
        fill="none"
        stroke="#ffffff"
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
