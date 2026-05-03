import { cn } from "@/lib/utils";

/**
 * Header wordmark — "ıtınly" (dotless i's) with the 9C flight motif:
 *   - First i: orange origin dot
 *   - Cyan dashed contrail arcing over the wordmark
 *   - Second i's tittle: orange plane silhouette banking down toward
 *     where the dot would normally sit
 *
 * Palette A:
 *   #1A2B3C  primary text (light mode)
 *   #F8F9FA  primary text (dark mode, set via currentColor)
 *   #008CCF  cyan dashed contrail
 *   #D9501C  orange origin dot + plane silhouette
 *
 * The text element uses font-family: inherit so it picks up Inter
 * from the body className (loaded via next/font in layout.tsx).
 * Both i's are rendered as the dotless-i character (ı, U+0131) so
 * the natural font dots don't clash with the custom motif. ı lives
 * in the Latin Extended A block, so the latin-ext Google Fonts
 * subset must be loaded — see layout.tsx.
 *
 * For the compact square mark (favicon, tight headers, empty
 * states), use AppLogo.
 */
export function AppWordmark({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 115 80"
      role="img"
      aria-label="itinly"
      className={cn("h-10 text-[#1A2B3C] dark:text-[#F8F9FA]", className)}
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
      {/* Origin dot above the first i */}
      <circle cx="8" cy="22" r="3" fill="#D9501C" />
      {/* Cyan dashed flight contrail */}
      <path
        d="M 11 20 Q 22 2 32 14"
        stroke="#008CCF"
        strokeWidth="1.2"
        fill="none"
        strokeDasharray="2.5 1.8"
        strokeLinecap="round"
      />
      {/* Plane silhouette as the second i's tittle, banking down */}
      <g transform="translate(34 16) rotate(130) scale(0.55)">
        <path
          d="M 0 -14 L 2 -2 L 14 2 L 14 4 L 2 3 L 2 8 L 6 12 L 6 14 L 0 13 L -6 14 L -6 12 L -2 8 L -2 3 L -14 4 L -14 2 L -2 -2 Z"
          fill="#D9501C"
        />
      </g>
    </svg>
  );
}
