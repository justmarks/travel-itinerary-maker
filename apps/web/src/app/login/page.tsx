"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getSupabaseClient } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { AppWordmark } from "@/components/app-wordmark";
import { AlertCircle, Info, Sparkles } from "lucide-react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

// True when the bundle was built without `NEXT_PUBLIC_API_URL` and the
// browser is loading from somewhere other than localhost — i.e. this is
// a deployed site running with the dev fallback baked in. The build-time
// guard in `next.config.ts` blocks this on Vercel, so we only land here
// on self-hosted / non-Vercel deploys, but the banner copy still needs
// to point at the real cause instead of "no API server detected".
function isBuildTimeApiMisconfig(): boolean {
  if (typeof window === "undefined") return false;
  if (!/^https?:\/\/localhost(?::\d+)?(?:\/|$)/.test(API_BASE_URL)) return false;
  const host = window.location.hostname;
  return host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]";
}

export default function LoginPage(): React.JSX.Element {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const [loginError, setLoginError] = useState<string | null>(null);
  const [apiAvailable, setApiAvailable] = useState<boolean | null>(null);
  const [buildMisconfig, setBuildMisconfig] = useState(false);

  // Check if the API server is reachable on mount. Skip the probe entirely
  // when the bundle is misconfigured — hitting localhost from a deployed
  // origin always fails with ERR_CONNECTION_REFUSED, and surfacing that
  // failure as "no API server detected" hides the actual cause.
  useEffect(() => {
    if (isBuildTimeApiMisconfig()) {
      setBuildMisconfig(true);
      setApiAvailable(false);
      return;
    }
    const controller = new AbortController();
    fetch(`${API_BASE_URL.replace(/\/api\/v1$/, "")}/health`, {
      signal: controller.signal,
    })
      .then((res) => setApiAvailable(res.ok))
      .catch(() => setApiAvailable(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    // Note: we intentionally do NOT redirect when isDemo flips to true here.
    // The "Try with demo data" button is a plain anchor that does a hard
    // navigation, so the destination page mounts fresh with ?demo=true in
    // the URL from the start. Redirecting here would race against that
    // hard nav and cause a flicker through several intermediate routes.
    if (!isLoading && isAuthenticated) {
      router.replace("/");
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="w-full max-w-sm space-y-8 text-center">
        <div>
          {/* Tab order: skip the wordmark so the first Tab lands on the
              primary CTA (Sign in with Google). Mouse users can still click
              it to go to /welcome. */}
          <Link
            href="/welcome"
            aria-label="itinly home"
            tabIndex={-1}
            className="inline-block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <AppWordmark className="mx-auto mb-3 h-16" />
          </Link>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to manage your travel itineraries
          </p>
        </div>
        {loginError && (
          <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-left text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{loginError}</span>
          </div>
        )}
        {apiAvailable === false && !loginError && (
          <div className="flex items-start gap-3 rounded-md border border-border bg-muted/50 p-3 text-left text-sm text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {buildMisconfig ? (
                <>
                  This deployment is misconfigured: the build did not
                  receive a <code>NEXT_PUBLIC_API_URL</code>, so the
                  bundle is pointed at <code>http://localhost:3001</code>.
                  Try the demo below, or contact the site owner to set
                  the variable and redeploy.
                </>
              ) : (
                <>
                  No API server detected. Sign-in requires a running
                  backend. You can still explore the app with demo data
                  below.
                </>
              )}
            </span>
          </div>
        )}
        {/*
          Both Google and Microsoft sign-in route through Supabase
          Auth. The provider does the OAuth dance and bounces the
          user back to `/auth/callback`, where the callback page
          sets up the session and POSTs the provider tokens to
          /api/v1/connections.
        */}
        <Button
          size="lg"
          className="w-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          disabled={apiAvailable === false}
          onClick={async () => {
            setLoginError(null);
            try {
              const supabase = getSupabaseClient();
              if (!supabase) {
                setLoginError("Sign-in is not configured.");
                return;
              }
              const { error } = await supabase.auth.signInWithOAuth({
                provider: "google",
                options: {
                  redirectTo: `${window.location.origin}/auth/callback`,
                  // Minimum scope set: identity only. Mail / Calendar
                  // capabilities are granted on-demand via the
                  // explicit Connect buttons on /settings/account so
                  // we don't ask for permissions until the user has
                  // signalled they want the feature.
                  //
                  // `prompt=select_account` forces Google to show the
                  // account picker rather than auto-signing in with
                  // whichever account is currently active in the
                  // browser. Users with multiple Google accounts
                  // otherwise have no way to choose between them on
                  // the sign-in screen.
                  queryParams: {
                    prompt: "select_account",
                  },
                },
              });
              if (error) throw error;
              // Supabase fires the redirect; nothing else to do.
            } catch (err) {
              setLoginError(
                err instanceof Error ? err.message : "Sign-in is not configured.",
              );
            }
          }}
        >
          <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            />
            <path
              fill="currentColor"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="currentColor"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="currentColor"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Sign in with Google
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="w-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          disabled={apiAvailable === false}
          onClick={async () => {
            setLoginError(null);
            try {
              const supabase = getSupabaseClient();
              if (!supabase) {
                setLoginError("Sign-in is not configured.");
                return;
              }
              const { error } = await supabase.auth.signInWithOAuth({
                // "azure" is the Supabase identifier for the
                // Microsoft / Azure AD provider — they registered it
                // before "microsoft" was a common alias.
                provider: "azure",
                options: {
                  redirectTo: `${window.location.origin}/auth/callback`,
                  // `offline_access` is required to receive a
                  // refresh token from Microsoft; the Azure app
                  // registration must include it in delegated
                  // permissions (see docs/supabase-auth-setup.md).
                  // `User.Read` is the Microsoft Graph delegated
                  // permission needed for `/me/photo/$value` (the
                  // profile photo fetch in `lib/auth.tsx`). Default
                  // Azure app registrations include it as a delegated
                  // permission, so users see no extra consent prompt.
                  //
                  // Mail.Read / Calendars.ReadWrite are NOT requested
                  // here — the user hasn't asked for those features
                  // yet. Connect buttons on /settings/account gate
                  // those scope grants so we never ask for permissions
                  // until the user has signalled they want the feature.
                  scopes: "openid email profile offline_access User.Read",
                  // `prompt=select_account` forces Microsoft to show
                  // the account picker rather than silently signing
                  // the user in with whichever account is currently
                  // active in the browser. Users with multiple work /
                  // personal Microsoft accounts otherwise have no way
                  // to choose between them on the sign-in screen.
                  queryParams: {
                    prompt: "select_account",
                  },
                },
              });
              if (error) throw error;
            } catch (err) {
              setLoginError(
                err instanceof Error
                  ? err.message
                  : "Sign-in is not configured.",
              );
            }
          }}
        >
          <svg className="mr-2 h-5 w-5" viewBox="0 0 23 23">
            <path fill="#f25022" d="M1 1h10v10H1z" />
            <path fill="#7fba00" d="M12 1h10v10H12z" />
            <path fill="#00a4ef" d="M1 12h10v10H1z" />
            <path fill="#ffb900" d="M12 12h10v10H12z" />
          </svg>
          Sign in with Microsoft
        </Button>
        {/*
          Plain <a> tag (not next/link) on purpose: we want a full page
          reload so the next page mounts with ?demo=true in the URL from
          the start, avoiding any RequireAuth → /login → / flicker loop.
          Relative href stays out of @next/next/no-html-link-for-pages.

          Pill + Sparkles + "Try the demo" copy mirrors /m/login so the
          two surfaces don't diverge on demo-entry affordance.
        */}
        <a
          href="../?demo=true"
          className="flex h-10 w-full items-center justify-center gap-1.5 rounded-md border bg-background text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Sparkles className="h-4 w-4" />
          Try the demo
        </a>
      </div>
    </main>
  );
}
