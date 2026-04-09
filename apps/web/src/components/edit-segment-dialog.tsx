"use client";

import { useState, useEffect, useCallback } from "react";
import { useUpdateSegment } from "@travel-app/api-client";
import type { Segment, SegmentType } from "@travel-app/shared";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import {
  SegmentFormFields,
  getTypeFlags,
  type SegmentFormState,
} from "@/components/segment-form-fields";

function segmentToFormState(segment: Segment): SegmentFormState {
  return {
    type: segment.type,
    title: segment.title,
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
    carrier: segment.carrier ?? "",
    routeCode: segment.routeCode ?? "",
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
  open,
  onOpenChange,
}: {
  tripId: string;
  segment: Segment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [form, setForm] = useState<SegmentFormState>(
    segmentToFormState(segment),
  );

  const updateSegment = useUpdateSegment(tripId);

  // Reset form when segment changes or dialog re-opens
  useEffect(() => {
    if (open) {
      setForm(segmentToFormState(segment));
    }
  }, [open, segment]);

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

    // Flight: no venue/city/address, use carrier as "Airline"
    if (flags.isFlight) {
      updates.departureCity = form.departureCity || undefined;
      updates.arrivalCity = form.arrivalCity || undefined;
      updates.carrier = form.carrier || undefined;
      updates.routeCode = form.routeCode || undefined;
      updates.seatNumber = form.seatNumber || undefined;
      updates.cabinClass = form.cabinClass || undefined;
      updates.baggageInfo = form.baggageInfo || undefined;
    } else {
      updates.venueName = form.venueName || undefined;
      updates.address = form.address || undefined;
      updates.city = form.city || undefined;
      updates.provider = form.provider || undefined;
    }

    // Transport (non-flight)
    if (flags.isTransport && !flags.isFlight) {
      updates.departureCity = form.departureCity || undefined;
      updates.arrivalCity = form.arrivalCity || undefined;
      updates.carrier = form.carrier || undefined;
      updates.routeCode = form.routeCode || undefined;
    }

    // Car rental
    if (flags.isCarRental) {
      updates.departureCity = form.departureCity || undefined;
      updates.arrivalCity = form.arrivalCity || undefined;
    }

    // Hotel
    if (flags.isHotel) {
      updates.endDate = form.endDate || undefined;
      updates.breakfastIncluded = form.breakfastIncluded || undefined;
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

    updateSegment.mutate(
      updates as Parameters<typeof updateSegment.mutate>[0],
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit segment</DialogTitle>
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
