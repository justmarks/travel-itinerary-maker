const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CNY: "¥",
  CAD: "C$",
  AUD: "A$",
  NZD: "NZ$",
  CHF: "CHF ",
  MXN: "MX$",
  BRL: "R$",
  INR: "₹",
  KRW: "₩",
  SGD: "S$",
  HKD: "HK$",
  THB: "฿",
  NOK: "kr",
  SEK: "kr",
  DKK: "kr",
  ZAR: "R",
  points: "pts",
};

/**
 * Static USD conversion rates (foreign currency → USD).
 * These are approximate, not real-time. For a trip-planning app the
 * convenience of a stable offline calculation outweighs rate accuracy.
 * Update periodically or add a proper FX API if/when precision matters.
 * Rates = "1 unit of FOREIGN currency equals N USD".
 */
const FX_RATES_TO_USD: Record<string, number> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  JPY: 0.0067,
  CNY: 0.14,
  CAD: 0.73,
  AUD: 0.66,
  NZD: 0.60,
  CHF: 1.13,
  MXN: 0.058,
  BRL: 0.20,
  INR: 0.012,
  KRW: 0.00075,
  SGD: 0.74,
  HKD: 0.13,
  THB: 0.028,
  NOK: 0.094,
  SEK: 0.094,
  DKK: 0.145,
  ZAR: 0.054,
};

/**
 * Convert an amount in any supported currency to USD. Returns undefined if
 * the currency isn't supported (e.g. "points" or an unknown code). The caller
 * should fall back to showing the raw amount in its own currency.
 */
export function convertToUsd(amount: number, currency: string): number | undefined {
  const rate = FX_RATES_TO_USD[currency];
  if (rate === undefined) return undefined;
  return amount * rate;
}

/** True if a currency has a USD conversion rate available. */
export function hasUsdRate(currency: string): boolean {
  return currency in FX_RATES_TO_USD;
}

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
