"use client";

import { useEffect, useRef, useState } from "react";
import { useUpdateDay } from "@travel-app/api-client";
import { Check, MapPin, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { describeError } from "@/lib/api-error";

/**
 * Tap-to-edit affordance for a day's city on the mobile site. Mirrors
 * the desktop `EditableCity` (in itinerary-day.tsx) but sized for thumbs:
 * larger tap target, larger input, and clearly-visible Save / Cancel
 * buttons so the user doesn't have to reach into a tiny corner.
 *
 * Renders nothing while `canEdit` is false — read-only contributors
 * fall back to the inert MapPin + city-or-em-dash below the carousel
 * map (which the parent already handles when `canEdit` is false).
 */
export function MobileEditableCity({
  tripId,
  date,
  city,
  /**
   * Visual size variant. `header` is the small inline label that sits
   * in the carousel's map-info row (text-xs). `dayStrip` is the
   * inline label inside `MobileDaysList`'s sticky day header
   * (text-xs).
   */
  variant = "header",
  /**
   * When the day has no city yet, render this string instead of the
   * empty space. Defaults to "Set city" so users see the affordance.
   */
  emptyLabel = "Set city",
}: {
  tripId: string;
  date: string;
  city: string;
  variant?: "header" | "dayStrip";
  emptyLabel?: string;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(city);
  const updateDay = useUpdateDay(tripId);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Keep local state synced to the prop when the cached city changes
  // (e.g. another tab updates it, or a successful save flushes back).
  useEffect(() => {
    if (!editing) setValue(city);
  }, [city, editing]);

  const cancel = () => {
    setValue(city);
    setEditing(false);
  };

  const save = () => {
    const trimmed = value.trim();
    setEditing(false);
    if (trimmed === city) return;
    updateDay.mutate(
      { date, city: trimmed },
      {
        onError: (err) => {
          toast.error("Couldn't update city", {
            description: describeError(err),
          });
        },
      },
    );
  };

  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="inline-flex items-center gap-1"
      >
        <input
          ref={inputRef}
          type="text"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          placeholder="City"
          className="h-7 w-32 rounded-full border bg-background px-2.5 text-xs text-foreground outline-none focus:border-foreground"
        />
        <button
          type="submit"
          aria-label="Save city"
          disabled={updateDay.isPending}
          className="flex h-7 w-7 items-center justify-center rounded-full border bg-background text-foreground active:bg-muted/40 disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={cancel}
          aria-label="Cancel city edit"
          className="flex h-7 w-7 items-center justify-center rounded-full border bg-background text-muted-foreground active:bg-muted/40"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </form>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label={city ? `Edit city for this day (${city})` : "Set city for this day"}
      className={
        variant === "header"
          ? "inline-flex items-center gap-1 rounded-full px-1 -mx-1 py-0.5 text-xs text-muted-foreground active:bg-muted/40"
          : "inline-flex items-center gap-1 rounded-full px-1 -mx-1 py-0.5 text-xs text-muted-foreground active:bg-muted/40"
      }
    >
      <MapPin className="h-3 w-3" />
      <span>{city || emptyLabel}</span>
      <Pencil className="h-2.5 w-2.5 opacity-60" />
    </button>
  );
}
