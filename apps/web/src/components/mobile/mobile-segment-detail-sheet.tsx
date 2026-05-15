"use client";

import { useState } from "react";
import {
  formatCurrency,
  formatFlightLabel,
  formatFlightEndpoint,
  convertToUsd,
  SEGMENT_LABELS,
} from "@itinly/shared";
import type { Segment } from "@itinly/shared";
import {
  AlertCircle,
  Armchair,
  CheckCircle2,
  Coffee,
  Copy,
  CreditCard,
  ExternalLink,
  MapPin,
  Pencil,
  Phone,
  UserRound,
  Users,
  X,
  Ship,
  Anchor,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MobileBottomSheet } from "./mobile-bottom-sheet";

const RESTAURANT_TYPES = new Set([
  "restaurant_breakfast",
  "restaurant_brunch",
  "restaurant_lunch",
  "restaurant_dinner",
]);


function fmt12h(t?: string): string | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, "0")}${ampm}`;
}

function fmtDateLong(iso?: string): string | null {
  if (!iso) return null;
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtUsd(amount: number) {
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Returns the cost in USD when the source currency has a known FX rate;
 * otherwise the native-currency formatting (e.g. "points"). Pairs with
 * formatCostOriginal below to render "$X (€Y)" for foreign cards. Both
 * delegate to the shared `formatCurrency` helper which forces 2
 * decimals across every currency.
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

function mapsQuery(segment: Segment): string | null {
  if (segment.address) return segment.address;
  if (segment.venueName && segment.city) return `${segment.venueName}, ${segment.city}`;
  if (segment.venueName) return segment.venueName;
  return null;
}

function mapsUrl(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 border-b border-border/40 py-3 last:border-b-0">
      <p className="text-kicker font-medium text-muted-foreground">
        {label}
      </p>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

function CopyButton({
  text,
  label,
}: {
  text: string;
  label: string;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard refused — silent.
        }
      }}
      aria-label={`Copy ${label}`}
      className="ml-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {copied ? (
        <CheckCircle2 className="h-3.5 w-3.5" style={{ color: "var(--status-ok-fg)" }} />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function ActionButton({
  href,
  icon: Icon,
  label,
  external = false,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  external?: boolean;
}): React.JSX.Element {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="flex flex-1 items-center justify-center gap-1.5 rounded-full border bg-background px-3 py-2 text-sm font-medium text-foreground active:bg-muted/60"
    >
      <Icon className="h-4 w-4" />
      {label}
    </a>
  );
}

export function MobileSegmentDetailSheet({
  segment,
  date,
  onClose,
  onEdit,
  onConfirm,
  showCosts = true,
  canEdit = false,
}: {
  segment: Segment | null;
  /** ISO date the segment lives on (the parent day). */
  date?: string;
  onClose: () => void;
  /**
   * Fires when the user taps "Edit" — the parent should close the
   * detail sheet and open the form sheet pre-filled with this segment.
   * Required when `canEdit` is true; ignored when read-only.
   */
  onEdit?: (segment: Segment, date: string) => void;
  /**
   * Fires when the user taps the "Review" badge in the sheet header.
   * Wired by the parent to `useConfirmSegment` so the user can clear
   * the review flag without opening Edit. Omit for read-only viewers.
   */
  onConfirm?: (segment: Segment) => void;
  /**
   * When false, suppress the cost row inside the sheet — matches the
   * inline card behaviour when the parent share has `showCosts: false`.
   */
  showCosts?: boolean;
  /**
   * When true, render an "Edit" footer action that delegates to
   * `onEdit`. The form sheet is where Delete lives, so we don't
   * duplicate it here.
   */
  canEdit?: boolean;
}): React.JSX.Element | null {
  if (!segment) {
    return (
      <MobileBottomSheet open={false} onClose={onClose} ariaLabel="Segment details">
        <div />
      </MobileBottomSheet>
    );
  }

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

  const mapsQ = mapsQuery(segment);

  const timeLine = (() => {
    if (!startTime && !endTime) return null;
    if (isHotel) {
      return (
        <>
          {startTime && <span>Check-in {startTime}</span>}
          {startTime && (endTime || segment.endDate) && <span className="mx-2">·</span>}
          {endTime && (
            <span>
              Check-out {endTime}
              {segment.endDate && ` · ${fmtDateLong(segment.endDate)}`}
            </span>
          )}
          {!endTime && segment.endDate && (
            <span>Check-out {fmtDateLong(segment.endDate)}</span>
          )}
        </>
      );
    }
    if (isCarRental) {
      return (
        <>
          {startTime && <span>Pickup {startTime}</span>}
          {startTime && (endTime || segment.endDate) && <span className="mx-2">·</span>}
          {endTime && <span>Dropoff {endTime}</span>}
          {segment.endDate && (
            <span className="ml-2">Return {fmtDateLong(segment.endDate)}</span>
          )}
        </>
      );
    }
    if (isCruise) {
      return (
        <>
          {startTime && <span>Board {startTime}</span>}
          {startTime && (endTime || segment.endDate) && <span className="mx-2">·</span>}
          {endTime && <span>Disembark {endTime}</span>}
          {segment.endDate && (
            <span className="ml-2">Off {fmtDateLong(segment.endDate)}</span>
          )}
        </>
      );
    }
    return (
      <span>
        {startTime}
        {endTime ? ` – ${endTime}` : ""}
      </span>
    );
  })();

  return (
    <MobileBottomSheet
      open
      onClose={onClose}
      ariaLabel={`${SEGMENT_LABELS[segment.type]} · ${segment.title}`}
    >
      {/* Header */}
      <div className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-2">
        <div className="min-w-0 flex-1">
          <p className="text-kicker font-semibold text-muted-foreground">
            {SEGMENT_LABELS[segment.type]}
          </p>
          <h2 className="mt-0.5 text-lg font-semibold leading-snug">
            {titleText}
          </h2>
          {date && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {fmtDateLong(date)}
            </p>
          )}
          {segment.needsReview ? (
            onConfirm ? (
              // Tap-to-confirm shortcut. The detail sheet's header
              // has no parent button so a real <button> is fine here
              // (unlike the card's badge which uses role="button" on
              // a span to avoid nesting).
              <button
                type="button"
                aria-label={`Confirm "${segment.title}" — clears the review flag`}
                onClick={() => onConfirm(segment)}
                className="mt-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium active:opacity-70"
                style={{ backgroundColor: "var(--status-warn-bg)", color: "var(--status-warn-fg)", borderColor: "var(--status-warn-rail)" }}
              >
                <AlertCircle className="h-3 w-3" />
                Tap to confirm
              </button>
            ) : (
              <span className="mt-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: "var(--status-warn-bg)", color: "var(--status-warn-fg)", borderColor: "var(--status-warn-rail)" }}>
                <AlertCircle className="h-3 w-3" />
                Needs review
              </span>
            )
          ) : segment.source === "email_confirmed" ? (
            <span className="mt-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: "var(--status-ok-bg)", color: "var(--status-ok-fg)", borderColor: "var(--status-ok-rail)" }}>
              <CheckCircle2 className="h-3 w-3" />
              Confirmed
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Detail rows */}
      <div className="flex-1 overflow-y-auto px-5 pb-6">
        {timeLine && <Row label="When">{timeLine}</Row>}

        {(depLabel || arrLabel) && (
          <Row label={isFlight ? "Route" : "From / To"}>
            <div className="space-y-0.5">
              {depLabel && (
                <p>
                  <span className="font-medium">{depLabel}</span>
                </p>
              )}
              {arrLabel && (
                <p>
                  <span className="font-medium">→ {arrLabel}</span>
                </p>
              )}
              {!isFlight && (segment.carrier || segment.routeCode) && (
                <p className="text-xs text-muted-foreground">
                  {[segment.carrier, segment.routeCode].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
          </Row>
        )}

        {(segment.venueName || segment.address) && (
          <Row label="Where">
            {segment.venueName && (
              <p className="font-medium">{segment.venueName}</p>
            )}
            {segment.address && (
              <p className="text-muted-foreground">{segment.address}</p>
            )}
          </Row>
        )}

        {isFlight && (segment.cabinClass || segment.seatNumber || segment.baggageInfo) && (
          <Row label="Cabin & seat">
            <div className="space-y-1">
              {(segment.cabinClass || segment.seatNumber) && (
                <p className="inline-flex items-center gap-1.5">
                  <Armchair className="h-3.5 w-3.5 text-muted-foreground" />
                  {segment.cabinClass}
                  {segment.cabinClass && segment.seatNumber && " · "}
                  {segment.seatNumber && `Seats ${segment.seatNumber}`}
                </p>
              )}
              {segment.baggageInfo && (
                <p className="text-xs text-muted-foreground">
                  {segment.baggageInfo}
                </p>
              )}
            </div>
          </Row>
        )}

        {isTrain && (segment.coach || segment.seatNumber) && (
          <Row label="Coach & seat">
            <p className="inline-flex items-center gap-1.5">
              <Armchair className="h-3.5 w-3.5 text-muted-foreground" />
              {segment.coach}
              {segment.coach && segment.seatNumber && " · "}
              {segment.seatNumber && `Seat ${segment.seatNumber}`}
            </p>
          </Row>
        )}

        {isHotel && segment.breakfastIncluded !== undefined && (
          <Row label="Breakfast">
            <p
              className={cn(
                "inline-flex items-center gap-1.5",
                segment.breakfastIncluded
                  ? "text-[color:var(--status-ok-fg)]"
                  : "text-muted-foreground",
              )}
            >
              <Coffee className="h-3.5 w-3.5" />
              {segment.breakfastIncluded ? "Included" : "Not included"}
            </p>
          </Row>
        )}

        {isRestaurant && (segment.partySize || segment.creditCardHold) && (
          <Row label="Reservation">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {segment.partySize && (
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                  Party of {segment.partySize}
                </span>
              )}
              {segment.creditCardHold && (
                <span className="inline-flex items-center gap-1.5">
                  <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                  Credit-card hold
                </span>
              )}
            </div>
            {segment.cancellationDeadline && (
              <p className="mt-1 text-xs" style={{ color: "var(--status-warn-fg)" }}>
                Cancel by {fmtDateLong(segment.cancellationDeadline)}
              </p>
            )}
          </Row>
        )}

        {isCarService && segment.contactName && (
          <Row label="Driver">
            <p className="inline-flex items-center gap-1.5">
              <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
              {segment.contactName}
            </p>
          </Row>
        )}

        {(segment.confirmationCode || segment.provider) && (
          <Row label="Booking">
            <div className="space-y-1">
              {segment.provider && (
                <p className="text-muted-foreground">{segment.provider}</p>
              )}
              {segment.confirmationCode && (
                <p className="flex items-center">
                  <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs">
                    #{segment.confirmationCode}
                  </span>
                  <CopyButton
                    text={segment.confirmationCode}
                    label="confirmation code"
                  />
                </p>
              )}
            </div>
          </Row>
        )}

        {cost && (
          <Row label="Cost">
            <p className="text-base font-semibold">
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
            </p>
          </Row>
        )}

        {isCruise && segment.portsOfCall && segment.portsOfCall.length > 0 && (
          <Row label="Ports of call">
            <ul className="space-y-1.5">
              {segment.portsOfCall.map((p) => (
                <li
                  key={p.date}
                  className="flex items-start gap-2 text-sm"
                >
                  {p.atSea ? (
                    <Ship className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <Anchor className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="text-muted-foreground">
                      {fmtDateLong(p.date)}
                    </span>
                    {p.atSea ? (
                      <span className="ml-1.5 italic text-muted-foreground">
                        At sea
                      </span>
                    ) : (
                      p.port && <span className="ml-1.5 font-medium">{p.port}</span>
                    )}
                    {(p.arrivalTime || p.departureTime) && !p.atSea && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        {p.arrivalTime && `Arr ${fmt12h(p.arrivalTime)}`}
                        {p.arrivalTime && p.departureTime && " · "}
                        {p.departureTime && `Dep ${fmt12h(p.departureTime)}`}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Row>
        )}
      </div>

      {/* Actions */}
      {(mapsQ ||
        segment.url ||
        ((isRestaurant || isCarService) && segment.phone) ||
        (canEdit && date && onEdit)) && (
        <div className="flex shrink-0 gap-2 border-t bg-background px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          {mapsQ && (
            <ActionButton
              href={mapsUrl(mapsQ)}
              icon={MapPin}
              label="Maps"
              external
            />
          )}
          {(isRestaurant || isCarService) && segment.phone && (
            <ActionButton
              href={`tel:${segment.phone}`}
              icon={Phone}
              label="Call"
            />
          )}
          {segment.url && (
            <ActionButton
              href={segment.url}
              icon={ExternalLink}
              label="Open"
              external
            />
          )}
          {canEdit && date && onEdit && (
            <button
              type="button"
              onClick={() => onEdit(segment, date)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground active:bg-primary/90"
            >
              <Pencil className="h-4 w-4" />
              Edit
            </button>
          )}
        </div>
      )}
    </MobileBottomSheet>
  );
}
