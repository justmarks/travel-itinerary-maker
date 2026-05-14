/**
 * Provider-agnostic errors thrown by `EmailConnector` /
 * `CalendarConnector` implementations. Phase 4 of the migration
 * plan introduced these so route handlers can branch on the SHAPE
 * of the failure rather than `if (err.status === 401 || err.status === 403)`
 * which leaks Gmail's `GaxiosError` / Graph's `GraphError` taxonomy
 * into every route.
 *
 * Today only `InvalidAuthError` exists — connectors rethrow native
 * 401/403 errors as `InvalidAuthError` so any caller can do
 * `instanceof InvalidAuthError` to decide between "prompt re-link"
 * vs "log + retry."
 */

/**
 * Thrown when the provider rejected our access token. Routes catch
 * this to emit a stable `EMAIL_NOT_CONNECTED` / `CALENDAR_AUTH_FAILED`
 * code that the frontend uses to reroute the user to
 * /settings/account.
 */
export class InvalidAuthError extends Error {
  constructor(
    /** Provider HTTP status — 401 or 403 in practice. */
    public readonly status: number,
    message: string,
    /** Original native error (`GaxiosError`, `GraphError`, …) so
     *  diagnostic logging can reach the provider-specific fields. */
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "InvalidAuthError";
  }
}

/**
 * Returns true when `err` carries an HTTP status that means the
 * provider rejected our credentials. Shared by both connectors'
 * catch blocks so the auth-failure classification stays in one
 * place — adding a new auth-failure status (e.g. Microsoft's
 * `invalid_grant`) is a single edit here.
 */
export function isAuthFailureStatus(status: number | undefined): boolean {
  return status === 401 || status === 403;
}
