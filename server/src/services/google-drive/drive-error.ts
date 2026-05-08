/**
 * Google API "insufficient scope" detector.
 *
 * The googleapis library throws a `GaxiosError` whose shape varies by
 * call path: sometimes the HTTP status is on `err.code`, sometimes on
 * `err.status`, sometimes on `err.response.status`. The error body
 * also carries an `errors` array whose entries can have a `reason` of
 * `insufficientPermissions` (Drive's classic 403) or `insufficientScopes`
 * (newer surfaces). We accept any of those signals so a user who signed
 * in but unticked Drive on the consent screen lands in the
 * `DRIVE_SCOPE_REQUIRED` branch instead of a generic 500.
 *
 * Mirrors the looser `message.includes("insufficient")` check the email
 * routes already use, but tightened to status-403 to avoid false
 * positives on unrelated errors that happen to mention the word.
 */
export function isInsufficientScopeError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    code?: number | string;
    status?: number | string;
    response?: { status?: number };
    errors?: Array<{ reason?: string }>;
    message?: string;
  };

  const rawStatus = e.code ?? e.status ?? e.response?.status;
  const status =
    typeof rawStatus === "number"
      ? rawStatus
      : typeof rawStatus === "string"
        ? Number.parseInt(rawStatus, 10)
        : undefined;

  if (Array.isArray(e.errors)) {
    for (const item of e.errors) {
      const reason = (item?.reason ?? "").toLowerCase();
      if (
        reason === "insufficientpermissions" ||
        reason === "insufficientscopes"
      ) {
        return true;
      }
    }
  }

  if (status === 403) {
    const message = (e.message ?? "").toLowerCase();
    if (message.includes("insufficient") || message.includes("scope")) {
      return true;
    }
  }

  return false;
}
