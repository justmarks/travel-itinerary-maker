import { cn } from "@/lib/utils";

/**
 * Header wordmark — "itinly" with a terracotta destination pin
 * replacing the dot of the second i. The 5B variant from the brand
 * brainstorm. For the compact square mark (favicon, tight headers,
 * empty states), use AppLogo.
 *
 * The text element uses font-family: inherit so it picks up Inter
 * from the body className (loaded via next/font in layout.tsx).
 * next/font registers Inter under a hashed family name, so an
 * explicit font-family="Inter" attribute would not resolve.
 *
 * Both i's are rendered as the dotless-i character (ı, U+0131) so
 * the natural font dots don't clash with the custom dot/pin
 * overlays. ı lives in the Latin Extended A block, so the
 * latin-ext Google Fonts subset must be loaded — see layout.tsx.
 */
export function AppWordmark({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 100 80"
      role="img"
      aria-label="itinly"
      className={cn("h-10 text-zinc-950 dark:text-zinc-50", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <text
        x="0"
        y="58"
        fontSize="48"
        fontWeight="500"
        fill="currentColor"
        letterSpacing="-1"
        style={{ fontFamily: "inherit" }}
      >
        ıtınly
      </text>
      <path
        d="M 8 22 Q 21 14 30 18"
        stroke="#c2502e"
        strokeWidth="1.3"
        fill="none"
        strokeLinecap="round"
        strokeDasharray="2 2"
        opacity="0.55"
      />
      <circle cx="8" cy="22" r="3.5" fill="#c2502e" />
      <path
        d="M 34 6 C 30 6 27.5 8.5 27.5 12.5 C 27.5 17 34 24 34 24 C 34 24 40.5 17 40.5 12.5 C 40.5 8.5 38 6 34 6 Z"
        fill="#c2502e"
      />
      <circle cx="34" cy="12.5" r="2" fill="#fafafa" />
    </svg>
  );
}
