"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { useAuth } from "@/lib/auth";
import {
  consumeOAuthState,
  decodeState,
  getOAuthRedirectUri,
  isAllowlistedRelayOrigin,
} from "@/lib/oauth";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";
import { AppLogo } from "@/components/app-logo";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

/**
 * Best-effort POST of the user's identity connection to the server.
 * Captures the provider tokens from the Supabase session so the
 * server can call Gmail / Calendar / Outlook on their behalf later
 * (phase 4 connectors). Identity-only sign-ins still create a row
 * with no refresh token — the row's presence is what tells the
 * server "this user has linked Google/Microsoft," even before any
 * mailbox or calendar scope is granted.
 *
 * Failure is non-fatal: the user is still authenticated via the
 * Supabase JWT, so we let them into the app and let the next
 * settings-page visit or feature-gate re-trigger the link.
 */
async function syncIdentityConnection(session: Session): Promise<void> {
  const provider = session.user.app_metadata?.provider;
  // Supabase reports Microsoft as "azure"; normalise to our taxonomy.
  const normalisedProvider =
    provider === "azure"
      ? "microsoft"
      : provider === "google"
        ? "google"
        : null;
  if (!normalisedProvider) return;
  const email = session.user.email;
  if (!email) return;

  const body = {
    provider: normalisedProvider,
    capability: "identity" as const,
    accountEmail: email,
    // provider_token = the underlying Google/Microsoft access token.
    // Only present immediately post-sign-in; Supabase doesn't store
    // it persistently after the next session refresh (unless the
    // provider returned a refresh token too). That's fine for
    // identity — we capture what we have and the server treats
    // missing tokens as "no capability beyond identity yet".
    accessToken: session.provider_token ?? undefined,
    refreshToken: session.provider_refresh_token ?? undefined,
  };

  try {
    await fetch(`${API_BASE_URL}/connections`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    // Best-effort; see function-level comment.
  }
}

export default function AuthCallbackPage(): React.JSX.Element {
  const router = useRouter();
  const { login, linkGmail } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const rawState = url.searchParams.get("state");
    const errorParam = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    if (errorParam) {
      setError(
        errorParam === "access_denied"
          ? "Sign-in was cancelled."
          : errorDescription || `Provider returned an error: ${errorParam}`,
      );
      return;
    }

    // Discriminator between the legacy custom Google flow and the new
    // Supabase flow: the legacy flow ships a base64-encoded JSON state
    // we control; Supabase ships its own opaque state. Try to decode
    // first — if it parses, route to legacy; else assume Supabase.
    const legacyState = rawState ? decodeState(rawState) : null;

    if (legacyState) {
      handleLegacyCallback(legacyState, code, url);
      return;
    }

    if (!isSupabaseConfigured()) {
      setError("Sign-in could not be verified (missing state).");
      return;
    }

    void (async () => {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setError("Sign-in is not configured.");
        return;
      }
      try {
        // The SDK has `detectSessionInUrl: false` (see lib/supabase.ts)
        // so this page is the *only* path that consumes the PKCE code.
        // Belt-and-braces: if a prior tab already exchanged (e.g. the
        // user opened the callback URL twice), `getSession` returns
        // the existing session and we skip the second exchange —
        // which would fail with "PKCE code verifier not found in
        // storage" because the verifier is single-use.
        let session: Session | null;
        const { data: existing } = await supabase.auth.getSession();
        session = existing.session;
        if (!session && code) {
          const { data, error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
          session = data.session;
        }
        if (!session) {
          setError(
            "Sign-in could not be completed. The provider redirect did not return a session.",
          );
          return;
        }
        await syncIdentityConnection(session);
        router.replace("/");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Sign-in failed.");
      }
    })();

    function handleLegacyCallback(
      decoded: NonNullable<ReturnType<typeof decodeState>>,
      legacyCode: string | null,
      legacyUrl: URL,
    ): void {
      // Relay branch: this deployment is acting as the OAuth proxy for a
      // preview deployment. Don't touch sessionStorage here — the
      // preview owns the CSRF token. Just validate the target origin and
      // bounce the code + state through unchanged.
      if (decoded.origin !== window.location.origin) {
        if (!isAllowlistedRelayOrigin(decoded.origin)) {
          setError(
            "Sign-in could not be verified (untrusted relay target). Please try again.",
          );
          return;
        }
        const target = new URL("/auth/callback", decoded.origin);
        target.search = legacyUrl.search;
        window.location.replace(target.toString());
        return;
      }

      const { expectedCsrf, returnTo } = consumeOAuthState();
      if (!legacyCode) {
        setError("No authorization code received from Google.");
        return;
      }
      if (!expectedCsrf || decoded.csrf !== expectedCsrf) {
        setError(
          "Sign-in could not be verified (state mismatch). Please try again.",
        );
        return;
      }
      void (async () => {
        try {
          const redirectUri = getOAuthRedirectUri();
          const flow = decoded.flow ?? "primary";
          if (flow === "gmail") {
            await linkGmail(legacyCode, redirectUri);
          } else {
            await login(legacyCode, redirectUri);
          }
          router.replace(returnTo);
        } catch (err) {
          if (err instanceof TypeError && err.message === "Failed to fetch") {
            setError(
              "Unable to reach the API server. Sign-in requires a running backend.",
            );
          } else {
            setError(err instanceof Error ? err.message : "Sign-in failed.");
          }
        }
      })();
    }
  }, [login, linkGmail, router]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-6 text-center">
          <AppLogo className="mx-auto h-12 w-12" />
          <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-left text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
          <Button onClick={() => router.replace("/login")}>
            Back to sign-in
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="flex items-center gap-3 text-muted-foreground">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        <span>Completing sign-in…</span>
      </div>
    </main>
  );
}
