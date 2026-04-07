"use client";

import { useCostSummary } from "@travel-app/api-client";

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
};

function fmt(amount: number, currency: string) {
  const sym = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  return `${sym}${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
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
          <div className="flex flex-col gap-1.5 text-sm">
            {data.items.map((item) => (
              <div key={item.segmentId} className="flex items-start justify-between gap-2">
                <span className="truncate text-muted-foreground">{item.description}</span>
                <span className="shrink-0 font-medium tabular-nums">
                  {fmt(item.amount, item.currency)}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-col gap-1 border-t pt-3">
            {Object.entries(data.totalsByCurrency).map(([currency, total]) => (
              <div key={currency} className="flex items-center justify-between text-sm font-semibold">
                <span>Total ({currency})</span>
                <span className="tabular-nums">{fmt(total, currency)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
