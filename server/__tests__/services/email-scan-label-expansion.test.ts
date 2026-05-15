import { expandLabelFilters } from "../../src/services/email-scan-label-expansion";
import type {
  EmailConnector,
  EmailLabel,
} from "../../src/connectors/email-connector";

/**
 * Minimal stub connector — `scanEmails` is never invoked by the
 * helper (only `listLabels`), so we leave it as a never-resolves Promise.
 */
function stubConnector(labels: EmailLabel[] | Error): EmailConnector {
  return {
    listLabels: () =>
      labels instanceof Error ? Promise.reject(labels) : Promise.resolve(labels),
    scanEmails: () => new Promise(() => undefined),
  };
}

const LABELS: EmailLabel[] = [
  { id: "INBOX", name: "INBOX", type: "system" },
  { id: "Label_10", name: "Travel", type: "user" },
  { id: "Label_11", name: "Travel/Hotels", type: "user" },
  { id: "Label_12", name: "Travel/Flights", type: "user" },
  { id: "Label_13", name: "Travel/Flights/Confirmed", type: "user" },
  { id: "Label_20", name: "Receipts", type: "user" },
];

describe("expandLabelFilters", () => {
  it("returns [undefined] when labelFilter is unset", async () => {
    const got = await expandLabelFilters({
      connector: stubConnector(LABELS),
      labelFilter: undefined,
      includeSublabels: true,
    });
    expect(got).toEqual([undefined]);
  });

  it("returns [labelFilter] verbatim when includeSublabels is false", async () => {
    const got = await expandLabelFilters({
      connector: stubConnector(LABELS),
      labelFilter: "Label_10",
      includeSublabels: false,
    });
    expect(got).toEqual(["Label_10"]);
  });

  it("expands descendant ids when input matched on id (schedule path)", async () => {
    const got = await expandLabelFilters({
      connector: stubConnector(LABELS),
      labelFilter: "Label_10",
      includeSublabels: true,
    });
    expect(got.sort()).toEqual(["Label_10", "Label_11", "Label_12", "Label_13"].sort());
  });

  it("expands descendant names when input matched on name (manual dialog path)", async () => {
    const got = await expandLabelFilters({
      connector: stubConnector(LABELS),
      labelFilter: "Travel",
      includeSublabels: true,
    });
    expect(got.sort()).toEqual(
      ["Travel", "Travel/Flights", "Travel/Flights/Confirmed", "Travel/Hotels"].sort(),
    );
  });

  it("only widens descendants that share the full segment prefix", async () => {
    // `Travelers` would naively match `startsWith("Travel")` — confirm
    // it stays out because the prefix check is `"Travel/"`, not
    // `"Travel"`.
    const labels = [
      ...LABELS,
      { id: "Label_30", name: "Travelers", type: "user" } as EmailLabel,
    ];
    const got = await expandLabelFilters({
      connector: stubConnector(labels),
      labelFilter: "Label_10",
      includeSublabels: true,
    });
    expect(got).not.toContain("Label_30");
  });

  it("falls back to the original labelFilter when the parent is gone", async () => {
    const got = await expandLabelFilters({
      connector: stubConnector(LABELS),
      labelFilter: "Label_404",
      includeSublabels: true,
    });
    expect(got).toEqual(["Label_404"]);
  });

  it("falls back to the original labelFilter when listLabels throws", async () => {
    const got = await expandLabelFilters({
      connector: stubConnector(new Error("network blip")),
      labelFilter: "Label_10",
      includeSublabels: true,
    });
    expect(got).toEqual(["Label_10"]);
  });
});
