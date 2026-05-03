import { cn } from "@/lib/utils";

/**
 * Brand mark — treasure-map with a destination pin and a banked plane
 * over a dashed cyan contrail (Direction 16, palette A). Inline SVG so
 * sizing works through Tailwind classes (the same way Lucide icons do)
 * and so the logo doesn't pop in after a separate image fetch. Mirrors
 * the favicon at apps/web/src/app/icon.svg — keep them in sync.
 *
 * Color palette (locked palette A):
 *   #1A2B3C primary navy   — outer rounded square
 *   #F8F9FA surface        — parchment fill, pin's inner hole
 *   #008CCF action cyan    — flight contrail
 *   #D9501C secondary      — destination pin + plane silhouette
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
      <rect width="64" height="64" rx="14" fill="#1A2B3C" />
      {/* Torn parchment map */}
      <path
        d="M 5 31 L 11 28 L 17 30 L 23 27 L 30 30 L 37 28 L 43 31 L 50 28 L 57 30 L 60 36 L 58 42 L 60 49 L 57 55 L 50 57 L 43 55 L 37 58 L 30 55 L 23 58 L 17 55 L 10 57 L 5 53 L 4 47 L 5 41 L 4 36 Z"
        fill="#F8F9FA"
      />
      {/* Aging stains */}
      <ellipse cx="18" cy="38" rx="3" ry="1.5" fill="#1A2B3C" opacity="0.07" />
      <ellipse cx="50" cy="50" rx="2.5" ry="1.3" fill="#1A2B3C" opacity="0.06" />
      {/* Hand-drawn coastline */}
      <path
        d="M 8 42 Q 14 38 20 41 Q 26 44 32 40 Q 38 36 44 41 Q 50 44 56 40"
        stroke="#1A2B3C"
        strokeWidth="0.7"
        fill="none"
        opacity="0.45"
      />
      {/* Dotted treasure trail */}
      <path
        d="M 12 50 Q 20 47 26 49 Q 34 52 40 46 Q 44 42 46 40"
        stroke="#1A2B3C"
        strokeWidth="0.9"
        fill="none"
        strokeDasharray="0.6 2"
        strokeLinecap="round"
        opacity="0.65"
      />
      {/* Destination pin */}
      <path
        d="M 46 34 C 43 34 41 36 41 39 C 41 43 46 50 46 50 C 46 50 51 43 51 39 C 51 36 49 34 46 34 Z"
        fill="#D9501C"
      />
      <circle cx="46" cy="38.5" r="1.5" fill="#F8F9FA" />
      {/* Cyan flight contrail */}
      <path
        d="M 10 14 Q 26 8 42 30"
        stroke="#008CCF"
        strokeWidth="1.4"
        fill="none"
        strokeDasharray="2.5 2"
        strokeLinecap="round"
      />
      {/* Plane silhouette */}
      <g transform="translate(10 14) rotate(125) scale(0.55)">
        <path
          d="M 0 -14 L 2 -2 L 14 2 L 14 4 L 2 3 L 2 8 L 6 12 L 6 14 L 0 13 L -6 14 L -6 12 L -2 8 L -2 3 L -14 4 L -14 2 L -2 -2 Z"
          fill="#D9501C"
        />
      </g>
    </svg>
  );
}
