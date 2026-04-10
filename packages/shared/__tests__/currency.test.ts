import { formatCurrency, getCurrencySymbol, sumByCurrency } from "../src/utils/currency";

describe("formatCurrency", () => {
  it("formats USD", () => {
    expect(formatCurrency(4704.05, "USD")).toBe("$4,704.05");
  });

  it("formats EUR", () => {
    expect(formatCurrency(207.76, "EUR")).toBe("€207.76");
  });

  it("formats GBP", () => {
    expect(formatCurrency(920, "GBP")).toBe("£920.00");
  });

  it("formats points", () => {
    expect(formatCurrency(318500, "points")).toBe("318,500 pts");
  });

  it("formats CHF with its symbol", () => {
    // CHF symbol has a trailing space so it reads "CHF 100.00"
    expect(formatCurrency(100, "CHF")).toBe("CHF 100.00");
  });

  it("handles unknown currency by using code as symbol", () => {
    expect(formatCurrency(100, "XYZ")).toBe("XYZ100.00");
  });

  it("formats zero", () => {
    expect(formatCurrency(0, "USD")).toBe("$0.00");
  });
});

describe("getCurrencySymbol", () => {
  it("returns $ for USD", () => {
    expect(getCurrencySymbol("USD")).toBe("$");
  });

  it("returns ¥ for JPY", () => {
    expect(getCurrencySymbol("JPY")).toBe("¥");
  });

  it("returns currency code for unknown", () => {
    expect(getCurrencySymbol("XYZ")).toBe("XYZ");
  });
});

describe("sumByCurrency", () => {
  it("sums items by currency", () => {
    const items = [
      { amount: 4704.05, currency: "USD" },
      { amount: 161.98, currency: "USD" },
      { amount: 207.76, currency: "EUR" },
      { amount: 1036, currency: "EUR" },
      { amount: 920, currency: "GBP" },
    ];
    const totals = sumByCurrency(items);
    expect(totals).toEqual({
      USD: 4866.03,
      EUR: 1243.76,
      GBP: 920,
    });
  });

  it("returns empty object for no items", () => {
    expect(sumByCurrency([])).toEqual({});
  });

  it("handles points alongside cash currencies", () => {
    const items = [
      { amount: 3720.86, currency: "USD" },
      { amount: 318500, currency: "points" },
    ];
    const totals = sumByCurrency(items);
    expect(totals).toEqual({
      USD: 3720.86,
      points: 318500,
    });
  });
});
