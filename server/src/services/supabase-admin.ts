/**
 * Thin wrapper over the Supabase Auth admin REST API. Today it only
 * exposes `deleteUser` — used by the account-deletion endpoint to wipe
 * the Supabase Auth row after the server has dropped every Postgres
 * row owned by that user and revoked their provider refresh tokens.
 *
 * We talk to the admin endpoint directly via `fetch` rather than
 * pulling in `@supabase/supabase-js` so the server keeps its
 * dependency surface small. The endpoint is stable:
 *   DELETE {SUPABASE_URL}/auth/v1/admin/users/{user_id}
 *   apikey: <service-role-key>
 *   Authorization: Bearer <service-role-key>
 *
 * The service-role key is fundamentally different from the anon key
 * shipped to the browser — it bypasses every row-level-security
 * policy and grants admin access to the GoTrue API. Keep it server-
 * side only. Provision via the SUPABASE_SERVICE_ROLE_KEY env var.
 *
 * Construction returns null when either env var is unset so the
 * account-deletion route can skip the Auth-row cleanup gracefully in
 * dev / preview environments that haven't been provisioned with the
 * key. The route still wipes Postgres + revokes upstream tokens —
 * only the Supabase Auth row stays behind, which an operator can
 * delete manually from the Supabase dashboard.
 */

export interface SupabaseAdmin {
  deleteUser(userId: string): Promise<SupabaseAdminResult>;
}

export interface SupabaseAdminResult {
  ok: boolean;
  status: number;
  body?: string;
}

export interface SupabaseAdminOptions {
  supabaseUrl: string;
  serviceRoleKey: string;
}

export function createSupabaseAdmin(
  opts: SupabaseAdminOptions,
): SupabaseAdmin | null {
  if (!opts.supabaseUrl || !opts.serviceRoleKey) return null;
  const base = opts.supabaseUrl.replace(/\/+$/, "");
  const key = opts.serviceRoleKey;
  return {
    async deleteUser(userId: string): Promise<SupabaseAdminResult> {
      const url = `${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`;
      const res = await fetch(url, {
        method: "DELETE",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      });
      // 404 on a second call (user already deleted) is treated as
      // success — the endpoint is idempotent from the caller's POV.
      const ok = res.status === 204 || res.status === 200 || res.status === 404;
      const body = ok ? undefined : await safeReadBody(res);
      return { ok, status: res.status, body };
    },
  };
}

async function safeReadBody(res: Response): Promise<string | undefined> {
  try {
    return await res.text();
  } catch {
    return undefined;
  }
}
