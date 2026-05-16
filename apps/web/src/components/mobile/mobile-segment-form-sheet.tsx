"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  queryKeys,
  useCreateSegment,
  useDeleteSegment,
  useUpdateDay,
  useUpdateSegment,
} from "@itinly/api-client";
import type { Segment, SegmentType, Trip } from "@itinly/shared";
import { Loader2, Trash2, X } from "lucide-react";
import { toastMutationError } from "@/lib/api-error";
import { useConfirm } from "@/lib/confirm-dialog";
import {
  EMPTY_FORM_STATE,
  SegmentFormFields,
  defaultEndDate,
  deriveCityFromForm,
  getTypeFlags,
  resolveSegmentTitle,
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
 *
 * The form body lives in a child component that is unmounted whenever
 * the sheet closes, and keyed on `target` so re-opening always builds
 * a fresh `useState` from the new target. Without this, form state
 * survives close/reopen (the outer component stays mounted), and the
 * first render after re-open briefly showed the previous segment's
 * data — a fast tap on Android could submit before a reset effect
 * fired, producing segments with the wrong type.
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
  const open = target !== null;
  const isAdd = target?.mode === "new";

  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      ariaLabel={isAdd ? "Add segment" : "Edit segment"}
    >
      {target && (
        <SegmentFormBody
          key={
            target.mode === "edit"
              ? `edit-${target.segment.id}`
              : `new-${target.date}`
          }
          tripId={tripId}
          target={target}
          onClose={onClose}
        />
      )}
    </MobileBottomSheet>
  );
}

function SegmentFormBody({
  tripId,
  target,
  onClose,
}: {
  tripId: string;
  target: Exclude<SegmentFormTarget, null>;
  onClose: () => void;
}): React.JSX.Element {
  const createSegment = useCreateSegment(tripId);
  const updateSegment = useUpdateSegment(tripId);
  const deleteSegment = useDeleteSegment(tripId);
  const updateDay = useUpdateDay(tripId);
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  /**
   * Decides whether saving the current form should also push a city
   * update onto the destination day. Mobile only — desktop has the
   * `EditableCity` affordance for explicit day-city edits, but mobile
   * has no manual control, so the form derives the day's city from the
   * segment as a sensible default.
   *
   * Rules:
   *   - Add: if the destination day has no city yet, set it from the
   *     new segment.
   *   - Edit: if the segment will be the only one on the destination
   *     day after the edit (covers same-day edits where it's already
   *     the lone segment, and cross-day moves into an empty day),
   *     update the day's city to match. Doesn't touch days with
   *     other segments — those have multiple inputs to derive from
   *     and the user might have set the city deliberately.
   *
   * Returns the day mutation payload, or null if no update is needed.
   */
  const computeDayCityUpdate = (): {
    date: string;
    city: string;
  } | null => {
    const trip = queryClient.getQueryData<Trip>(queryKeys.trip(tripId));
    if (!trip) return null;
    const targetDate = form.date || target.date;
    const day = trip.days.find((d) => d.date === targetDate);
    if (!day) return null;
    const newCity = deriveCityFromForm(form);
    if (!newCity) return null;

    if (target.mode === "new") {
      return day.city ? null : { date: targetDate, city: newCity };
    }

    // Edit: count other segments on the destination day. For same-day
    // edits, this is `day.segments.length - 1` (excluding the segment
    // being edited). For cross-day moves, the segment isn't on this
    // day yet, so other-count == day.segments.length. Either way,
    // `willBeOnly` true means after the save, this segment is the
    // only one on the destination day.
    const willBeOnly =
      day.segments.filter((s) => s.id !== target.segment.id).length === 0;
    if (!willBeOnly) return null;
    if (day.city === newCity) return null;
    return { date: targetDate, city: newCity };
  };

  const isAdd = target.mode === "new";
  const isEdit = target.mode === "edit";

  // Initializer derives initial state from target so the very first
  // render is correct — no race with a useEffect resetter.
  const [form, setForm] = useState<SegmentFormState>(() => {
    if (target.mode === "new") {
      return { ...EMPTY_FORM_STATE, date: target.date };
    }
    return segmentToFormState(target.segment, target.date);
  });

  const handleChange = useCallback((patch: Partial<SegmentFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  // Title is optional for dining segments — `resolveSegmentTitle` falls
  // back to "<Meal> @ <Venue>" when the user leaves it blank but has set
  // a venue. Use the resolved value for both the can-save check and the
  // mutation payload so the UX reflects what'll actually be saved.
  const resolvedTitle = resolveSegmentTitle(form);
  const canSave = resolvedTitle.length > 0;
  const isPending = createSegment.isPending || updateSegment.isPending;

  const handleSave = () => {
    if (!canSave) return;

    const cost =
      form.costAmount && parseFloat(form.costAmount) >= 0
        ? {
            amount: parseFloat(form.costAmount),
            currency: form.costCurrency,
            details: form.costDetails || undefined,
          }
        : undefined;

    // Snapshot before either mutation so the day-state check reflects
    // the pre-mutation cache (the segment hasn't been added/edited yet).
    const dayCityUpdate = computeDayCityUpdate();

    if (target.mode === "new") {
      createSegment.mutate(
        {
          date: form.date || target.date,
          type: form.type as SegmentType,
          title: resolvedTitle,
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
          onSuccess: () => {
            if (dayCityUpdate) updateDay.mutate(dayCityUpdate);
            onClose();
          },
          onError: toastMutationError("add segment"),
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
      title: resolvedTitle,
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
        onSuccess: () => {
          if (dayCityUpdate) updateDay.mutate(dayCityUpdate);
          onClose();
        },
        onError: toastMutationError("save segment"),
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
      onError: toastMutationError("delete segment"),
    });
  };

  return (
    <>
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
          useNativeTypeSelect
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
    </>
  );
}
