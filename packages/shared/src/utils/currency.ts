const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  points: "pts",
};

/** Format a cost amount with its currency symbol */
export function formatCurrency(amount: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency;

  if (currency === "points") {
    return `${amount.toLocaleString()} ${symbol}`;
  }

  return `${symbol}${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Get the currency symbol for a currency code */
export function getCurrencySymbol(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? currency;
}

/** Group costs by currency and sum them */
export function sumByCurrency(
  items: Array<{ amount: number; currency: string }>,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const item of items) {
    totals[item.currency] = (totals[item.currency] ?? 0) + item.amount;
  }
  return totals;
}
