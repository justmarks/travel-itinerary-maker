import type { GmailLabel } from "@itinly/shared";

/**
 * Gmail's labels API returns a flat list where nested labels carry
 * their full path in `name` (e.g. `"Travel"` → `"Travel/Hotels"` →
 * `"Travel/Hotels/Confirmed"`). Convert to a sorted, depth-tagged
 * list suitable for rendering as a tree-shaped picker — each entry
 * gets the depth (number of `/` in the path) and the leaf segment
 * of its name so the picker can show "Hotels" indented under
 * "Travel" instead of "Travel/Hotels" repeated everywhere.
 *
 * Sort is alphabetical case-insensitive on the full path, which
 * conveniently lands parents directly before their children
 * ("Travel" < "Travel/Hotels"). System labels are surfaced first
 * — INBOX / STARRED / IMPORTANT etc. are usually what people
 * pick, and Gmail itself shows them at the top.
 */
export interface LabelTreeNode {
  /** Original label record. */
  label: GmailLabel;
  /** Number of `/` separators — 0 for top-level. */
  depth: number;
  /** Last segment of the path — what to show as the option label. */
  leafName: string;
}

export function buildGmailLabelTree(
  labels: readonly GmailLabel[],
): LabelTreeNode[] {
  const sorted = [...labels].sort((a, b) => {
    // System labels first (INBOX, STARRED, etc.) so the most-tapped
    // options aren't buried below user-defined trees.
    if (a.type !== b.type) return a.type === "system" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return sorted.map((label) => {
    const parts = label.name.split("/");
    return {
      label,
      depth: parts.length - 1,
      leafName: parts[parts.length - 1] ?? label.name,
    };
  });
}

/**
 * Friendly display string for a system label. Gmail's API returns
 * them in shouty caps (`INBOX`, `STARRED`); the rest of the app
 * shows them in title-case.
 */
export function prettifySystemLabel(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name.charAt(0) + name.slice(1).toLowerCase();
}

/**
 * Indented option label for a tree node. Two non-breaking spaces
 * (U+00A0) per depth level so the indent survives both `<option>`
 * rendering (regular spaces collapse to a single one) and ShadCN's
 * `SelectItem` (Radix preserves text whitespace in items). Mirrors
 * Gmail's own picker indent style.
 */
export function indentedLabel(node: LabelTreeNode): string {
  const indent = "  ".repeat(node.depth);
  const name =
    node.label.type === "system" && node.depth === 0
      ? prettifySystemLabel(node.leafName)
      : node.leafName;
  return `${indent}${name}`;
}
