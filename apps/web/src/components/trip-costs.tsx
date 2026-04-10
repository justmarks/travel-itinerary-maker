"use client";

import { useCostSummary } from "@travel-app/api-client";
import { formatCurrency } from "@travel-app/shared";

function fmtUsd(amount: number) {
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// Human-readable labels for the segment-type "activity" shown in the
// cost table. Kept in sync with SegmentType in packages/shared/src/types/trip.ts.
const CATEGORY_LABELS: Record<string, string> = {
  flight: "Flight",
  train: "Train",
  car_rental: "Car Rental",
  car_service: "Car Service",
  other_transport: "Transport",
  hotel: "Hotel",
  activity: "Activity",
  restaurant_breakfast: "Breakfast",
  restaurant_brunch: "Brunch",
  restaurant_lunch: "Lunch",
  restaurant_dinner: "Dinner",
  tour: "Tour",
  cruise: "Cruise",
};

function categoryLabel(category: string): string {
  return (
    CATEGORY_LABELS[category] ??
    category
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

export function TripCosts({ tripId }: { tripId: string }) {
  const { data, isLoading } = useCostSummary(tripId);

  return (
    <div>
      <h2 className="mb-3 font-semibold">Costs</h2>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-4 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No costs recorded yet.</p>
      ) : (
        <>
          <div className="flex flex-col gap-2 text-sm">
            {data.items.map((item) => {
              const isForeign =
                item.amountUsd !== undefined && item.currency !== "USD";
              const label = categoryLabel(item.category);
              // Primary line: "City: Activity" (e.g. "Palermo: Car Rental").
              // When no city is known, fall back to just the activity label.
              const primary = item.city ? `${item.city}: ${label}` : label;
              // Secondary line: the segment title if it adds information
              // beyond the category label alone (e.g. hotel name, provider).
              const showSubtitle =
                item.description &&
                item.description.trim().toLowerCase() !==
                  label.toLowerCase();
              return (
                <div
                  key={item.segmentId}
                  className="flex items-start justify-between gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{primary}</div>
                    {showSubtitle && (
                      <div className="truncate text-xs text-muted-foreground">
                        {item.description}
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 text-right font-medium tabular-nums">
                    {item.amountUsd !== undefined
                      ? fmtUsd(item.amountUsd)
                      : formatCurrency(item.amount, item.currency)}
                    {isForeign && (
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        ({formatCurrency(item.amount, item.currency)})
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-col gap-1 border-t pt-3 text-sm">
            {data.totalUsd !== undefined && (
              <div className="flex items-center justify-between font-semibold">
                <span>Total (USD)</span>
                <span className="tabular-nums">{fmtUsd(data.totalUsd)}</span>
              </div>
            )}
            {/* Show any currencies without a USD conversion (e.g. points) as separate lines */}
            {Object.entries(data.totalsByCurrency)
              .filter(
                ([currency]) =>
                  // Only show rows whose items had no USD conversion — otherwise
                  // it would double-count with the USD total above.
                  data.items.some(
                    (i) => i.currency === currency && i.amountUsd === undefined,
                  ),
              )
              .map(([currency, total]) => {
                // Sum only the items that did NOT convert, to avoid mixing
                // converted and non-converted totals.
                const unconverted = data.items
                  .filter(
                    (i) => i.currency === currency && i.amountUsd === undefined,
                  )
                  .reduce((sum, i) => sum + i.amount, 0);
                const shownTotal = unconverted || total;
                return (
                  <div
                    key={currency}
                    className="flex items-center justify-between font-medium text-muted-foreground"
                  >
                    <span>Total ({currency})</span>
                    <span className="tabular-nums">
                      {formatCurrency(shownTotal, currency)}
                    </span>
                  </div>
                );
              })}
          </div>
        </>
      )}
    </div>
  );
}
