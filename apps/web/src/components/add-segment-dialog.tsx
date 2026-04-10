"use client";

import { useState, useCallback } from "react";
import { useCreateSegment } from "@travel-app/api-client";
import type { SegmentType } from "@travel-app/shared";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import {
  SegmentFormFields,
  EMPTY_FORM_STATE,
  type SegmentFormState,
} from "@/components/segment-form-fields";

export function AddSegmentDialog({
  tripId,
  date,
}: {
  tripId: string;
  date: string;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<SegmentFormState>({ ...EMPTY_FORM_STATE });

  const createSegment = useCreateSegment(tripId);

  const handleChange = useCallback((patch: Partial<SegmentFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const reset = () => setForm({ ...EMPTY_FORM_STATE });

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
        date,
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
        carrier: form.carrier || undefined,
        routeCode: form.routeCode || undefined,
        partySize: form.partySize ? parseInt(form.partySize, 10) : undefined,
        creditCardHold: form.creditCardHold || undefined,
        endDate: form.endDate || undefined,
        cabinClass: form.cabinClass || undefined,
        baggageInfo: form.baggageInfo || undefined,
        cost,
      },
      {
        onSuccess: () => {
          setOpen(false);
          reset();
        },
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
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add segment</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <SegmentFormFields
            form={form}
            onChange={handleChange}
            idPrefix="add"
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!form.title.trim() || createSegment.isPending}
            >
              {createSegment.isPending ? "Adding..." : "Add Segment"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
