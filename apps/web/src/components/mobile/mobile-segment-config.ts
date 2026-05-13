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
import type { SegmentType } from "@itinly/shared";

/**
 * Per-segment-type icon component + design tokens used by every mobile
 * surface that renders a segment (card, timeline, detail sheet, etc.).
 *
 * Token names match `--seg-{type}-{role}` in `globals.css`. Light mode
 * uses Tailwind 50-weight pastels with 600-weight icon foregrounds; the
 * dark-mode overrides on those tokens shift to translucent 950/60
 * backgrounds with 300-weight foregrounds so the icon stays legible
 * against near-black surfaces.
 */
export type SegmentConfig = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  /** CSS variable carrying the icon's foreground color. */
  fg: string;
  /** CSS variable carrying the icon-disc background tint. */
  bg: string;
  /** CSS variable carrying the left accent rail color. */
  rail: string;
};

export const SEGMENT_CONFIG: Record<SegmentType, SegmentConfig> = {
  flight:               { icon: Plane,           label: "Flight",      fg: "var(--seg-flight-fg)",    bg: "var(--seg-flight-bg)",    rail: "var(--seg-flight-rail)"    },
  train:                { icon: Train,           label: "Train",       fg: "var(--seg-train-fg)",     bg: "var(--seg-train-bg)",     rail: "var(--seg-train-rail)"     },
  car_rental:           { icon: Car,             label: "Car Rental",  fg: "var(--seg-car-fg)",       bg: "var(--seg-car-bg)",       rail: "var(--seg-car-rail)"       },
  car_service:          { icon: Car,             label: "Car Service", fg: "var(--seg-car-fg)",       bg: "var(--seg-car-bg)",       rail: "var(--seg-car-rail)"       },
  other_transport:      { icon: Navigation,      label: "Transport",   fg: "var(--seg-transport-fg)", bg: "var(--seg-transport-bg)", rail: "var(--seg-transport-rail)" },
  hotel:                { icon: BedDouble,       label: "Hotel",       fg: "var(--seg-hotel-fg)",     bg: "var(--seg-hotel-bg)",     rail: "var(--seg-hotel-rail)"     },
  activity:             { icon: MapPin,          label: "Activity",    fg: "var(--seg-activity-fg)",  bg: "var(--seg-activity-bg)",  rail: "var(--seg-activity-rail)"  },
  show:                 { icon: Ticket,          label: "Show",        fg: "var(--seg-show-fg)",      bg: "var(--seg-show-bg)",      rail: "var(--seg-show-rail)"      },
  restaurant_breakfast: { icon: UtensilsCrossed, label: "Breakfast",   fg: "var(--seg-breakfast-fg)", bg: "var(--seg-breakfast-bg)", rail: "var(--seg-breakfast-rail)" },
  restaurant_brunch:    { icon: UtensilsCrossed, label: "Brunch",      fg: "var(--seg-brunch-fg)",    bg: "var(--seg-brunch-bg)",    rail: "var(--seg-brunch-rail)"    },
  restaurant_lunch:     { icon: UtensilsCrossed, label: "Lunch",       fg: "var(--seg-lunch-fg)",     bg: "var(--seg-lunch-bg)",     rail: "var(--seg-lunch-rail)"     },
  restaurant_dinner:    { icon: UtensilsCrossed, label: "Dinner",      fg: "var(--seg-dinner-fg)",    bg: "var(--seg-dinner-bg)",    rail: "var(--seg-dinner-rail)"    },
  tour:                 { icon: Camera,          label: "Tour",        fg: "var(--seg-tour-fg)",      bg: "var(--seg-tour-bg)",      rail: "var(--seg-tour-rail)"      },
  cruise:               { icon: Ship,            label: "Cruise",      fg: "var(--seg-cruise-fg)",    bg: "var(--seg-cruise-bg)",    rail: "var(--seg-cruise-rail)"    },
};

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
