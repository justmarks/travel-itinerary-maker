"use client";

import { useState, useEffect } from "react";
import { useUpdateSegment } from "@travel-app/api-client";
import type { Segment, SegmentType } from "@travel-app/shared";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";

const SEGMENT_TYPE_LABELS: Record<string, string> = {
  flight: "Flight",
  train: "Train",
  car_rental: "Car Rental",
  car_service: "Car Service",
  other_transport: "Other Transport",
  hotel: "Hotel",
  activity: "Activity",
  restaurant_breakfast: "Breakfast",
  restaurant_brunch: "Brunch",
  restaurant_lunch: "Lunch",
  restaurant_dinner: "Dinner",
  tour: "Tour",
  cruise: "Cruise",
};

const SEGMENT_TYPES = Object.keys(SEGMENT_TYPE_LABELS);

const RESTAURANT_TYPES = new Set([
  "restaurant_breakfast",
  "restaurant_brunch",
  "restaurant_lunch",
  "restaurant_dinner",
]);
const TRANSPORT_TYPES = new Set(["flight", "train", "other_transport"]);

export function EditSegmentDialog({
  tripId,
  segment,
  open,
  onOpenChange,
}: {
  tripId: string;
  segment: Segment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [type, setType] = useState(segment.type as string);
  const [title, setTitle] = useState(segment.title);
  const [startTime, setStartTime] = useState(segment.startTime ?? "");
  const [endTime, setEndTime] = useState(segment.endTime ?? "");
  const [venueName, setVenueName] = useState(segment.venueName ?? "");
  const [address, setAddress] = useState(segment.address ?? "");
  const [city, setCity] = useState(segment.city ?? "");
  const [url, setUrl] = useState(segment.url ?? "");
  const [confirmationCode, setConfirmationCode] = useState(
    segment.confirmationCode ?? "",
  );
  const [provider, setProvider] = useState(segment.provider ?? "");
  const [departureCity, setDepartureCity] = useState(
    segment.departureCity ?? "",
  );
  const [arrivalCity, setArrivalCity] = useState(segment.arrivalCity ?? "");
  const [carrier, setCarrier] = useState(segment.carrier ?? "");
  const [routeCode, setRouteCode] = useState(segment.routeCode ?? "");
  const [partySize, setPartySize] = useState(
    segment.partySize?.toString() ?? "",
  );
  const [creditCardHold, setCreditCardHold] = useState(
    segment.creditCardHold ?? false,
  );
  const [seatNumber, setSeatNumber] = useState(segment.seatNumber ?? "");
  const [cabinClass, setCabinClass] = useState(segment.cabinClass ?? "");
  const [baggageInfo, setBaggageInfo] = useState(segment.baggageInfo ?? "");
  const [contactName, setContactName] = useState(segment.contactName ?? "");
  const [phone, setPhone] = useState(segment.phone ?? "");
  const [breakfastIncluded, setBreakfastIncluded] = useState(
    segment.breakfastIncluded ?? false,
  );
  const [costAmount, setCostAmount] = useState(
    segment.cost?.amount?.toString() ?? "",
  );
  const [costCurrency, setCostCurrency] = useState(
    segment.cost?.currency ?? "USD",
  );
  const [costDetails, setCostDetails] = useState(
    segment.cost?.details ?? "",
  );

  const updateSegment = useUpdateSegment(tripId);

  // Reset form when segment changes (e.g. dialog re-opened for different segment)
  useEffect(() => {
    if (open) {
      setType(segment.type);
      setTitle(segment.title);
      setStartTime(segment.startTime ?? "");
      setEndTime(segment.endTime ?? "");
      setVenueName(segment.venueName ?? "");
      setAddress(segment.address ?? "");
      setCity(segment.city ?? "");
      setUrl(segment.url ?? "");
      setConfirmationCode(segment.confirmationCode ?? "");
      setProvider(segment.provider ?? "");
      setDepartureCity(segment.departureCity ?? "");
      setArrivalCity(segment.arrivalCity ?? "");
      setCarrier(segment.carrier ?? "");
      setRouteCode(segment.routeCode ?? "");
      setPartySize(segment.partySize?.toString() ?? "");
      setCreditCardHold(segment.creditCardHold ?? false);
      setSeatNumber(segment.seatNumber ?? "");
      setCabinClass(segment.cabinClass ?? "");
      setBaggageInfo(segment.baggageInfo ?? "");
      setContactName(segment.contactName ?? "");
      setPhone(segment.phone ?? "");
      setBreakfastIncluded(segment.breakfastIncluded ?? false);
      setCostAmount(segment.cost?.amount?.toString() ?? "");
      setCostCurrency(segment.cost?.currency ?? "USD");
      setCostDetails(segment.cost?.details ?? "");
    }
  }, [open, segment]);

  const isTransport = TRANSPORT_TYPES.has(type);
  const isFlight = type === "flight";
  const isHotel = type === "hotel";
  const isRestaurant = RESTAURANT_TYPES.has(type);
  const isCarService = type === "car_service";
  const isCarRental = type === "car_rental";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const cost =
      costAmount && parseFloat(costAmount) >= 0
        ? {
            amount: parseFloat(costAmount),
            currency: costCurrency,
            details: costDetails || undefined,
          }
        : undefined;

    const updates: Record<string, unknown> = {
      segmentId: segment.id,
      type: type as SegmentType,
      title,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      venueName: venueName || undefined,
      address: address || undefined,
      city: city || undefined,
      url: url || undefined,
      confirmationCode: confirmationCode || undefined,
      provider: provider || undefined,
      cost,
    };

    // Transport fields
    if (isTransport || isCarRental) {
      updates.departureCity = departureCity || undefined;
      updates.arrivalCity = arrivalCity || undefined;
    }
    if (isTransport) {
      updates.carrier = carrier || undefined;
      updates.routeCode = routeCode || undefined;
    }

    // Flight fields
    if (isFlight) {
      updates.seatNumber = seatNumber || undefined;
      updates.cabinClass = cabinClass || undefined;
      updates.baggageInfo = baggageInfo || undefined;
    }

    // Restaurant fields
    if (isRestaurant) {
      updates.partySize = partySize ? parseInt(partySize, 10) : undefined;
      updates.creditCardHold = creditCardHold || undefined;
      updates.phone = phone || undefined;
    }

    // Hotel fields
    if (isHotel) {
      updates.breakfastIncluded = breakfastIncluded || undefined;
    }

    // Car service fields
    if (isCarService) {
      updates.contactName = contactName || undefined;
      updates.phone = phone || undefined;
    }

    updateSegment.mutate(updates as Parameters<typeof updateSegment.mutate>[0], {
      onSuccess: () => onOpenChange(false),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit segment</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type + Title */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEGMENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {SEGMENT_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-title">Title</Label>
              <Input
                id="edit-title"
                placeholder="e.g. Hilton Garden Inn"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </div>
          </div>

          {/* Times */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-start">
                {isHotel ? "Check-in time" : "Start time"}
              </Label>
              <Input
                id="edit-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-end">
                {isHotel ? "Check-out time" : "End time"}
              </Label>
              <Input
                id="edit-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>

          {/* Transport route fields */}
          {(isTransport || isCarRental) && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-dep-city">
                  {isCarRental ? "Pickup city" : "Departure city"}
                </Label>
                <Input
                  id="edit-dep-city"
                  placeholder="e.g. Seattle"
                  value={departureCity}
                  onChange={(e) => setDepartureCity(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-arr-city">
                  {isCarRental ? "Dropoff city" : "Arrival city"}
                </Label>
                <Input
                  id="edit-arr-city"
                  placeholder="e.g. London"
                  value={arrivalCity}
                  onChange={(e) => setArrivalCity(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Carrier + Route code (flights/trains) */}
          {isTransport && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-carrier">Carrier</Label>
                <Input
                  id="edit-carrier"
                  placeholder="e.g. BA, AS"
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-route">
                  {isFlight ? "Flight #" : "Route code"}
                </Label>
                <Input
                  id="edit-route"
                  placeholder={isFlight ? "e.g. AS123" : "e.g. Amtrak 501"}
                  value={routeCode}
                  onChange={(e) => setRouteCode(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Flight-specific: cabin, seats, baggage */}
          {isFlight && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-cabin">Cabin class</Label>
                  <Input
                    id="edit-cabin"
                    placeholder="e.g. Economy, Business"
                    value={cabinClass}
                    onChange={(e) => setCabinClass(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-seats">Seat(s)</Label>
                  <Input
                    id="edit-seats"
                    placeholder="e.g. 12A, 12B"
                    value={seatNumber}
                    onChange={(e) => setSeatNumber(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-baggage">Baggage info</Label>
                <Input
                  id="edit-baggage"
                  placeholder="e.g. 1 checked bag included"
                  value={baggageInfo}
                  onChange={(e) => setBaggageInfo(e.target.value)}
                />
              </div>
            </>
          )}

          {/* Venue / Address / City */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-venue">Venue name</Label>
              <Input
                id="edit-venue"
                placeholder="Optional"
                value={venueName}
                onChange={(e) => setVenueName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-city">City</Label>
              <Input
                id="edit-city"
                placeholder="e.g. Tokyo"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-address">Address</Label>
            <Input
              id="edit-address"
              placeholder="Optional"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>

          {/* Booking details */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-conf">Confirmation #</Label>
              <Input
                id="edit-conf"
                placeholder="Optional"
                value={confirmationCode}
                onChange={(e) => setConfirmationCode(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-provider">Provider</Label>
              <Input
                id="edit-provider"
                placeholder="e.g. Expedia, Direct"
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-url">URL</Label>
            <Input
              id="edit-url"
              type="url"
              placeholder="https://..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>

          {/* Restaurant-specific fields */}
          {isRestaurant && (
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-party">Party size</Label>
                <Input
                  id="edit-party"
                  type="number"
                  min="1"
                  value={partySize}
                  onChange={(e) => setPartySize(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-phone">Phone</Label>
                <Input
                  id="edit-phone"
                  type="tel"
                  placeholder="Optional"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <div className="flex items-end space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={creditCardHold}
                    onChange={(e) => setCreditCardHold(e.target.checked)}
                    className="rounded"
                  />
                  CC hold
                </label>
              </div>
            </div>
          )}

          {/* Hotel-specific: breakfast included */}
          {isHotel && (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={breakfastIncluded}
                  onChange={(e) => setBreakfastIncluded(e.target.checked)}
                  className="rounded"
                />
                Breakfast included
              </label>
            </div>
          )}

          {/* Car service: contact + phone */}
          {isCarService && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-contact">Driver name</Label>
                <Input
                  id="edit-contact"
                  placeholder="Optional"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-cs-phone">Phone</Label>
                <Input
                  id="edit-cs-phone"
                  type="tel"
                  placeholder="Optional"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Cost */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-cost">Cost</Label>
              <Input
                id="edit-cost"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={costAmount}
                onChange={(e) => setCostAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select value={costCurrency} onValueChange={setCostCurrency}>
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
            <div className="space-y-2">
              <Label htmlFor="edit-cost-details">Details</Label>
              <Input
                id="edit-cost-details"
                placeholder="e.g. Economy, Queen Room"
                value={costDetails}
                onChange={(e) => setCostDetails(e.target.value)}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!title.trim() || updateSegment.isPending}
            >
              {updateSegment.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
