"use client";

import { useState, useEffect, useCallback } from "react";
import { useUpdateSegment } from "@itinly/api-client";
import type { Segment, SegmentType } from "@itinly/shared";
import { toastMutationError } from "@/lib/api-error";
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
  resolveSegmentTitle,
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
    shipName: segment.shipName ?? "",
    endDate: segment.endDate ?? "",
    // Force 2-decimal display so a stored 288.4 renders as 288.40 — the
    // bare .toString() truncated trailing zeros and made costs look
    // like typos. Input still accepts any step="0.01" value.
    costAmount: segment.cost ? segment.cost.amount.toFixed(2) : "",
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

  // Dining titles can fall back to "<Meal> @ <Venue>" when blank — see
  // resolveSegmentTitle. Used both for the submit-button enable check
  // below and the mutation payload.
  const resolvedTitle = resolveSegmentTitle(form);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const flags = getTypeFlags(form.type);
    // Cost cleared → send explicit `null` so the server clears the stored
    // cost. Sending `undefined` would be dropped by `JSON.stringify` and
    // the segment would keep its old cost on the next read.
    //
    // We only send `null` when the segment ACTUALLY had a cost previously
    // (and the user cleared it). Otherwise — adding a fresh segment with
    // no cost, or an existing cost-less segment that still has no cost —
    // we omit the field entirely so the patch stays minimal and the
    // history diff doesn't note a no-op cost change.
    const hadCost = Boolean(segment.cost);
    const filledCost = Boolean(form.costAmount) && parseFloat(form.costAmount) >= 0;
    const cost: { amount: number; currency: string; details?: string } | null | undefined =
      filledCost
        ? {
            amount: parseFloat(form.costAmount),
            currency: form.costCurrency,
            details: form.costDetails || undefined,
          }
        : hadCost
          ? null
          : undefined;

    const updates: Record<string, unknown> = {
      segmentId: segment.id,
      type: form.type as SegmentType,
      title: resolvedTitle,
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
      updates.shipName = form.shipName || undefined;
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
    updateSegment.mutate(updates as Parameters<typeof updateSegment.mutate>[0], {
      onError: toastMutationError("save segment"),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle>Edit segment</DialogTitle>
          <DialogDescription>
            Update the details of this trip segment.
          </DialogDescription>
        </DialogHeader>
        {/* Three-region layout (header / scrollable body / pinned footer);
            see add-segment-dialog.tsx for the same pattern + rationale. */}
        <form
          onSubmit={handleSubmit}
          // See add-segment-dialog.tsx for the rationale — without
          // this, Enter from a focused Select trigger opens the
          // dropdown instead of submitting the form.
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const t = e.target as HTMLElement;
            if (t.tagName === "BUTTON") return;
            // Plain Enter in a textarea inserts a newline; Ctrl/Cmd+Enter
            // submits — matches the convention in Slack / GitHub / Linear.
            if (t.tagName === "TEXTAREA" && !e.ctrlKey && !e.metaKey) return;
            const expanded = (t as HTMLElement).getAttribute(
              "aria-expanded",
            );
            if (expanded === "true") return;
            e.preventDefault();
            e.currentTarget.requestSubmit();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* `min-h-0` lets the scroll area shrink within the dialog's
              max-height so long forms (More options expanded with many
              advanced fields) scroll cleanly. `overflow-y-auto` engages
              only when content overflows — short forms keep their
              natural height and the footer sits right below the last
              row, no empty gap.

              The earlier sticky-bottom gradient that hinted "more
              content below" has been removed: now that the form
              collapses to a short default the hint was misleading
              (nothing below) and the overlay made the Cancel button
              feel un-clickable. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-1">
            <SegmentFormFields
              form={form}
              onChange={handleChange}
              idPrefix="edit"
            />
          </div>

          <div className="mt-4 flex shrink-0 justify-end gap-2 border-t pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!resolvedTitle || updateSegment.isPending}
            >
              {updateSegment.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save changes"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
