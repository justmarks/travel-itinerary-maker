"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import {
  consumeOAuthState,
  decodeState,
  getOAuthRedirectUri,
  isAllowlistedRelayOrigin,
} from "@/lib/oauth";
import { AppLogo } from "@/components/app-logo";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

export default function AuthCallbackPage(): React.JSX.Element {
  const router = useRouter();
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const rawState = url.searchParams.get("state");
    const errorParam = url.searchParams.get("error");

    if (errorParam) {
      setError(
        errorParam === "access_denied"
          ? "Sign-in was cancelled."
          : `Google returned an error: ${errorParam}`,
      );
      return;
    }
    if (!rawState) {
      setError("Sign-in could not be verified (missing state).");
      return;
    }
    const decoded = decodeState(rawState);
    if (!decoded) {
      setError(
        "Sign-in could not be verified (state could not be decoded). Please try again.",
      );
      return;
    }

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
      // Forward the original query string verbatim so the preview's
      // callback sees exactly what Google would have sent it.
      target.search = url.search;
      window.location.replace(target.toString());
      return;
    }

    // Local-completion branch: state.origin matches us, so this is
    // either prod completing its own sign-in, localhost completing its
    // own, or a preview that just got bounced back through the relay.
    const { expectedCsrf, returnTo } = consumeOAuthState();

    if (!code) {
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
        // The redirect URI sent to the backend MUST match what Google
        // saw — for previews that's the prod callback, not self.
        await login(code, getOAuthRedirectUri());
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
  }, [login, router]);

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
