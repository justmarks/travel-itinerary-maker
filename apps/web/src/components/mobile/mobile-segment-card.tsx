"use client";

import { formatFlightLabel, formatFlightEndpoint, convertToUsd } from "@travel-app/shared";
import type { Segment } from "@travel-app/shared";
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
  CheckCircle2,
  AlertCircle,
  Clock,
  Armchair,
  Coffee,
  Phone,
  Users,
  CreditCard,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const RESTAURANT_TYPES = new Set([
  "restaurant_breakfast",
  "restaurant_brunch",
  "restaurant_lunch",
  "restaurant_dinner",
]);

type SegmentConfig = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  /** Tailwind text color for the icon. */
  iconColor: string;
  /** Tailwind border color for the left accent stripe. */
  accent: string;
  /** Tailwind background tint for the icon disc. */
  bg: string;
};

const SEGMENT_CONFIG: Record<string, SegmentConfig> = {
  flight:               { icon: Plane,           label: "Flight",     iconColor: "text-blue-600",   accent: "border-l-blue-500",   bg: "bg-blue-50"   },
  train:                { icon: Train,           label: "Train",      iconColor: "text-purple-600", accent: "border-l-purple-500", bg: "bg-purple-50" },
  car_rental:           { icon: Car,             label: "Car Rental", iconColor: "text-orange-600", accent: "border-l-orange-500", bg: "bg-orange-50" },
  car_service:          { icon: Car,             label: "Car Service",iconColor: "text-orange-600", accent: "border-l-orange-500", bg: "bg-orange-50" },
  other_transport:      { icon: Navigation,      label: "Transport",  iconColor: "text-gray-600",   accent: "border-l-gray-400",   bg: "bg-gray-100"  },
  hotel:                { icon: BedDouble,       label: "Hotel",      iconColor: "text-indigo-600", accent: "border-l-indigo-500", bg: "bg-indigo-50" },
  activity:             { icon: MapPin,          label: "Activity",   iconColor: "text-green-600",  accent: "border-l-green-500",  bg: "bg-green-50"  },
  show:                 { icon: Ticket,          label: "Show",       iconColor: "text-pink-600",   accent: "border-l-pink-500",   bg: "bg-pink-50"   },
  restaurant_breakfast: { icon: UtensilsCrossed, label: "Breakfast",  iconColor: "text-sky-600",    accent: "border-l-sky-500",    bg: "bg-sky-50"    },
  restaurant_brunch:    { icon: UtensilsCrossed, label: "Brunch",     iconColor: "text-lime-600",   accent: "border-l-lime-500",   bg: "bg-lime-50"   },
  restaurant_lunch:     { icon: UtensilsCrossed, label: "Lunch",      iconColor: "text-amber-600",  accent: "border-l-amber-500",  bg: "bg-amber-50"  },
  restaurant_dinner:    { icon: UtensilsCrossed, label: "Dinner",     iconColor: "text-red-600",    accent: "border-l-red-500",    bg: "bg-red-50"    },
  tour:                 { icon: Camera,          label: "Tour",       iconColor: "text-teal-600",   accent: "border-l-teal-500",   bg: "bg-teal-50"   },
  cruise:               { icon: Ship,            label: "Cruise",     iconColor: "text-cyan-600",   accent: "border-l-cyan-500",   bg: "bg-cyan-50"   },
};

function fmt12h(t?: string): string | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, "0")}${ampm}`;
}

function fmtDate(iso?: string): string | null {
  if (!iso) return null;
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function fmtUsd(amount: number) {
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Returns the cost in USD when the source currency has a known FX rate.
 * Foreign-currency segments (EUR/GBP/JPY/...) display as their USD
 * equivalent so the card reads consistently in dollars; the original
 * currency is preserved in the secondary line for reference. Currencies
 * without a rate (e.g. "points") fall back to their native symbol.
 */
function formatCost(cost?: { amount: number; currency: string; details?: string }) {
  if (!cost) return null;
  const usd = convertToUsd(cost.amount, cost.currency);
  if (usd !== undefined) return fmtUsd(usd);
  const symbols: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };
  const sym = symbols[cost.currency] ?? `${cost.currency} `;
  return `${sym}${cost.amount.toLocaleString()}`;
}

function formatCostOriginal(cost?: { amount: number; currency: string }) {
  if (!cost || cost.currency === "USD") return null;
  if (convertToUsd(cost.amount, cost.currency) === undefined) return null;
  const symbols: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };
  const sym = symbols[cost.currency] ?? `${cost.currency} `;
  return `${sym}${cost.amount.toLocaleString()}`;
}

/**
 * Compact summary card for a segment. When `onSelect` is provided the whole
 * card becomes tappable and any inline links (URL, tel:) are flattened — the
 * detail sheet handles those actions instead so we don't nest interactive
 * elements inside a button.
 */
export function MobileSegmentCard({
  segment,
  onSelect,
}: {
  segment: Segment;
  onSelect?: (segment: Segment) => void;
}): React.JSX.Element {
  const config = SEGMENT_CONFIG[segment.type] ?? SEGMENT_CONFIG.activity;
  const Icon = config.icon;

  const isHotel = segment.type === "hotel";
  const isFlight = segment.type === "flight";
  const isTrain = segment.type === "train";
  const isCarRental = segment.type === "car_rental";
  const isCarService = segment.type === "car_service";
  const isCruise = segment.type === "cruise";
  const isRestaurant = RESTAURANT_TYPES.has(segment.type);

  const startTime = fmt12h(segment.startTime);
  const endTime = fmt12h(segment.endTime);
  const cost = formatCost(segment.cost);
  const costOriginal = formatCostOriginal(segment.cost);

  const flightLabel = isFlight ? formatFlightLabel(segment) : "";
  const titleText =
    flightLabel && !segment.title.includes(flightLabel)
      ? `${segment.title} (${flightLabel})`
      : segment.title;

  const depLabel = formatFlightEndpoint(segment.departureAirport, segment.departureCity);
  const arrLabel = formatFlightEndpoint(segment.arrivalAirport, segment.arrivalCity);

  const interactive = !!onSelect;

  const cardBody = (
    <div className="flex w-full gap-3 p-4 text-left">
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
          config.bg,
        )}
      >
        <Icon className={cn("h-5 w-5", config.iconColor)} />
      </div>

      <div className="min-w-0 flex-1">
        {/* Type label + time */}
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <span className="font-medium">{config.label}</span>
          {(startTime || endTime) && (
            <>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1 normal-case tracking-normal">
                <Clock className="h-3 w-3 shrink-0" />
                {isHotel ? (
                  <>
                    {startTime && <span>Check-in {startTime}</span>}
                    {!startTime && endTime && <span>Check-out {endTime}</span>}
                  </>
                ) : isCarRental ? (
                  <>
                    {startTime && <span>Pickup {startTime}</span>}
                    {!startTime && endTime && <span>Dropoff {endTime}</span>}
                  </>
                ) : isCruise ? (
                  <>
                    {startTime && <span>Board {startTime}</span>}
                    {!startTime && endTime && <span>Disembark {endTime}</span>}
                  </>
                ) : (
                  <span>
                    {startTime}
                    {endTime ? ` – ${endTime}` : ""}
                  </span>
                )}
              </span>
            </>
          )}
        </div>

        {/* Title */}
        <div className="mt-1 flex flex-wrap items-start gap-2">
          <span className="text-base font-semibold leading-snug">
            {titleText}
          </span>
          {segment.needsReview ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              <AlertCircle className="h-2.5 w-2.5" />
              Review
            </span>
          ) : segment.source === "email_confirmed" ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-green-300 bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-700">
              <CheckCircle2 className="h-2.5 w-2.5" />
              Confirmed
            </span>
          ) : null}
        </div>

        {/* Route */}
        {depLabel && arrLabel && (
          <p className="mt-1.5 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{depLabel}</span>
            {" → "}
            <span className="font-medium text-foreground">{arrLabel}</span>
            {!isFlight && segment.carrier && ` · ${segment.carrier}`}
            {!isFlight && segment.routeCode && ` ${segment.routeCode}`}
          </p>
        )}

        {/* Venue / address */}
        {segment.venueName && !depLabel && (
          <p className="mt-1.5 text-sm text-muted-foreground">
            {segment.venueName}
            {segment.address && (
              <>
                <br />
                <span className="text-xs">{segment.address}</span>
              </>
            )}
          </p>
        )}

        {/* Hotel multi-night */}
        {isHotel && segment.endDate && (
          <p className="mt-1 text-xs text-muted-foreground">
            Check-out {fmt12h(segment.endTime) ?? "—"} · {fmtDate(segment.endDate)}
          </p>
        )}

        {/* Flight cabin / seats */}
        {isFlight && (segment.cabinClass || segment.seatNumber) && (
          <p className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Armchair className="h-3 w-3 shrink-0" />
            {segment.cabinClass}
            {segment.cabinClass && segment.seatNumber && " · "}
            {segment.seatNumber && `Seat ${segment.seatNumber}`}
          </p>
        )}

        {/* Train coach + seat */}
        {isTrain && (segment.coach || segment.seatNumber) && (
          <p className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Armchair className="h-3 w-3 shrink-0" />
            {segment.coach}
            {segment.coach && segment.seatNumber && " · "}
            {segment.seatNumber && `Seat ${segment.seatNumber}`}
          </p>
        )}

        {/* Hotel breakfast */}
        {isHotel && segment.breakfastIncluded !== undefined && (
          <p
            className={cn(
              "mt-1 inline-flex items-center gap-1 text-xs",
              segment.breakfastIncluded ? "text-green-700" : "text-muted-foreground",
            )}
          >
            <Coffee className="h-3 w-3 shrink-0" />
            {segment.breakfastIncluded ? "Breakfast included" : "No breakfast"}
          </p>
        )}

        {/* Restaurant party + cc hold */}
        {isRestaurant && (segment.partySize || segment.creditCardHold) && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {segment.partySize && (
              <span className="inline-flex items-center gap-1">
                <Users className="h-3 w-3 shrink-0" />
                Party of {segment.partySize}
              </span>
            )}
            {segment.creditCardHold && (
              <span className="inline-flex items-center gap-1">
                <CreditCard className="h-3 w-3 shrink-0" />
                CC hold
              </span>
            )}
          </div>
        )}

        {/* Phone (rendered as a hint when the card is interactive — the
            sheet exposes the actual tel: action so the button wrapper
            doesn't nest an anchor). */}
        {(isRestaurant || isCarService) && segment.phone && (
          <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Phone className="h-3 w-3 shrink-0" />
            {segment.phone}
          </p>
        )}

        {/* Confirmation + cost */}
        {(segment.confirmationCode || cost) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            {segment.confirmationCode && (
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                #{segment.confirmationCode}
              </span>
            )}
            {cost && (
              <span className="text-sm font-semibold text-foreground">
                {cost}
                {costOriginal && (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    ({costOriginal})
                  </span>
                )}
                {segment.cost?.details && (
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    · {segment.cost.details}
                  </span>
                )}
              </span>
            )}
          </div>
        )}
      </div>

      {interactive && (
        <ChevronRight className="mt-1 h-4 w-4 shrink-0 self-center text-muted-foreground" />
      )}
    </div>
  );

  const baseClasses = cn(
    "block w-full rounded-2xl border bg-card border-l-4 shadow-sm overflow-hidden",
    config.accent,
  );

  if (interactive) {
    return (
      <button
        type="button"
        onClick={() => onSelect?.(segment)}
        className={cn(baseClasses, "transition-transform active:scale-[0.99] active:bg-muted/40")}
      >
        {cardBody}
      </button>
    );
  }

  return <div className={baseClasses}>{cardBody}</div>;
}
