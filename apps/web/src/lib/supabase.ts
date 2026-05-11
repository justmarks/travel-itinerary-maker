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
 * Storage: we use `createClient` from `@supabase/supabase-js` (not
 * `createBrowserClient` from `@supabase/ssr`) so the PKCE code
 * verifier lands in `localStorage`. The SSR helper is designed for
 * Next.js apps with a *server-side* `/auth/callback` route handler
 * that reads the verifier from cookies — we deliberately keep the
 * callback as a client component (`/auth/callback/page.tsx`) so the
 * whole auth flow stays in the browser, no API token ever needs to
 * round-trip through a Next.js server handler. Cookies + a client-
 * side exchange don't mix reliably (the verifier ends up missing
 * from `localStorage`, the SDK throws "PKCE code verifier not found
 * in storage", sign-in fails). `localStorage` round-trips cleanly
 * across the OAuth redirect because we initiate and complete on the
 * same origin.
 *
 * Flow type: PKCE. `detectSessionInUrl: true` lets the SDK auto-
 * process the `?code=...` on `/auth/callback` mount; the callback
 * page also calls `exchangeCodeForSession` explicitly as a fallback
 * for the case where auto-detect has already raced ahead.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

  cached = createClient(url, anonKey, {
    auth: {
      flowType: "pkce",
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
