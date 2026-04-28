"use client";

import { useCostSummary } from "@travel-app/api-client";
import { formatCurrency } from "@travel-app/shared";
import { AlertCircle, X } from "lucide-react";
import { MobileBottomSheet } from "./mobile-bottom-sheet";

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
  show: "Show",
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

function fmtUsd(amount: number) {
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function MobileCostsSheet({
  tripId,
  open,
  onClose,
}: {
  tripId: string;
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const { data, isLoading, isError, refetch } = useCostSummary(tripId);

  // Currencies without a USD conversion (e.g. "points") get their own
  // total line so we don't mix them into the headline grand total.
  const unconvertedCurrencies = data
    ? Object.entries(data.totalsByCurrency).filter(([currency]) =>
        data.items.some(
          (i) => i.currency === currency && i.amountUsd === undefined,
        ),
      )
    : [];

  return (
    <MobileBottomSheet open={open} onClose={onClose} ariaLabel="Trip costs">
      {/* Header */}
      <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-2 pt-1">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Costs
          </p>
          {data?.totalUsd !== undefined && (
            <h2 className="mt-0.5 text-2xl font-bold leading-tight tabular-nums">
              {fmtUsd(data.totalUsd)}
            </h2>
          )}
          {data && data.totalUsd === undefined && data.items.length > 0 && (
            <h2 className="mt-0.5 text-base font-semibold text-muted-foreground">
              {data.items.length}{" "}
              {data.items.length === 1 ? "item" : "items"}
            </h2>
          )}
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

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 pb-6">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <AlertCircle className="h-7 w-7 text-destructive" />
            <p className="text-sm text-muted-foreground">
              Couldn&apos;t load costs.
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background"
            >
              Retry
            </button>
          </div>
        ) : !data || data.items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No costs recorded yet.
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border/50">
              {data.items.map((item) => {
                const label = categoryLabel(item.category);
                const primary = item.city ? `${item.city}: ${label}` : label;
                const isForeign =
                  item.amountUsd !== undefined && item.currency !== "USD";
                const showSubtitle =
                  item.description &&
                  item.description.trim().toLowerCase() !== label.toLowerCase();
                return (
                  <li
                    key={item.segmentId}
                    className="flex items-start justify-between gap-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={primary}>
                        {primary}
                      </p>
                      {showSubtitle && (
                        <p
                          className="truncate text-xs text-muted-foreground"
                          title={item.description}
                        >
                          {item.description}
                        </p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums">
                        {item.amountUsd !== undefined
                          ? fmtUsd(item.amountUsd)
                          : formatCurrency(item.amount, item.currency)}
                      </p>
                      {isForeign && (
                        <p className="text-[11px] text-muted-foreground tabular-nums">
                          {formatCurrency(item.amount, item.currency)}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {unconvertedCurrencies.length > 0 && (
              <div className="mt-4 flex flex-col gap-1 border-t pt-3 text-sm">
                {unconvertedCurrencies.map(([currency]) => {
                  const unconvertedTotal = data.items
                    .filter(
                      (i) =>
                        i.currency === currency && i.amountUsd === undefined,
                    )
                    .reduce((sum, i) => sum + i.amount, 0);
                  return (
                    <div
                      key={currency}
                      className="flex items-center justify-between text-muted-foreground"
                    >
                      <span>Total ({currency})</span>
                      <span className="font-medium tabular-nums">
                        {formatCurrency(unconvertedTotal, currency)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </MobileBottomSheet>
  );
}
