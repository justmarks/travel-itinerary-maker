import {
  Plane,
  Train,
  Car,
  BedDouble,
  MapPin,
  UtensilsCrossed,
  Camera,
  Ship,
  Ticket,
  Navigation,
} from "lucide-react";
import {
  SEGMENT_LABELS,
  SEGMENT_TOKEN_FAMILY,
} from "@itinly/shared";
import type { SegmentType } from "@itinly/shared";

/**
 * Per-segment-type icon component + design tokens used by every mobile
 * surface that renders a segment (card, timeline, detail sheet, etc.).
 *
 * Labels and token families come from `@travel-app/shared/segment-config`
 * so they cannot drift from the desktop `itinerary-day.tsx` config. Only
 * the icon mapping lives here — `lucide-react` is a UI dependency and
 * doesn't belong in `packages/shared`.
 *
 * The composed `bg`/`fg`/`rail` strings resolve to `--seg-{family}-{role}`
 * in `design-tokens.css`. Light mode uses Tailwind 50-weight pastels with
 * 600-weight icon foregrounds; the dark-mode overrides shift to translucent
 * 950/60 backgrounds with 300-weight foregrounds so the icon stays
 * legible against near-black surfaces.
 */
export type SegmentConfig = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  fg: string;
  bg: string;
  rail: string;
};

const SEGMENT_ICON: Record<SegmentType, React.ComponentType<{ className?: string }>> = {
  flight: Plane,
  train: Train,
  car_rental: Car,
  car_service: Car,
  other_transport: Navigation,
  hotel: BedDouble,
  activity: MapPin,
  show: Ticket,
  restaurant_breakfast: UtensilsCrossed,
  restaurant_brunch: UtensilsCrossed,
  restaurant_lunch: UtensilsCrossed,
  restaurant_dinner: UtensilsCrossed,
  tour: Camera,
  cruise: Ship,
};

export const SEGMENT_CONFIG: Record<SegmentType, SegmentConfig> = Object.fromEntries(
  (Object.keys(SEGMENT_ICON) as SegmentType[]).map((type) => {
    const family = SEGMENT_TOKEN_FAMILY[type];
    return [
      type,
      {
        icon: SEGMENT_ICON[type],
        label: SEGMENT_LABELS[type],
        fg: `var(--seg-${family}-fg)`,
        bg: `var(--seg-${family}-bg)`,
        rail: `var(--seg-${family}-rail)`,
      },
    ];
  }),
) as Record<SegmentType, SegmentConfig>;

/**
 * 24h → 12h-with-am/pm formatter. Returns null when input is falsy so
 * callers can chain `?? "—"` for empty-state UX. Used everywhere a
 * segment's time gets rendered on the mobile surfaces.
 */
export function fmt12h(t?: string): string | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, "0")}${ampm}`;
}
