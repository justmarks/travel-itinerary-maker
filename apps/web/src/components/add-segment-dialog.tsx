"use client";

import { useState, useCallback } from "react";
import { useCreateSegment } from "@itinly/api-client";
import type { SegmentType } from "@itinly/shared";
import { toastMutationError } from "@/lib/api-error";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import {
  SegmentFormFields,
  EMPTY_FORM_STATE,
  defaultEndDate,
  resolveSegmentTitle,
  type SegmentFormState,
} from "@/components/segment-form-fields";

export function AddSegmentDialog({
  tripId,
  date,
}: {
  tripId: string;
  date: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<SegmentFormState>({
    ...EMPTY_FORM_STATE,
    date,
  });

  const createSegment = useCreateSegment(tripId);

  const handleChange = useCallback((patch: Partial<SegmentFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const reset = () => setForm({ ...EMPTY_FORM_STATE, date });

  // Title is optional for dining segments — `resolveSegmentTitle` falls
  // back to "<Meal> @ <Venue>" when blank but venue is set. The submit
  // button below mirrors this so dining types unlock as soon as either
  // a title or a venue is filled in.
  const resolvedTitle = resolveSegmentTitle(form);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const cost =
      form.costAmount && parseFloat(form.costAmount) > 0
        ? {
            amount: parseFloat(form.costAmount),
            currency: form.costCurrency,
            details: form.costDetails || undefined,
          }
        : undefined;

    createSegment.mutate(
      {
        date: form.date || date,
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
        // For multi-day segment types (hotel, car rental, cruise), default the
        // end date when the user leaves it blank — matches what the form
        // visibly shows. Hotel gets start+1 (typical one-night stay), cruise
        // gets start+3 (typical minimum cruise length), car rental gets the
        // start date (same-day return).
        endDate:
          form.endDate ||
          (form.type === "hotel" ||
          form.type === "car_rental" ||
          form.type === "cruise"
            ? defaultEndDate(form.type, form.date || date)
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
          setOpen(false);
          reset();
        },
        onError: toastMutationError("add segment"),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg">
        <DialogHeader className="shrink-0">
          <DialogTitle>Add segment</DialogTitle>
          <DialogDescription>
            Add a flight, hotel, activity, or other segment to this day.
          </DialogDescription>
        </DialogHeader>
        {/* Three-region layout (header / scrollable body / pinned footer)
            so the action buttons stay visible on short viewports while the
            form fields scroll. `min-h-0` is required on the form + body so
            the inner overflow-y-auto can size against the dialog's
            `max-h` cap. The cap uses `dvh` (dynamic viewport height) so
            iPad landscape and iOS Safari with the bottom toolbar visible
            both get the actual usable height — `vh` extends behind the
            toolbar on iOS and clipped the lower form fields. */}
        <form
          onSubmit={handleSubmit}
          // Enter anywhere inside this form (other than a textarea, where
          // Enter should insert a newline, or a button, which activates
          // itself) fires the default Submit. Without this, focus on the
          // Type / Currency Selects intercepts Enter to open their
          // dropdowns and the user can't submit until they explicitly
          // click the Add Segment button.
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const t = e.target as HTMLElement;
            // Buttons activate themselves on Enter — never override.
            if (t.tagName === "BUTTON") return;
            // In a textarea, plain Enter inserts a newline (correct).
            // Ctrl/Cmd+Enter is the standard submit shortcut and should
            // still fire the form's Submit action.
            if (t.tagName === "TEXTAREA" && !e.ctrlKey && !e.metaKey) return;
            // Skip when a Radix Select dropdown is open — Enter there
            // picks the highlighted option, which is the right behavior.
            const expanded = (t as HTMLElement).getAttribute(
              "aria-expanded",
            );
            if (expanded === "true") return;
            e.preventDefault();
            e.currentTarget.requestSubmit();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* `min-h-0 flex-1 overflow-y-auto`: scrolls when content
              overflows the dialog's max-height (e.g. More options
              expanded with many type-specific advanced rows), stays
              static otherwise.

              The earlier sticky-bottom gradient that hinted "more
              content below" was removed when the form collapsed to a
              short default — the hint was misleading (nothing below)
              and the fade made the Cancel button read as faded. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-1">
            <SegmentFormFields
              form={form}
              onChange={handleChange}
              idPrefix="add"
              autoFocusTitle
            />
          </div>

          <div className="mt-4 flex shrink-0 justify-end gap-2 border-t pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!resolvedTitle || createSegment.isPending}
            >
              {createSegment.isPending ? "Adding..." : "Add Segment"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
