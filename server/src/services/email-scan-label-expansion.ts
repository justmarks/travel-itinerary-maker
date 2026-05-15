/**
 * Sublabel / subfolder expansion for email scans.
 *
 * Gmail labels are flat with `/` as the conventional separator
 * (`Travel/Hotels`, `Travel/Flights/Confirmed`); Outlook mail folders
 * follow the same path shape via the connector's `listLabels` adapter.
 * A user who picks "Travel" almost always wants the descendants too,
 * but the underlying mailbox APIs match the literal id only — so the
 * scanner has to expand the picked id into its descendant set.
 *
 * This helper is shared between:
 *   - the scheduled-scan executor (`email-scan-executor.ts`), which
 *     runs once per cron tick per schedule, and
 *   - the manual scan routes (`/emails/scan`, `/emails/scan/stream`)
 *     when the dialog's "include sub-folders / sub-labels" checkbox
 *     is ticked.
 *
 * Failure mode: if `connector.listLabels()` throws (transient API blip,
 * scope revoked mid-flight), the helper logs a warn and falls back to
 * the original `labelFilter` so the scan still completes — a widen
 * shouldn't escalate into a failed run.
 */
import type { EmailConnector } from "../connectors/email-connector";

export interface ExpandLabelFiltersArgs {
  connector: EmailConnector;
  /**
   * The id of the label / folder the user picked. Undefined = "all
   * folders" — there is nothing to expand and the caller should scan
   * once with `labelFilter: undefined`.
   */
  labelFilter: string | undefined;
  /**
   * When false / unset, the helper returns `[labelFilter]` verbatim
   * (no API round-trip to list labels).
   */
  includeSublabels: boolean | undefined;
  /**
   * Prefix used for the warn log when `listLabels()` throws so the
   * Railway log line is greppable next to the calling subsystem's
   * other logs (e.g. `[auto-scan ...]` or `[email-scan ...]`).
   */
  logPrefix?: string;
}

/**
 * Returns the list of label-filter values to scan. Length ≥ 1; the
 * caller should iterate this and merge results by message id so a
 * message tagged under multiple descendants isn't parsed twice.
 *
 * The `undefined` element is preserved so "all folders" maps to a
 * single `scanEmails({ labelFilter: undefined })` call.
 */
export async function expandLabelFilters(
  args: ExpandLabelFiltersArgs,
): Promise<(string | undefined)[]> {
  const { connector, labelFilter, includeSublabels, logPrefix } = args;

  if (!labelFilter || !includeSublabels) {
    return [labelFilter];
  }

  try {
    const labels = await connector.listLabels();
    // The scheduled-scan path stores label ids; the manual scan dialog
    // passes label names. Match on either and return descendants in
    // whatever field the caller matched on so the round-trip through
    // `connector.scanEmails({ labelFilter })` stays consistent with
    // what the caller is already known to send.
    const byId = labels.find((l) => l.id === labelFilter);
    const byName = byId ?? labels.find((l) => l.name === labelFilter);
    const parent = byId ?? byName;
    if (!parent) {
      // Label was renamed / deleted between pick and run. Fall back
      // to the stored value; the connector will surface an empty
      // result if it truly doesn't exist anymore.
      return [labelFilter];
    }
    const matchedById = !!byId;
    const childPrefix = `${parent.name}/`;
    const descendants = labels.filter(
      (l) => l.id === parent.id || l.name.startsWith(childPrefix),
    );
    if (descendants.length === 0) return [labelFilter];
    return matchedById
      ? descendants.map((l) => l.id)
      : descendants.map((l) => l.name);
  } catch (err) {
    console.warn(
      `${logPrefix ?? "[email-scan]"} listLabels failed for sublabel expansion — falling back to parent-only scan:`,
      err,
    );
    return [labelFilter];
  }
}
