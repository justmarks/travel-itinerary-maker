/**
 * Singleton Supabase browser client. Phase 3b of the Drive→Supabase
 * migration: the frontend's identity layer.
 *
 * Reads from `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
 * — inlined into the static bundle at build time. Returns `null` when
 * either var is missing so callers can gracefully fall back to the
 * legacy Google OAuth flow (which is still wired up alongside while
 * this rolls out). Once the legacy flow is removed in the cleanup PR,
 * the missing-env case should become a build-time failure like the
 * other `NEXT_PUBLIC_*` guards in `next.config.ts`.
 *
 * Session persistence: Supabase stores the user session in
 * localStorage by default. The `flowType: "pkce"` setting picks the
 * OAuth flow that doesn't require a server-side code exchange — the
 * client receives the access + refresh tokens directly after the
 * provider callback, which matches what the existing custom flow's
 * `/auth/callback` page expects (it's a client-side page already).
 */
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

export function getSupabaseClient(): SupabaseClient | null {
  // Memoise: every call after the first returns the cached instance
  // (or cached null if env vars are unset). Avoids constructing
  // multiple clients across re-renders, which the Supabase SDK
  // warns about loudly in dev.
  if (cached !== undefined) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    cached = null;
    return null;
  }

  cached = createBrowserClient(url, anonKey, {
    auth: {
      flowType: "pkce",
      // Persist across tabs/devices. localStorage matches how the
      // legacy auth state is already persisted, so users don't see
      // a behavioural regression on the storage front.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  return cached;
}

/**
 * Pulls the Authorization-header value for the current session.
 * Returns null when not signed in OR when Supabase isn't configured.
 * Cheap helper used by the API client to thread the JWT into
 * outgoing requests.
 */
export async function getSupabaseAccessToken(): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Returns whether the Supabase client is configured for this build.
 * Lets UI components gate on Supabase being available before showing
 * the new sign-in providers — falls through to the legacy Google flow
 * when not.
 */
export function isSupabaseConfigured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
