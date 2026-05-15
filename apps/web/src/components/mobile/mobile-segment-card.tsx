"use client";

import {
  formatCurrency,
  formatFlightEndpoint,
  formatFlightLabel,
  convertToUsd,
} from "@itinly/shared";
import type { Segment } from "@itinly/shared";
import {
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
import { SEGMENT_CONFIG, fmt12h } from "./mobile-segment-config";

const RESTAURANT_TYPES = new Set([
  "restaurant_breakfast",
  "restaurant_brunch",
  "restaurant_lunch",
  "restaurant_dinner",
]);

function fmtDate(iso?: string): string | null {
  if (!iso) return null;
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function fmtUsd(amount: number) {
  // Always 2 decimals — partial-decimal display ("$288.4") reads as a
  // typo and fails to match what people see on receipts.
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Returns the cost in USD when the source currency has a known FX rate.
 * Foreign-currency segments (EUR/GBP/JPY/...) display as their USD
 * equivalent so the card reads consistently in dollars; the original
 * currency is preserved in the secondary line for reference. Currencies
 * without a rate (e.g. "points") fall back to their native symbol via
 * the shared `formatCurrency` helper (which forces 2 decimals).
 */
function formatCost(cost?: { amount: number; currency: string; details?: string }) {
  if (!cost) return null;
  const usd = convertToUsd(cost.amount, cost.currency);
  if (usd !== undefined) return fmtUsd(usd);
  return formatCurrency(cost.amount, cost.currency);
}

function formatCostOriginal(cost?: { amount: number; currency: string }) {
  if (!cost || cost.currency === "USD") return null;
  if (convertToUsd(cost.amount, cost.currency) === undefined) return null;
  return formatCurrency(cost.amount, cost.currency);
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
  onConfirm,
  showCosts = true,
}: {
  segment: Segment;
  onSelect?: (segment: Segment) => void;
  /**
   * When set and `segment.needsReview === true`, the "Review" badge
   * becomes tap-to-confirm — same shortcut as desktop's inline green
   * check, but on the badge itself so users don't need to find a
   * second control. Wired by the parent to `useConfirmSegment`. Omit
   * for read-only viewers — the badge stays inert.
   */
  onConfirm?: (segment: Segment) => void;
  /**
   * When false (e.g. share with `showCosts: false`), suppress the
   * inline cost line on the card. Defaults to true so owned-trip
   * renders are unchanged.
   */
  showCosts?: boolean;
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
  const cost = showCosts ? formatCost(segment.cost) : null;
  const costOriginal = showCosts ? formatCostOriginal(segment.cost) : null;

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
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        style={{ background: config.bg, color: config.fg }}
      >
        <Icon className="h-5 w-5" />
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
            onConfirm ? (
              // Tap-to-confirm shortcut. Rendered as `role="button"` on
              // a span (rather than a real <button>) so the parent
              // card's wrapper button doesn't nest a button. stopPropagation
              // keeps the tap from bubbling to the card's onSelect.
              <span
                role="button"
                tabIndex={0}
                aria-label={`Confirm "${segment.title}" — clears the review flag`}
                onClick={(e) => {
                  e.stopPropagation();
                  onConfirm(segment);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onConfirm(segment);
                  }
                }}
                className="inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium active:opacity-70"
                style={{ backgroundColor: "var(--status-warn-bg)", color: "var(--status-warn-fg)", borderColor: "var(--status-warn-rail)" }}
              >
                <AlertCircle className="h-2.5 w-2.5" />
                Review
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: "var(--status-warn-bg)", color: "var(--status-warn-fg)", borderColor: "var(--status-warn-rail)" }}>
                <AlertCircle className="h-2.5 w-2.5" />
                Review
              </span>
            )
          ) : segment.source === "email_confirmed" ? (
            <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: "var(--status-ok-bg)", color: "var(--status-ok-fg)", borderColor: "var(--status-ok-rail)" }}>
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
              segment.breakfastIncluded ? "text-[color:var(--status-ok-fg)]" : "text-muted-foreground",
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

  const baseClasses =
    "block w-full rounded-2xl border bg-card border-l-4 shadow-sm overflow-hidden";
  const railStyle = { borderLeftColor: config.rail } as React.CSSProperties;

  if (interactive) {
    return (
      <button
        type="button"
        onClick={() => onSelect?.(segment)}
        className={cn(baseClasses, "transition-transform active:scale-[0.99] active:bg-muted/40")}
        style={railStyle}
      >
        {cardBody}
      </button>
    );
  }

  return (
    <div className={baseClasses} style={railStyle}>
      {cardBody}
    </div>
  );
}
