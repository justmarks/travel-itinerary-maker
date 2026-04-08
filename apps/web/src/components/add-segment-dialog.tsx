"use client";

import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";

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

export function AddSegmentDialog({
  tripId,
  date,
}: {
  tripId: string;
  date: string;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string>("activity");
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [venueName, setVenueName] = useState("");
  const [url, setUrl] = useState("");
  const [confirmationCode, setConfirmationCode] = useState("");
  const [costAmount, setCostAmount] = useState("");
  const [costCurrency, setCostCurrency] = useState("USD");
  const [costDetails, setCostDetails] = useState("");

  const createSegment = useCreateSegment(tripId);

  const reset = () => {
    setType("activity");
    setTitle("");
    setStartTime("");
    setEndTime("");
    setVenueName("");
    setUrl("");
    setConfirmationCode("");
    setCostAmount("");
    setCostCurrency("USD");
    setCostDetails("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const cost =
      costAmount && parseFloat(costAmount) > 0
        ? {
            amount: parseFloat(costAmount),
            currency: costCurrency,
            details: costDetails || undefined,
          }
        : undefined;

    createSegment.mutate(
      {
        date,
        type: type as SegmentType,
        title,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        venueName: venueName || undefined,
        url: url || undefined,
        confirmationCode: confirmationCode || undefined,
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
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add segment</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
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
              <Label htmlFor="seg-title">Title</Label>
              <Input
                id="seg-title"
                placeholder="e.g. Hilton Garden Inn"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="seg-start">Start time</Label>
              <Input
                id="seg-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="seg-end">End time</Label>
              <Input
                id="seg-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="seg-venue">Venue</Label>
              <Input
                id="seg-venue"
                placeholder="Optional"
                value={venueName}
                onChange={(e) => setVenueName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="seg-conf">Confirmation #</Label>
              <Input
                id="seg-conf"
                placeholder="Optional"
                value={confirmationCode}
                onChange={(e) => setConfirmationCode(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="seg-url">URL</Label>
            <Input
              id="seg-url"
              type="url"
              placeholder="https://..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="seg-cost">Cost</Label>
              <Input
                id="seg-cost"
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
                  <SelectItem value="points">Points</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="seg-cost-details">Details</Label>
              <Input
                id="seg-cost-details"
                placeholder="e.g. Economy"
                value={costDetails}
                onChange={(e) => setCostDetails(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!title.trim() || createSegment.isPending}
            >
              {createSegment.isPending ? "Adding..." : "Add Segment"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
