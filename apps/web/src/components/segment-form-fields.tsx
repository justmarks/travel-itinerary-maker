"use client";

import { addDays } from "@travel-app/shared";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Default "end date" for a new segment when the user hasn't picked one yet.
 * Keeps the control populated instead of blank so a one-night hotel or a
 * multi-day cruise saves sensible values even if the user never touches the
 * field.
 */
export function defaultEndDate(type: string, startDate: string): string {
  if (!startDate) return "";
  if (type === "hotel") return addDays(startDate, 1);
  if (type === "cruise") return addDays(startDate, 3);
  return startDate;
}

// ─── Organized type groups with category headers ────────────────────────────

export const SEGMENT_TYPE_GROUPS = [
  {
    label: "Transport",
    items: [
      { value: "flight", label: "Flight" },
      { value: "train", label: "Train" },
      { value: "car_rental", label: "Car Rental" },
      { value: "car_service", label: "Car Service" },
      { value: "other_transport", label: "Other Transport" },
    ],
  },
  {
    label: "Lodging",
    items: [{ value: "hotel", label: "Hotel" }],
  },
  {
    label: "Dining",
    items: [
      { value: "restaurant_breakfast", label: "Breakfast" },
      { value: "restaurant_brunch", label: "Brunch" },
      { value: "restaurant_lunch", label: "Lunch" },
      { value: "restaurant_dinner", label: "Dinner" },
    ],
  },
  {
    label: "Activities",
    items: [
      { value: "activity", label: "Activity" },
      { value: "show", label: "Show" },
      { value: "tour", label: "Tour" },
      { value: "cruise", label: "Cruise" },
    ],
  },
];

export const SEGMENT_TYPE_LABELS: Record<string, string> = {};
for (const group of SEGMENT_TYPE_GROUPS) {
  for (const item of group.items) {
    SEGMENT_TYPE_LABELS[item.value] = item.label;
  }
}

// ─── Type helpers ───────────────────────────────────────────────────────────

const RESTAURANT_TYPES = new Set([
  "restaurant_breakfast",
  "restaurant_brunch",
  "restaurant_lunch",
  "restaurant_dinner",
]);
const TRANSPORT_TYPES = new Set(["flight", "train", "other_transport"]);

export function getTypeFlags(type: string) {
  return {
    isFlight: type === "flight",
    isTrain: type === "train",
    isHotel: type === "hotel",
    isCarRental: type === "car_rental",
    isCarService: type === "car_service",
    isRestaurant: RESTAURANT_TYPES.has(type),
    isTransport: TRANSPORT_TYPES.has(type),
    isCruise: type === "cruise",
    isShow: type === "show",
    isActivity:
      type === "activity" ||
      type === "tour" ||
      type === "cruise" ||
      type === "show",
  };
}

// ─── Form state interface ───────────────────────────────────────────────────

export interface SegmentFormState {
  type: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  venueName: string;
  address: string;
  city: string;
  url: string;
  confirmationCode: string;
  provider: string;
  departureCity: string;
  arrivalCity: string;
  carrier: string;
  routeCode: string;
  coach: string;
  partySize: string;
  creditCardHold: boolean;
  seatNumber: string;
  cabinClass: string;
  baggageInfo: string;
  contactName: string;
  phone: string;
  breakfastIncluded: boolean;
  endDate: string;
  costAmount: string;
  costCurrency: string;
  costDetails: string;
}

export const EMPTY_FORM_STATE: SegmentFormState = {
  type: "activity",
  title: "",
  date: "",
  startTime: "",
  endTime: "",
  venueName: "",
  address: "",
  city: "",
  url: "",
  confirmationCode: "",
  provider: "",
  departureCity: "",
  arrivalCity: "",
  carrier: "",
  routeCode: "",
  coach: "",
  partySize: "",
  creditCardHold: false,
  seatNumber: "",
  cabinClass: "",
  baggageInfo: "",
  contactName: "",
  phone: "",
  breakfastIncluded: false,
  endDate: "",
  costAmount: "",
  costCurrency: "USD",
  costDetails: "",
};

// ─── Type selector with grouped categories ──────────────────────────────────

export function SegmentTypeSelect({
  value,
  onValueChange,
  id,
}: {
  value: string;
  onValueChange: (v: string) => void;
  id?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {SEGMENT_TYPE_GROUPS.map((group) => (
          <SelectGroup key={group.label}>
            <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {group.label}
            </SelectLabel>
            {group.items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}

// ─── Form fields component ──────────────────────────────────────────────────

export function SegmentFormFields({
  form,
  onChange,
  idPrefix,
}: {
  form: SegmentFormState;
  onChange: (patch: Partial<SegmentFormState>) => void;
  idPrefix: string;
}) {
  const flags = getTypeFlags(form.type);
  const {
    isFlight,
    isTrain,
    isHotel,
    isCarRental,
    isCarService,
    isRestaurant,
    isTransport,
    isCruise,
    isShow,
  } = flags;
  const isOtherTransport = isTransport && !isFlight && !isTrain;

  // Which fields should be visible?
  const showVenue = !isFlight && !isTransport && !isCruise;
  const showAddress = !isFlight && !isCruise;
  const showCity = !isFlight && !isCruise;
  // Provider is hidden for:
  //   flights (carrier is shown instead)
  //   trains (carrier is shown instead)
  //   hotels (the venue *is* the provider)
  //   cruises (the cruise line shows in the title/carrier)
  //   shows (ticket issuer rarely relevant)
  //   other transport (keep the card minimal — just from/to/time)
  //   restaurants (you don't "book a meal through a provider" — the venue
  //     is the restaurant; OpenTable/Resy are booking tools, not what
  //     people want to record on an itinerary)
  const showProvider =
    !isFlight && !isTrain && !isHotel && !isShow && !isCruise && !isOtherTransport && !isRestaurant;

  return (
    <div className="space-y-4">
      {/* ── Type + Date ── */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Type</Label>
          <SegmentTypeSelect
            value={form.type}
            onValueChange={(v) => {
              const patch: Partial<SegmentFormState> = { type: v };
              // Hotels: default check-in to 3 PM and check-out to 11 AM
              // when the user picks the type. Only fills empty fields so we
              // never clobber a value the user already typed.
              if (v === "hotel") {
                if (!form.startTime) patch.startTime = "15:00";
                if (!form.endTime) patch.endTime = "11:00";
              }
              onChange(patch);
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-date`}>Date</Label>
          <Input
            id={`${idPrefix}-date`}
            type="date"
            value={form.date}
            onChange={(e) => onChange({ date: e.target.value })}
          />
        </div>
      </div>

      {/* ── Title ── */}
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-title`}>Title</Label>
        <Input
          id={`${idPrefix}-title`}
          placeholder={
            isFlight ? "e.g. SEA → NRT" :
            isHotel ? "e.g. Hilton Garden Inn" :
            isRestaurant ? "e.g. Canlis" :
            isCarRental ? "e.g. National - Lihue" :
            "e.g. City Walking Tour"
          }
          value={form.title}
          onChange={(e) => onChange({ title: e.target.value })}
          autoFocus
        />
      </div>

      {/* ── Flight fields: Route, Airline, Flight #, Cabin, Seats, Baggage ── */}
      {isFlight && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-dep-city`}>Departure city</Label>
              <Input
                id={`${idPrefix}-dep-city`}
                placeholder="e.g. Seattle"
                value={form.departureCity}
                onChange={(e) => onChange({ departureCity: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-arr-city`}>Arrival city</Label>
              <Input
                id={`${idPrefix}-arr-city`}
                placeholder="e.g. Tokyo"
                value={form.arrivalCity}
                onChange={(e) => onChange({ arrivalCity: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-carrier`}>Airline</Label>
              <Input
                id={`${idPrefix}-carrier`}
                placeholder="e.g. Alaska Airlines"
                value={form.carrier}
                onChange={(e) => onChange({ carrier: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-route`}>Flight #</Label>
              <Input
                id={`${idPrefix}-route`}
                placeholder="e.g. AS123"
                value={form.routeCode}
                onChange={(e) => onChange({ routeCode: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-start`}>Departure time</Label>
              <Input
                id={`${idPrefix}-start`}
                type="time"
                value={form.startTime}
                onChange={(e) => onChange({ startTime: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-end`}>Arrival time</Label>
              <Input
                id={`${idPrefix}-end`}
                type="time"
                value={form.endTime}
                onChange={(e) => onChange({ endTime: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-cabin`}>Cabin class</Label>
              <Input
                id={`${idPrefix}-cabin`}
                placeholder="e.g. Economy, Business"
                value={form.cabinClass}
                onChange={(e) => onChange({ cabinClass: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-seats`}>Seat(s)</Label>
              <Input
                id={`${idPrefix}-seats`}
                placeholder="e.g. 12A, 12B"
                value={form.seatNumber}
                onChange={(e) => onChange({ seatNumber: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-baggage`}>Baggage info</Label>
            <Input
              id={`${idPrefix}-baggage`}
              placeholder="e.g. 1 checked bag included"
              value={form.baggageInfo}
              onChange={(e) => onChange({ baggageInfo: e.target.value })}
            />
          </div>
        </>
      )}

      {/* ── Train ── */}
      {isTrain && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-dep-city`}>Departure station</Label>
              <Input
                id={`${idPrefix}-dep-city`}
                placeholder="e.g. Paris Gare du Nord"
                value={form.departureCity}
                onChange={(e) => onChange({ departureCity: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-arr-city`}>Arrival station</Label>
              <Input
                id={`${idPrefix}-arr-city`}
                placeholder="e.g. London St Pancras"
                value={form.arrivalCity}
                onChange={(e) => onChange({ arrivalCity: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-carrier`}>Carrier</Label>
              <Input
                id={`${idPrefix}-carrier`}
                placeholder="e.g. Eurostar"
                value={form.carrier}
                onChange={(e) => onChange({ carrier: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-route`}>Train #</Label>
              <Input
                id={`${idPrefix}-route`}
                placeholder="e.g. ES 9024"
                value={form.routeCode}
                onChange={(e) => onChange({ routeCode: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-start`}>Departure time</Label>
              <Input
                id={`${idPrefix}-start`}
                type="time"
                value={form.startTime}
                onChange={(e) => onChange({ startTime: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-end`}>Arrival time</Label>
              <Input
                id={`${idPrefix}-end`}
                type="time"
                value={form.endTime}
                onChange={(e) => onChange({ endTime: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-coach`}>Coach</Label>
              <Input
                id={`${idPrefix}-coach`}
                placeholder="e.g. Coach 14"
                value={form.coach}
                onChange={(e) => onChange({ coach: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-seats`}>Seat(s)</Label>
              <Input
                id={`${idPrefix}-seats`}
                placeholder="e.g. 23A, 23B"
                value={form.seatNumber}
                onChange={(e) => onChange({ seatNumber: e.target.value })}
              />
            </div>
          </div>
        </>
      )}

      {/* ── Other transport (non-flight, non-train) ── */}
      {isTransport && !isFlight && !isTrain && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-dep-city`}>Departure city</Label>
              <Input
                id={`${idPrefix}-dep-city`}
                placeholder="e.g. Paris"
                value={form.departureCity}
                onChange={(e) => onChange({ departureCity: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-arr-city`}>Arrival city</Label>
              <Input
                id={`${idPrefix}-arr-city`}
                placeholder="e.g. London"
                value={form.arrivalCity}
                onChange={(e) => onChange({ arrivalCity: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-carrier`}>Carrier (optional)</Label>
            <Input
              id={`${idPrefix}-carrier`}
              placeholder="Optional"
              value={form.carrier}
              onChange={(e) => onChange({ carrier: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-start`}>Departure time</Label>
              <Input
                id={`${idPrefix}-start`}
                type="time"
                value={form.startTime}
                onChange={(e) => onChange({ startTime: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-end`}>Arrival time</Label>
              <Input
                id={`${idPrefix}-end`}
                type="time"
                value={form.endTime}
                onChange={(e) => onChange({ endTime: e.target.value })}
              />
            </div>
          </div>
        </>
      )}

      {/* ── Hotel fields ── */}
      {isHotel && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-venue`}>Hotel name</Label>
              <Input
                id={`${idPrefix}-venue`}
                placeholder="e.g. Marriott Waikiki"
                value={form.venueName}
                onChange={(e) => onChange({ venueName: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-city`}>City</Label>
              <Input
                id={`${idPrefix}-city`}
                placeholder="e.g. Honolulu"
                value={form.city}
                onChange={(e) => onChange({ city: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-address`}>Address</Label>
            <Input
              id={`${idPrefix}-address`}
              placeholder="Optional"
              value={form.address}
              onChange={(e) => onChange({ address: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-start`}>Check-in time</Label>
              <Input
                id={`${idPrefix}-start`}
                type="time"
                value={form.startTime}
                onChange={(e) => onChange({ startTime: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-end`}>Check-out time</Label>
              <Input
                id={`${idPrefix}-end`}
                type="time"
                value={form.endTime}
                onChange={(e) => onChange({ endTime: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-end-date`}>Check-out date</Label>
            <Input
              id={`${idPrefix}-end-date`}
              type="date"
              value={form.endDate || defaultEndDate("hotel", form.date)}
              onChange={(e) => onChange({ endDate: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.breakfastIncluded}
                onChange={(e) => onChange({ breakfastIncluded: e.target.checked })}
                className="rounded"
              />
              Breakfast included
            </label>
          </div>
        </>
      )}

      {/* ── Car rental fields ── */}
      {isCarRental && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-dep-city`}>Pickup city</Label>
              <Input
                id={`${idPrefix}-dep-city`}
                placeholder="e.g. Lihue"
                value={form.departureCity}
                onChange={(e) => onChange({ departureCity: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-arr-city`}>Dropoff city</Label>
              <Input
                id={`${idPrefix}-arr-city`}
                placeholder="e.g. Lihue"
                value={form.arrivalCity}
                onChange={(e) => onChange({ arrivalCity: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-start`}>Pickup time</Label>
              <Input
                id={`${idPrefix}-start`}
                type="time"
                value={form.startTime}
                onChange={(e) => onChange({ startTime: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-end`}>Dropoff time</Label>
              <Input
                id={`${idPrefix}-end`}
                type="time"
                value={form.endTime}
                onChange={(e) => onChange({ endTime: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-end-date`}>Dropoff date</Label>
            <Input
              id={`${idPrefix}-end-date`}
              type="date"
              value={form.endDate || defaultEndDate("car_rental", form.date)}
              onChange={(e) => onChange({ endDate: e.target.value })}
            />
          </div>
        </>
      )}

      {/* ── Car service fields ── */}
      {isCarService && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-start`}>Pickup time</Label>
              <Input
                id={`${idPrefix}-start`}
                type="time"
                value={form.startTime}
                onChange={(e) => onChange({ startTime: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-city`}>City</Label>
              <Input
                id={`${idPrefix}-city`}
                placeholder="e.g. Tokyo"
                value={form.city}
                onChange={(e) => onChange({ city: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-contact`}>Driver name</Label>
              <Input
                id={`${idPrefix}-contact`}
                placeholder="Optional"
                value={form.contactName}
                onChange={(e) => onChange({ contactName: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-phone`}>Phone</Label>
              <Input
                id={`${idPrefix}-phone`}
                type="tel"
                placeholder="Optional"
                value={form.phone}
                onChange={(e) => onChange({ phone: e.target.value })}
              />
            </div>
          </div>
        </>
      )}

      {/* ── Restaurant fields ── */}
      {isRestaurant && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-venue`}>Restaurant name</Label>
              <Input
                id={`${idPrefix}-venue`}
                placeholder="e.g. Canlis"
                value={form.venueName}
                onChange={(e) => onChange({ venueName: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-city`}>City</Label>
              <Input
                id={`${idPrefix}-city`}
                placeholder="e.g. Seattle"
                value={form.city}
                onChange={(e) => onChange({ city: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-address`}>Address</Label>
            <Input
              id={`${idPrefix}-address`}
              placeholder="Optional"
              value={form.address}
              onChange={(e) => onChange({ address: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-start`}>Reservation time</Label>
              <Input
                id={`${idPrefix}-start`}
                type="time"
                value={form.startTime}
                onChange={(e) => onChange({ startTime: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-party`}>Party size</Label>
              <Input
                id={`${idPrefix}-party`}
                type="number"
                min="1"
                placeholder="e.g. 4"
                value={form.partySize}
                onChange={(e) => onChange({ partySize: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-phone`}>Phone</Label>
              <Input
                id={`${idPrefix}-phone`}
                type="tel"
                placeholder="Optional"
                value={form.phone}
                onChange={(e) => onChange({ phone: e.target.value })}
              />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.creditCardHold}
                  onChange={(e) => onChange({ creditCardHold: e.target.checked })}
                  className="rounded"
                />
                CC hold required
              </label>
            </div>
          </div>
        </>
      )}

      {/* ── Cruise: departure/arrival ports, boarding/disembark times ── */}
      {isCruise && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-dep-city`}>Boarding city</Label>
              <Input
                id={`${idPrefix}-dep-city`}
                placeholder="e.g. Port Canaveral"
                value={form.departureCity}
                onChange={(e) => onChange({ departureCity: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-arr-city`}>Disembark city</Label>
              <Input
                id={`${idPrefix}-arr-city`}
                placeholder="e.g. Port Canaveral"
                value={form.arrivalCity}
                onChange={(e) => onChange({ arrivalCity: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-start`}>Boarding time</Label>
              <Input
                id={`${idPrefix}-start`}
                type="time"
                value={form.startTime}
                onChange={(e) => onChange({ startTime: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-end`}>Disembark time</Label>
              <Input
                id={`${idPrefix}-end`}
                type="time"
                value={form.endTime}
                onChange={(e) => onChange({ endTime: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-end-date`}>Disembark date</Label>
            <Input
              id={`${idPrefix}-end-date`}
              type="date"
              value={form.endDate || defaultEndDate("cruise", form.date)}
              onChange={(e) => onChange({ endDate: e.target.value })}
            />
          </div>
        </>
      )}

      {/* ── Activity / Show / Tour: generic fields ── */}
      {!isFlight && !isHotel && !isCarRental && !isCarService && !isRestaurant && !isTransport && !isCruise && (
        <>
          {showVenue && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor={`${idPrefix}-venue`}>Venue</Label>
                <Input
                  id={`${idPrefix}-venue`}
                  placeholder={
                    isShow ? "e.g. Royal Albert Hall" : "Optional"
                  }
                  value={form.venueName}
                  onChange={(e) => onChange({ venueName: e.target.value })}
                />
              </div>
              {showCity && (
                <div className="space-y-2">
                  <Label htmlFor={`${idPrefix}-city`}>City</Label>
                  <Input
                    id={`${idPrefix}-city`}
                    placeholder="e.g. Tokyo"
                    value={form.city}
                    onChange={(e) => onChange({ city: e.target.value })}
                  />
                </div>
              )}
            </div>
          )}
          {showAddress && (
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-address`}>Address</Label>
              <Input
                id={`${idPrefix}-address`}
                placeholder="Optional"
                value={form.address}
                onChange={(e) => onChange({ address: e.target.value })}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-start`}>Start time</Label>
              <Input
                id={`${idPrefix}-start`}
                type="time"
                value={form.startTime}
                onChange={(e) => onChange({ startTime: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${idPrefix}-end`}>End time</Label>
              <Input
                id={`${idPrefix}-end`}
                type="time"
                value={form.endTime}
                onChange={(e) => onChange({ endTime: e.target.value })}
              />
            </div>
          </div>
        </>
      )}

      {/* ── Common booking fields ── */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-conf`}>Confirmation #</Label>
          <Input
            id={`${idPrefix}-conf`}
            placeholder="Optional"
            value={form.confirmationCode}
            onChange={(e) => onChange({ confirmationCode: e.target.value })}
          />
        </div>
        {showProvider && (
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-provider`}>Provider</Label>
            <Input
              id={`${idPrefix}-provider`}
              placeholder="e.g. Expedia, Direct"
              value={form.provider}
              onChange={(e) => onChange({ provider: e.target.value })}
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-url`}>URL</Label>
        <Input
          id={`${idPrefix}-url`}
          type="url"
          placeholder="https://..."
          value={form.url}
          onChange={(e) => onChange({ url: e.target.value })}
        />
      </div>

      {/* ── Cost ── */}
      <div className="grid grid-cols-4 gap-4">
        <div className="col-span-2 space-y-2">
          <Label htmlFor={`${idPrefix}-cost`}>
            {isHotel ? "Room rate" : "Cost"}
          </Label>
          <Input
            id={`${idPrefix}-cost`}
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={form.costAmount}
            onChange={(e) => onChange({ costAmount: e.target.value })}
          />
        </div>
        <div className="col-span-2 space-y-2">
          <Label>Currency</Label>
          <Select
            value={form.costCurrency}
            onValueChange={(v) => onChange({ costCurrency: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="USD">USD</SelectItem>
              <SelectItem value="EUR">EUR</SelectItem>
              <SelectItem value="GBP">GBP</SelectItem>
              <SelectItem value="JPY">JPY</SelectItem>
              <SelectItem value="points">Points</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ── Details — always last, multi-line ── */}
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-details`}>Details</Label>
        <Textarea
          id={`${idPrefix}-details`}
          placeholder={
            isHotel
              ? "e.g. 2 Bedroom Villa, 2 Bathrooms. Parking $30/night. Resort fee $45/night."
              : isFlight
              ? "e.g. Premium Economy, 2 checked bags included"
              : isCarRental
              ? "e.g. Midsize SUV, GPS included"
              : "Additional notes..."
          }
          value={form.costDetails}
          onChange={(e) => onChange({ costDetails: e.target.value })}
          rows={2}
          className="resize-none"
        />
      </div>
    </div>
  );
}
