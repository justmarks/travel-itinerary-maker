"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { consumeOAuthState, getRedirectUri } from "@/lib/oauth";
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
    const state = url.searchParams.get("state");
    const errorParam = url.searchParams.get("error");

    const { expectedState, returnTo } = consumeOAuthState();

    if (errorParam) {
      setError(
        errorParam === "access_denied"
          ? "Sign-in was cancelled."
          : `Google returned an error: ${errorParam}`,
      );
      return;
    }
    if (!code) {
      setError("No authorization code received from Google.");
      return;
    }
    if (!state || state !== expectedState) {
      setError(
        "Sign-in could not be verified (state mismatch). Please try again.",
      );
      return;
    }

    void (async () => {
      try {
        await login(code, getRedirectUri());
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
