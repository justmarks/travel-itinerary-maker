"use client";

import { useCallback, useEffect, useState } from "react";
import {
  useCreateSegment,
  useDeleteSegment,
  useUpdateSegment,
} from "@travel-app/api-client";
import type { Segment, SegmentType } from "@travel-app/shared";
import { Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { describeError } from "@/lib/api-error";
import { useConfirm } from "@/lib/confirm-dialog";
import {
  EMPTY_FORM_STATE,
  SegmentFormFields,
  defaultEndDate,
  getTypeFlags,
  type SegmentFormState,
} from "@/components/segment-form-fields";
import { MobileBottomSheet } from "./mobile-bottom-sheet";

export type SegmentFormTarget =
  | { mode: "new"; date: string }
  | { mode: "edit"; segment: Segment; date: string }
  | null;

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

/**
 * Bottom-sheet form for creating and editing trip segments on mobile.
 * Mirrors the desktop Add/Edit dialogs (and shares `SegmentFormFields`)
 * so the field set, validation, and type-specific behavior stay
 * identical across the two surfaces.
 *
 * `target` drives the mode:
 *   - `null`              → sheet is closed
 *   - `{ mode: "new" }`   → "Add" mode, form starts blank for the day
 *   - `{ mode: "edit" }`  → "Edit" mode, pre-filled, delete button shown
 */
export function MobileSegmentFormSheet({
  tripId,
  target,
  onClose,
}: {
  tripId: string;
  target: SegmentFormTarget;
  onClose: () => void;
}): React.JSX.Element {
  const createSegment = useCreateSegment(tripId);
  const updateSegment = useUpdateSegment(tripId);
  const deleteSegment = useDeleteSegment(tripId);
  const confirm = useConfirm();

  const isAdd = target?.mode === "new";
  const isEdit = target?.mode === "edit";
  const open = target !== null;

  const [form, setForm] = useState<SegmentFormState>(EMPTY_FORM_STATE);

  useEffect(() => {
    if (!target) return;
    if (target.mode === "new") {
      setForm({ ...EMPTY_FORM_STATE, date: target.date });
    } else {
      setForm(segmentToFormState(target.segment, target.date));
    }
  }, [target]);

  const handleChange = useCallback((patch: Partial<SegmentFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const canSave = form.title.trim().length > 0;
  const isPending =
    createSegment.isPending || updateSegment.isPending;

  const handleSave = () => {
    if (!canSave || !target) return;

    const cost =
      form.costAmount && parseFloat(form.costAmount) >= 0
        ? {
            amount: parseFloat(form.costAmount),
            currency: form.costCurrency,
            details: form.costDetails || undefined,
          }
        : undefined;

    if (target.mode === "new") {
      createSegment.mutate(
        {
          date: form.date || target.date,
          type: form.type as SegmentType,
          title: form.title,
          startTime: form.startTime || undefined,
          endTime: form.endTime || undefined,
          venueName: form.venueName || undefined,
          address: form.address || undefined,
          city: form.city || undefined,
          url: form.url || undefined,
          confirmationCode: form.confirmationCode || undefined,
          provider: form.provider || undefined,
          departureCity: form.departureCity || undefined,
          arrivalCity: form.arrivalCity || undefined,
          departureAirport: form.departureAirport || undefined,
          arrivalAirport: form.arrivalAirport || undefined,
          carrier: form.carrier || undefined,
          routeCode: form.routeCode || undefined,
          coach: form.coach || undefined,
          partySize: form.partySize ? parseInt(form.partySize, 10) : undefined,
          creditCardHold: form.creditCardHold || undefined,
          endDate:
            form.endDate ||
            (form.type === "hotel" ||
            form.type === "car_rental" ||
            form.type === "cruise"
              ? defaultEndDate(form.type, form.date || target.date)
              : undefined),
          cabinClass: form.cabinClass || undefined,
          baggageInfo: form.baggageInfo || undefined,
          seatNumber: form.seatNumber || undefined,
          contactName: form.contactName || undefined,
          phone: form.phone || undefined,
          breakfastIncluded: form.breakfastIncluded || undefined,
          cost,
        },
        {
          onSuccess: onClose,
          onError: (err) => {
            toast.error("Couldn't add segment", {
              description: describeError(err),
            });
          },
        },
      );
      return;
    }

    // Edit mode — mirror edit-segment-dialog.tsx so type changes clear
    // stale fields from the previous type.
    const flags = getTypeFlags(form.type);
    const updates: Record<string, unknown> = {
      segmentId: target.segment.id,
      type: form.type as SegmentType,
      title: form.title,
      startTime: form.startTime || undefined,
      endTime: form.endTime || undefined,
      url: form.url || undefined,
      confirmationCode: form.confirmationCode || undefined,
      cost,
    };

    if (form.date && form.date !== target.date) {
      updates.date = form.date;
    }

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
      const hidesProvider =
        flags.isHotel ||
        flags.isShow ||
        flags.isTrain ||
        flags.isRestaurant ||
        (flags.isTransport && !flags.isFlight && !flags.isTrain);
      updates.provider = hidesProvider ? undefined : form.provider || undefined;
    }

    if (flags.isTrain) {
      updates.departureCity = form.departureCity || undefined;
      updates.arrivalCity = form.arrivalCity || undefined;
      updates.carrier = form.carrier || undefined;
      updates.routeCode = form.routeCode || undefined;
      updates.coach = form.coach || undefined;
      updates.seatNumber = form.seatNumber || undefined;
    }

    if (flags.isTransport && !flags.isFlight && !flags.isTrain) {
      updates.departureCity = form.departureCity || undefined;
      updates.arrivalCity = form.arrivalCity || undefined;
      updates.carrier = form.carrier || undefined;
      updates.routeCode = undefined;
    }

    if (flags.isCarRental) {
      updates.departureCity = form.departureCity || undefined;
      updates.arrivalCity = form.arrivalCity || undefined;
      updates.endDate =
        form.endDate || defaultEndDate("car_rental", form.date) || undefined;
    }

    if (flags.isHotel) {
      updates.endDate =
        form.endDate || defaultEndDate("hotel", form.date) || undefined;
      updates.breakfastIncluded = form.breakfastIncluded || undefined;
    }

    if (flags.isCruise) {
      updates.endDate =
        form.endDate || defaultEndDate("cruise", form.date) || undefined;
    }

    if (flags.isRestaurant) {
      updates.partySize = form.partySize
        ? parseInt(form.partySize, 10)
        : undefined;
      updates.creditCardHold = form.creditCardHold || undefined;
      updates.phone = form.phone || undefined;
    }

    if (flags.isCarService) {
      updates.contactName = form.contactName || undefined;
      updates.phone = form.phone || undefined;
    }

    if (target.segment.needsReview) {
      updates.needsReview = false;
    }

    updateSegment.mutate(
      updates as Parameters<typeof updateSegment.mutate>[0],
      {
        onSuccess: onClose,
        onError: (err) => {
          toast.error("Couldn't save segment", {
            description: describeError(err),
          });
        },
      },
    );
  };

  const handleDelete = async () => {
    if (!isEdit) return;
    const ok = await confirm({
      title: `Delete "${target.segment.title}"?`,
      confirmText: "Delete",
      destructive: true,
    });
    if (!ok) return;
    deleteSegment.mutate(target.segment.id, {
      onSuccess: onClose,
      onError: (err) => {
        toast.error("Couldn't delete segment", {
          description: describeError(err),
        });
      },
    });
  };

  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      ariaLabel={isAdd ? "Add segment" : "Edit segment"}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-1">
        <div className="min-w-0 flex-1">
          <p className="text-kicker font-semibold text-muted-foreground">
            Segment
          </p>
          <h2 className="mt-0.5 text-lg font-semibold leading-snug">
            {isAdd ? "Add segment" : "Edit segment"}
          </h2>
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

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
        className="flex flex-1 flex-col overflow-y-auto px-5 pb-3"
      >
        <SegmentFormFields
          form={form}
          onChange={handleChange}
          idPrefix={isAdd ? "m-add" : "m-edit"}
          autoFocusTitle={isAdd}
        />
      </form>

      <div className="flex shrink-0 items-center gap-2 border-t bg-background px-5 py-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        {isEdit && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleteSegment.isPending}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-destructive hover:bg-destructive/10 disabled:opacity-50"
            aria-label="Delete segment"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="h-11 flex-1 rounded-full border bg-background text-sm font-medium text-foreground active:bg-muted/40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave || isPending}
          className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isAdd ? "Add" : "Save"}
        </button>
      </div>
    </MobileBottomSheet>
  );
}
