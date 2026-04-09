"use client";

import { useState } from "react";
import type { TripDay, Segment } from "@travel-app/shared";
import {
  useDeleteSegment,
  useConfirmSegment,
  useUpdateDay,
} from "@travel-app/api-client";
import {
  Plane,
  Train,
  Car,
  BedDouble,
  MapPin,
  UtensilsCrossed,
  Camera,
  Ship,
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
import { cn } from "@/lib/utils";

const RESTAURANT_TYPES = new Set(["restaurant_breakfast", "restaurant_brunch", "restaurant_lunch", "restaurant_dinner"]);
const HOTEL_TYPES = new Set(["hotel"]);
const FLIGHT_TYPES = new Set(["flight"]);
const CAR_RENTAL_TYPES = new Set(["car_rental"]);
const CAR_SERVICE_TYPES = new Set(["car_service"]);

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

type SegmentConfig = {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  color: string;
};

const SEGMENT_CONFIG: Record<string, SegmentConfig> = {
  flight:            { icon: Plane,           label: "Flight",      color: "text-blue-500"   },
  train:             { icon: Train,           label: "Train",       color: "text-purple-500" },
  car_rental:        { icon: Car,             label: "Car Rental",  color: "text-orange-500" },
  car_service:       { icon: Car,             label: "Car Service", color: "text-orange-500" },
  other_transport:   { icon: Navigation,      label: "Transport",   color: "text-gray-500"   },
  hotel:             { icon: BedDouble,       label: "Hotel",       color: "text-indigo-500" },
  activity:               { icon: MapPin,          label: "Activity",   color: "text-green-500"  },
  restaurant_breakfast:   { icon: UtensilsCrossed, label: "Breakfast",  color: "text-sky-500"    },
  restaurant_brunch:      { icon: UtensilsCrossed, label: "Brunch",     color: "text-lime-500"   },
  restaurant_lunch:       { icon: UtensilsCrossed, label: "Lunch",      color: "text-amber-500"  },
  restaurant_dinner:      { icon: UtensilsCrossed, label: "Dinner",     color: "text-red-500"    },
  tour:              { icon: Camera,          label: "Tour",        color: "text-teal-500"   },
  cruise:            { icon: Ship,            label: "Cruise",      color: "text-cyan-500"   },
};

function SegmentRow({
  segment,
  tripId,
  readOnly,
}: {
  segment: Segment;
  tripId?: string;
  readOnly?: boolean;
}) {
  const deleteSegment = useDeleteSegment(tripId ?? "");
  const confirmSegment = useConfirmSegment(tripId ?? "");
  const config = SEGMENT_CONFIG[segment.type] ?? SEGMENT_CONFIG.activity;
  const Icon = config.icon;
  const cost = formatCost(segment.cost);
  const isRestaurant = RESTAURANT_TYPES.has(segment.type);
  const isHotel = HOTEL_TYPES.has(segment.type);
  const isFlight = FLIGHT_TYPES.has(segment.type);
  const isCarRental = CAR_RENTAL_TYPES.has(segment.type);
  const isCarService = CAR_SERVICE_TYPES.has(segment.type);

  const startTime = fmt12h(segment.startTime);
  const endTime = fmt12h(segment.endTime);

  return (
    <div className="group/seg flex items-start gap-3 rounded-lg border bg-card px-4 py-3">
      <div className={cn("mt-0.5 shrink-0", config.color)}>
        <Icon className="h-4 w-4" />
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
              {segment.title}
            </a>
          ) : (
            <span className="font-medium leading-snug">{segment.title}</span>
          )}
          {segment.needsReview && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 px-2 py-0.5 text-xs text-amber-600">
              <AlertCircle className="h-3 w-3" />
              Review
            </span>
          )}
          {segment.source === "email_confirmed" && (
            <span className="inline-flex items-center gap-1 rounded-full border border-green-300 px-2 py-0.5 text-xs text-green-600">
              <CheckCircle2 className="h-3 w-3" />
              Confirmed
            </span>
          )}
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
              </>
            ) : isCarRental ? (
              <span>{startTime || endTime}</span>
            ) : (
              <span>{startTime}{endTime ? ` – ${endTime}` : ""}</span>
            )}
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

        {/* Route info (flights / trains / transport) */}
        {segment.departureCity && segment.arrivalCity && (
          <p className="mt-1 text-sm text-muted-foreground">
            {segment.departureCity} → {segment.arrivalCity}
            {segment.carrier && ` · ${segment.carrier}`}
            {segment.routeCode && ` ${segment.routeCode}`}
          </p>
        )}

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

        {/* Venue / address */}
        {segment.venueName && (
          <p className="mt-1 text-sm text-muted-foreground">
            {segment.venueName}
            {segment.address && ` · ${segment.address}`}
          </p>
        )}

        {/* Hotel breakfast */}
        {isHotel && segment.breakfastIncluded !== undefined && (
          <p className={cn("mt-1 flex items-center gap-1 text-sm", segment.breakfastIncluded ? "text-green-600" : "text-muted-foreground")}>
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
                  <span className="text-amber-600">
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
        <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover/seg:opacity-100">
          {segment.needsReview && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-green-600 hover:text-green-700"
              title="Confirm"
              onClick={() => confirmSegment.mutate(segment.id)}
              disabled={confirmSegment.isPending}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            title="Delete"
            onClick={() => {
              if (confirm(`Delete "${segment.title}"?`)) {
                deleteSegment.mutate(segment.id);
              }
            }}
            disabled={deleteSegment.isPending}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
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
    updateDay.mutate(
      { date, city: value },
      { onSuccess: () => setEditing(false) },
    );
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
      <Pencil className="ml-0.5 h-2.5 w-2.5 opacity-0 transition-opacity group-hover/day:opacity-100" />
    </button>
  );
}

export function ItineraryDay({
  day,
  tripId,
  readOnly,
}: {
  day: TripDay;
  tripId?: string;
  readOnly?: boolean;
}) {
  const segments = [...day.segments].sort((a, b) => {
    if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
    return a.sortOrder - b.sortOrder;
  });

  const dateLabel = new Date(day.date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return (
    <div className="group/day">
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
          <AddSegmentDialog tripId={tripId} date={day.date} />
        )}
      </div>

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
              tripId={tripId}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}
    </div>
  );
}
