"use client";

import { useState, useEffect, useCallback } from "react";
import { useUpdateSegment } from "@travel-app/api-client";
import type { Segment, SegmentType } from "@travel-app/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import {
  SegmentFormFields,
  getTypeFlags,
  defaultEndDate,
  type SegmentFormState,
} from "@/components/segment-form-fields";

function segmentToFormState(
  segment: Segment,
  date: string,
): SegmentFormState {
  return {
    type: segment.type,
    title: segment.title,
    date,
    startTime: segment.startTime ?? "",
    endTime: segment.endTime ?? "",
    venueName: segment.venueName ?? "",
    address: segment.address ?? "",
    city: segment.city ?? "",
    url: segment.url ?? "",
    confirmationCode: segment.confirmationCode ?? "",
    provider: segment.provider ?? "",
    departureCity: segment.departureCity ?? "",
    arrivalCity: segment.arrivalCity ?? "",
    departureAirport: segment.departureAirport ?? "",
    arrivalAirport: segment.arrivalAirport ?? "",
    carrier: segment.carrier ?? "",
    routeCode: segment.routeCode ?? "",
    coach: segment.coach ?? "",
    partySize: segment.partySize?.toString() ?? "",
    creditCardHold: segment.creditCardHold ?? false,
    seatNumber: segment.seatNumber ?? "",
    cabinClass: segment.cabinClass ?? "",
    baggageInfo: segment.baggageInfo ?? "",
    contactName: segment.contactName ?? "",
    phone: segment.phone ?? "",
    breakfastIncluded: segment.breakfastIncluded ?? false,
    endDate: segment.endDate ?? "",
    costAmount: segment.cost?.amount?.toString() ?? "",
    costCurrency: segment.cost?.currency ?? "USD",
    costDetails: segment.cost?.details ?? "",
  };
}

export function EditSegmentDialog({
  tripId,
  segment,
  date,
  open,
  onOpenChange,
}: {
  tripId: string;
  segment: Segment;
  /** The date of the TripDay that currently contains this segment. */
  date: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const [form, setForm] = useState<SegmentFormState>(
    segmentToFormState(segment, date),
  );

  const updateSegment = useUpdateSegment(tripId);

  // Reset form when segment changes or dialog re-opens
  useEffect(() => {
    if (open) {
      setForm(segmentToFormState(segment, date));
    }
  }, [open, segment, date]);

  const handleChange = useCallback((patch: Partial<SegmentFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const flags = getTypeFlags(form.type);
    const cost =
      form.costAmount && parseFloat(form.costAmount) >= 0
        ? {
            amount: parseFloat(form.costAmount),
            currency: form.costCurrency,
            details: form.costDetails || undefined,
          }
        : undefined;

    const updates: Record<string, unknown> = {
      segmentId: segment.id,
      type: form.type as SegmentType,
      title: form.title,
      startTime: form.startTime || undefined,
      endTime: form.endTime || undefined,
      url: form.url || undefined,
      confirmationCode: form.confirmationCode || undefined,
      cost,
    };

    if (form.date && form.date !== date) {
      updates.date = form.date;
    }

    // Flight: no venue/city/address, use carrier as "Airline"
    if (flags.isFlight) {
      updates.departureCity = form.departureCity || undefined;
      updates.arrivalCity = form.arrivalCity || undefined;
      updates.departureAirport = form.departureAirport || undefined;
      updates.arrivalAirport = form.arrivalAirport || undefined;
      updates.carrier = form.carrier || undefined;
      updates.routeCode = form.routeCode || undefined;
      updates.seatNumber = form.seatNumber || undefined;
      updates.cabinClass = form.cabinClass || undefined;
      updates.baggageInfo = form.baggageInfo || undefined;
    } else if (flags.isCruise) {
      // Cruise: departure/arrival ports, no venue/city/address/provider.
      // Explicitly null out the venue fields so switching a segment from
      // another type to cruise doesn't leave stale data behind.
      updates.departureCity = form.departureCity || undefined;
      updates.arrivalCity = form.arrivalCity || undefined;
      updates.venueName = undefined;
      updates.address = undefined;
      updates.city = undefined;
      updates.provider = undefined;
    } else {
      updates.venueName = form.venueName || undefined;
      updates.address = form.address || undefined;
      updates.city = form.city || undefined;
      // Provider surfaces on the form for car rental, car service, activity,
      // and tour — match that here so any type whose form no longer shows
      // provider can't accidentally reinstate a stale value on save.
      // Restaurants are included in hidesProvider (rather than relying on
      // the field being blank) so switching an existing segment *to*
      // restaurant actively clears any provider carried over from the
      // previous type.
      const hidesProvider =
        flags.isHotel ||
        flags.isShow ||
        flags.isTrain ||
        flags.isRestaurant ||
        (flags.isTransport && !flags.isFlight && !flags.isTrain);
      if (hidesProvider) {
        updates.provider = undefined;
      } else {
        updates.provider = form.provider || undefined;
      }
    }

    // Train (also isTransport, but carries coach + seatNumber)
    if (flags.isTrain) {
      updates.departureCity = form.departureCity || undefined;
      updates.arrivalCity = form.arrivalCity || undefined;
      updates.carrier = form.carrier || undefined;
      updates.routeCode = form.routeCode || undefined;
      updates.coach = form.coach || undefined;
      updates.seatNumber = form.seatNumber || undefined;
    }

    // Other transport (non-flight, non-train). No route code or provider.
    if (flags.isTransport && !flags.isFlight && !flags.isTrain) {
      updates.departureCity = form.departureCity || undefined;
      updates.arrivalCity = form.arrivalCity || undefined;
      updates.carrier = form.carrier || undefined;
      updates.routeCode = undefined;
    }

    // Car rental — default dropoff date to pickup date when blank so
    // same-day rentals don't need two date clicks.
    if (flags.isCarRental) {
      updates.departureCity = form.departureCity || undefined;
      updates.arrivalCity = form.arrivalCity || undefined;
      updates.endDate =
        form.endDate || defaultEndDate("car_rental", form.date) || undefined;
    }

    // Hotel — default check-out to check-in + 1 day (one-night stay).
    if (flags.isHotel) {
      updates.endDate =
        form.endDate || defaultEndDate("hotel", form.date) || undefined;
      updates.breakfastIncluded = form.breakfastIncluded || undefined;
    }

    // Cruise — default disembark to embark + 3 days (typical short cruise).
    if (flags.isCruise) {
      updates.endDate =
        form.endDate || defaultEndDate("cruise", form.date) || undefined;
    }

    // Restaurant
    if (flags.isRestaurant) {
      updates.partySize = form.partySize
        ? parseInt(form.partySize, 10)
        : undefined;
      updates.creditCardHold = form.creditCardHold || undefined;
      updates.phone = form.phone || undefined;
    }

    // Car service
    if (flags.isCarService) {
      updates.contactName = form.contactName || undefined;
      updates.phone = form.phone || undefined;
    }

    // Editing a review-flagged segment implicitly confirms it.
    if (segment.needsReview) {
      updates.needsReview = false;
    }

    onOpenChange(false);
    updateSegment.mutate(updates as Parameters<typeof updateSegment.mutate>[0]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit segment</DialogTitle>
          <DialogDescription>
            Update the details of this trip segment.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <SegmentFormFields
            form={form}
            onChange={handleChange}
            idPrefix="edit"
          />

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
              disabled={!form.title.trim() || updateSegment.isPending}
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
