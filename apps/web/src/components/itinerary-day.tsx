"use client";

import { useState } from "react";
import {
  formatFlightLabel,
  formatFlightEndpoint,
  SEGMENT_LABELS,
  SEGMENT_TOKEN_FAMILY,
} from "@itinly/shared";
import type { SegmentType, TripDay, Segment } from "@itinly/shared";
import {
  useDeleteSegment,
  useConfirmSegment,
  useUpdateDay,
} from "@itinly/api-client";
import { toastMutationError } from "@/lib/api-error";
import { useConfirm } from "@/lib/confirm-dialog";
import { EditSegmentDialog } from "@/components/edit-segment-dialog";
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
  AlertCircle,
  CheckCircle2,
  Clock,
  Users,
  CreditCard,
  Phone,
  Armchair,
  UserRound,
  Coffee,
  Trash2,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AddSegmentDialog } from "@/components/add-segment-dialog";

const RESTAURANT_TYPES = new Set(["restaurant_breakfast", "restaurant_brunch", "restaurant_lunch", "restaurant_dinner"]);
const HOTEL_TYPES = new Set(["hotel"]);
/** Segment types whose `date`..`endDate` range spans multiple days. */
const MULTI_NIGHT_TYPES = new Set(["hotel", "car_rental", "cruise"]);

/**
 * Build a `{ [date]: ongoingStays[] }` lookup for every day a multi-night
 * segment (hotel / car rental / cruise) spans, excluding the check-in
 * day itself (which already renders the full segment card). Used by the
 * trip-detail and shared-view to render a slim "Still at …" banner on
 * each continuation night so the user doesn't see "No activities
 * planned." on a day they're actually booked at a hotel.
 */
export function computeOngoingStays(
  trip: { days: readonly TripDay[] },
): Record<
  string,
  { segment: Segment; nightIndex: number; totalNights: number }[]
> {
  const out: Record<
    string,
    { segment: Segment; nightIndex: number; totalNights: number }[]
  > = {};
  for (const day of trip.days) {
    for (const seg of day.segments) {
      if (!MULTI_NIGHT_TYPES.has(seg.type) || !seg.endDate) continue;
      if (seg.endDate <= day.date) continue;
      const start = new Date(day.date + "T00:00:00Z");
      const end = new Date(seg.endDate + "T00:00:00Z");
      const totalNights = Math.round(
        (end.getTime() - start.getTime()) / 86400000,
      );
      if (totalNights <= 1) continue;
      for (let i = 1; i < totalNights; i++) {
        const d = new Date(start.getTime() + i * 86400000);
        const iso = d.toISOString().slice(0, 10);
        (out[iso] ||= []).push({
          segment: seg,
          nightIndex: i + 1,
          totalNights,
        });
      }
    }
  }
  return out;
}
const FLIGHT_TYPES = new Set(["flight"]);
const TRAIN_TYPES = new Set(["train"]);
const CAR_RENTAL_TYPES = new Set(["car_rental"]);
const CAR_SERVICE_TYPES = new Set(["car_service"]);
const CRUISE_TYPES = new Set(["cruise"]);

function fmt12h(t?: string) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, "0")}${ampm}`;
}

function fmtDate(iso?: string) {
  if (!iso) return null;
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatCost(cost?: { amount: number; currency: string; details?: string }) {
  if (!cost) return null;
  const symbols: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };
  const sym = symbols[cost.currency] ?? `${cost.currency} `;
  return `${sym}${cost.amount.toLocaleString()}`;
}

// Icon-only map — labels and token families live in `@travel-app/shared` so
// the desktop and mobile surfaces can't drift. Adding a new SegmentType
// requires extending this map (TypeScript enforces the Record shape).
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

type SegmentConfig = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  /** Token suffix in `--seg-{token}-{rail,bg,fg}`. The row's left rail,
   *  the icon-tile background, and the icon glyph all read from this
   *  trio so a re-skin in `design-tokens.css` propagates automatically. */
  token: string;
};

const SEGMENT_CONFIG: Record<SegmentType, SegmentConfig> = Object.fromEntries(
  (Object.keys(SEGMENT_ICON) as SegmentType[]).map((type) => [
    type,
    {
      icon: SEGMENT_ICON[type],
      label: SEGMENT_LABELS[type],
      token: SEGMENT_TOKEN_FAMILY[type],
    },
  ]),
) as Record<SegmentType, SegmentConfig>;

/**
 * Trio style for a segment type. Used to paint the left rail, the
 * icon-tile background, and the icon glyph color from a single
 * design-system token family. Matches the visual idiom in the web
 * UI kit's `Itinerary.jsx` (32×32 rounded-md tinted tile + 4 px
 * left rail + shadow-xs row).
 */
function segmentRowStyle(token: string): React.CSSProperties {
  return { borderLeftColor: `var(--seg-${token}-rail)` };
}
function segmentTileStyle(token: string): React.CSSProperties {
  return {
    backgroundColor: `var(--seg-${token}-bg)`,
    color: `var(--seg-${token}-fg)`,
  };
}

function SegmentRow({
  segment,
  date,
  tripId,
  tripStartDate,
  tripEndDate,
  readOnly,
  showCosts = true,
}: {
  segment: Segment;
  date: string;
  tripId?: string;
  /** Owning trip's date range — passed through to EditSegmentDialog so
   *  its Date / Check-out / Dropoff / Disembark pickers can clamp with
   *  min/max. */
  tripStartDate?: string;
  tripEndDate?: string;
  readOnly?: boolean;
  /**
   * When false, suppress the cost line on this row. Threaded from the
   * parent itinerary view so a shared trip with `showCosts: false`
   * doesn't leak inline costs through the segment list.
   */
  showCosts?: boolean;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const confirm = useConfirm();
  const deleteSegment = useDeleteSegment(tripId ?? "");
  const confirmSegment = useConfirmSegment(tripId ?? "");
  const config = SEGMENT_CONFIG[segment.type] ?? SEGMENT_CONFIG.activity;
  const Icon = config.icon;
  const cost = showCosts ? formatCost(segment.cost) : null;
  const isRestaurant = RESTAURANT_TYPES.has(segment.type);
  const isHotel = HOTEL_TYPES.has(segment.type);
  const isFlight = FLIGHT_TYPES.has(segment.type);
  const isTrain = TRAIN_TYPES.has(segment.type);
  const isCarRental = CAR_RENTAL_TYPES.has(segment.type);
  const isCarService = CAR_SERVICE_TYPES.has(segment.type);
  const isCruise = CRUISE_TYPES.has(segment.type);

  const startTime = fmt12h(segment.startTime);
  const endTime = fmt12h(segment.endTime);

  // The flight title now bakes in the carrier + flight # via the form's
  // auto-title (e.g. "SEA → CDG (Air France 337)") so we don't append the
  // carrier label again. Only fall back to suffixing it when the user has
  // typed a custom title that doesn't already include it.
  const flightLabel = isFlight ? formatFlightLabel(segment) : "";
  const titleText =
    flightLabel && !segment.title.includes(flightLabel)
      ? `${segment.title} (${flightLabel})`
      : segment.title;

  return (
    <div
      className="group/seg flex items-start gap-3.5 rounded-lg border border-l-4 bg-card px-4 py-3.5 shadow-xs"
      style={segmentRowStyle(config.token)}
    >
      <div
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
        style={segmentTileStyle(config.token)}
      >
        <Icon className="h-[18px] w-[18px]" />
      </div>

      <div className="min-w-0 flex-1">
        {/* Title row */}
        <div className="flex flex-wrap items-center gap-2">
          {segment.url ? (
            <a
              href={segment.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium leading-snug hover:underline"
            >
              {titleText}
            </a>
          ) : (
            <span className="font-medium leading-snug">{titleText}</span>
          )}
          {segment.needsReview ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
              style={{
                color: "var(--status-warn-fg)",
                borderColor: "var(--status-warn-rail)",
              }}
            >
              <AlertCircle className="h-3 w-3" />
              Review
            </span>
          ) : segment.source === "email_confirmed" ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs"
              style={{
                color: "var(--status-ok-fg)",
                borderColor: "var(--status-ok-rail)",
              }}
            >
              <CheckCircle2 className="h-3 w-3" />
              Confirmed
            </span>
          ) : null}
        </div>

        {/* Time */}
        {(startTime || endTime) && (
          <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
            <Clock className="h-3 w-3 shrink-0" />
            {isHotel ? (
              <>
                {startTime && <span>Check-in {startTime}</span>}
                {startTime && endTime && <span className="mx-1">·</span>}
                {endTime && <span>Check-out {endTime}</span>}
                {segment.endDate && (
                  <>
                    <span className="mx-1">·</span>
                    <span>Out {fmtDate(segment.endDate)}</span>
                  </>
                )}
              </>
            ) : isCarRental ? (
              <>
                {startTime && <span>Pickup {startTime}</span>}
                {startTime && endTime && <span className="mx-1">·</span>}
                {endTime && <span>Dropoff {endTime}</span>}
                {segment.endDate && (
                  <>
                    <span className="mx-1">·</span>
                    <span>Return {fmtDate(segment.endDate)}</span>
                  </>
                )}
              </>
            ) : isCruise ? (
              <>
                {startTime && <span>Board {startTime}</span>}
                {startTime && endTime && <span className="mx-1">·</span>}
                {endTime && <span>Disembark {endTime}</span>}
                {segment.endDate && (
                  <>
                    <span className="mx-1">·</span>
                    <span>Off {fmtDate(segment.endDate)}</span>
                  </>
                )}
              </>
            ) : (
              <span>
                {startTime}
                {endTime ? ` – ${endTime}` : ""}
                {/* Overnight indicator — when the arrival time is
                    smaller than the departure time it means the
                    segment crosses midnight (most commonly an
                    overnight flight). Without this the user has to
                    mentally derive "6:30 is less than 23:00 so it
                    must be the next day". */}
                {isFlight && segment.startTime && segment.endTime &&
                  segment.endTime < segment.startTime && (
                    <span
                      className="ml-1.5 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none"
                      style={{
                        backgroundColor: "var(--status-info-bg)",
                        color: "var(--status-info-fg)",
                      }}
                      title="Arrives the next day"
                    >
                      +1
                    </span>
                  )}
              </span>
            )}
          </div>
        )}
        {/* End date fallback when no times are shown */}
        {!startTime && !endTime && segment.endDate && (isHotel || isCarRental || isCruise) && (
          <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
            <Clock className="h-3 w-3 shrink-0" />
            <span>
              {isHotel ? "Check-out " : isCarRental ? "Return " : "Disembark "}
              {fmtDate(segment.endDate)}
            </span>
          </div>
        )}

        {/* Confirmation + cost */}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {segment.confirmationCode && (
            <span className="font-mono text-xs">#{segment.confirmationCode}</span>
          )}
          {cost && (
            <span className="font-medium text-foreground">
              {cost}
              {segment.cost?.details && (
                <span className="ml-1 font-normal text-muted-foreground">
                  · {segment.cost.details}
                </span>
              )}
            </span>
          )}
        </div>

        {/* Route info (flights / trains / transport).
            For flights, the airline + number already live in the title.
            Endpoints render as "City (CODE)" when the IATA airport is known,
            "City" when only a city is set, and the bare code otherwise. */}
        {(() => {
          const depLabel = formatFlightEndpoint(segment.departureAirport, segment.departureCity);
          const arrLabel = formatFlightEndpoint(segment.arrivalAirport, segment.arrivalCity);
          if (!depLabel || !arrLabel) return null;
          return (
            <p className="mt-1 text-sm text-muted-foreground">
              {depLabel} → {arrLabel}
              {!isFlight && segment.carrier && ` · ${segment.carrier}`}
              {!isFlight && segment.routeCode && ` ${segment.routeCode}`}
            </p>
          );
        })()}

        {/* Cabin class, seats, baggage (flights) */}
        {isFlight && (segment.seatNumber || segment.cabinClass) && (
          <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
            <Armchair className="h-3 w-3 shrink-0" />
            {segment.cabinClass && <span>{segment.cabinClass}</span>}
            {segment.cabinClass && segment.seatNumber && <span>·</span>}
            {segment.seatNumber && <span>Seats: {segment.seatNumber}</span>}
          </p>
        )}
        {isFlight && segment.baggageInfo && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {segment.baggageInfo}
          </p>
        )}

        {/* Train coach & seat */}
        {isTrain && (segment.coach || segment.seatNumber) && (
          <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
            <Armchair className="h-3 w-3 shrink-0" />
            {segment.coach && <span>{segment.coach}</span>}
            {segment.coach && segment.seatNumber && <span>·</span>}
            {segment.seatNumber && <span>Seat {segment.seatNumber}</span>}
          </p>
        )}

        {/* Venue / address */}
        {segment.venueName && (
          <p className="mt-1 text-sm text-muted-foreground">
            {segment.venueName}
            {segment.address && ` · ${segment.address}`}
          </p>
        )}

        {/* Hotel breakfast */}
        {isHotel && segment.breakfastIncluded !== undefined && (
          <p
            className="mt-1 flex items-center gap-1 text-sm"
            style={{ color: segment.breakfastIncluded ? "var(--status-ok-fg)" : "var(--muted-foreground)" }}
          >
            <Coffee className="h-3 w-3 shrink-0" />
            {segment.breakfastIncluded ? "Breakfast included" : "Breakfast not included"}
          </p>
        )}

        {/* Restaurant details */}
        {isRestaurant && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {segment.partySize && (
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3 shrink-0" />
                Party of {segment.partySize}
              </span>
            )}
            {segment.creditCardHold && (
              <span className="flex items-center gap-1">
                <CreditCard className="h-3 w-3 shrink-0" />
                CC hold
                {segment.cancellationDeadline && (
                  <span style={{ color: "var(--status-warn-fg)" }}>
                    · cancel by {fmtDate(segment.cancellationDeadline)}
                  </span>
                )}
              </span>
            )}
          </div>
        )}

        {/* Phone (restaurants + car service) */}
        {(isRestaurant || isCarService) && segment.phone && (
          <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
            <Phone className="h-3 w-3 shrink-0" />
            <a href={`tel:${segment.phone}`} className="hover:text-foreground hover:underline">
              {segment.phone}
            </a>
          </p>
        )}

        {/* Car service driver contact */}
        {isCarService && segment.contactName && (
          <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
            <UserRound className="h-3 w-3 shrink-0" />
            Driver: {segment.contactName}
          </p>
        )}

      </div>

      {/* Actions */}
      {!readOnly && tripId && (
        <>
          <div className="flex shrink-0 gap-1 opacity-100 transition-opacity can-hover:opacity-0 can-hover:group-hover/seg:opacity-100">
            {segment.needsReview && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:opacity-80"
                style={{ color: "var(--status-ok-fg)" }}
                title="Confirm"
                onClick={() =>
                  confirmSegment.mutate(segment.id, {
                    onError: toastMutationError("confirm segment"),
                  })
                }
                disabled={confirmSegment.isPending}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              title="Edit"
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              title="Delete"
              onClick={async () => {
                const ok = await confirm({
                  title: `Delete "${segment.title}"?`,
                  confirmText: "Delete",
                  destructive: true,
                });
                if (ok)
                  deleteSegment.mutate(segment.id, {
                    onError: toastMutationError("delete segment"),
                  });
              }}
              disabled={deleteSegment.isPending}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <EditSegmentDialog
            tripId={tripId}
            segment={segment}
            date={date}
            tripStartDate={tripStartDate}
            tripEndDate={tripEndDate}
            open={editOpen}
            onOpenChange={setEditOpen}
          />
        </>
      )}
    </div>
  );
}

function EditableCity({
  tripId,
  date,
  city,
}: {
  tripId: string;
  date: string;
  city: string;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(city);
  const updateDay = useUpdateDay(tripId);

  const save = () => {
    setEditing(false);
    if (value !== city) {
      updateDay.mutate(
        { date, city: value },
        {
          onError: toastMutationError("update city"),
        },
      );
    }
  };

  if (editing) {
    return (
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-6 w-28 px-1.5 text-sm"
          autoFocus
        />
        <Button
          type="submit"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          disabled={updateDay.isPending}
        >
          <Check className="h-3 w-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => {
            setValue(city);
            setEditing(false);
          }}
        >
          <X className="h-3 w-3" />
        </Button>
      </form>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      title="Edit city"
    >
      <MapPin className="h-3 w-3" />
      {city || "Set city"}
      <Pencil className="ml-0.5 h-2.5 w-2.5 opacity-100 transition-opacity can-hover:opacity-0 can-hover:group-hover/day:opacity-100" />
    </button>
  );
}

export function ItineraryDay({
  day,
  tripId,
  tripStartDate,
  tripEndDate,
  ongoingStays,
  readOnly,
  showCosts = true,
}: {
  day: TripDay;
  tripId?: string;
  /** Owning trip's date range — passed through to AddSegmentDialog so the
   *  Date picker is clamped with min/max client-side. */
  tripStartDate?: string;
  tripEndDate?: string;
  /** Segments whose check-in is on an earlier day and check-out is on a
   *  later day — rendered as a slim "Still at …" banner above the day's
   *  own segments so users on a multi-night hotel stay don't see an
   *  empty "No activities planned." day. */
  ongoingStays?: ReadonlyArray<{ segment: Segment; nightIndex: number; totalNights: number }>;
  readOnly?: boolean;
  /**
   * When false, hide inline per-segment cost. Used by the contributor
   * view of a shared trip with `showCosts: false`. Defaults true so
   * owned-trip rendering is unchanged.
   */
  showCosts?: boolean;
}): React.JSX.Element | null {
  const segments = [...day.segments].sort((a, b) => {
    if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
    if (a.startTime) return -1;
    if (b.startTime) return 1;
    return a.sortOrder - b.sortOrder;
  });

  const dateLabel = new Date(day.date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return (
    <div className="group/day" data-day-date={day.date}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h3 className="text-base font-semibold">
            {day.dayOfWeek}, {dateLabel}
          </h3>
          {!readOnly && tripId ? (
            <EditableCity tripId={tripId} date={day.date} city={day.city} />
          ) : (
            day.city && (
              <span className="flex items-center gap-1 text-sm text-muted-foreground">
                <MapPin className="h-3 w-3" />
                {day.city}
              </span>
            )
          )}
        </div>
        {!readOnly && tripId && (
          <AddSegmentDialog
            tripId={tripId}
            date={day.date}
            tripStartDate={tripStartDate}
            tripEndDate={tripEndDate}
          />
        )}
      </div>

      {/* Ongoing multi-night stays (hotels, car rentals, cruises) whose
          check-in is earlier and check-out is later. Slim banner so the
          day doesn't look empty when the user is mid-stay. */}
      {ongoingStays && ongoingStays.length > 0 && (
        <div className="mb-2 flex flex-col gap-1">
          {ongoingStays.map((stay) => {
            const segConfig =
              SEGMENT_CONFIG[stay.segment.type] ?? SEGMENT_CONFIG.activity;
            return (
              <div
                key={stay.segment.id}
                className="flex items-center gap-2 rounded-md border border-l-4 bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground"
                style={{ borderLeftColor: `var(--seg-${segConfig.token}-rail)` }}
                title={`Continuation of ${stay.segment.title}`}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                  style={segmentTileStyle(segConfig.token)}
                >
                  <segConfig.icon className="h-3 w-3" />
                </span>
                <span className="min-w-0 flex-1 truncate">
                  Still at <span className="font-medium text-foreground">{stay.segment.title}</span>
                </span>
                <span className="shrink-0 text-[10px] uppercase tracking-wider">
                  Night {stay.nightIndex} of {stay.totalNights}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {segments.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          No activities planned.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {segments.map((seg) => (
            <SegmentRow
              key={seg.id}
              segment={seg}
              date={day.date}
              tripId={tripId}
              tripStartDate={tripStartDate}
              tripEndDate={tripEndDate}
              readOnly={readOnly}
              showCosts={showCosts}
            />
          ))}
        </div>
      )}
    </div>
  );
}
