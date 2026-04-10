"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useGoogleLogin } from "@react-oauth/google";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Plane, AlertCircle, Info } from "lucide-react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

export default function LoginPage() {
  const { isAuthenticated, isLoading, login } = useAuth();
  const router = useRouter();
  const [loginError, setLoginError] = useState<string | null>(null);
  const [apiAvailable, setApiAvailable] = useState<boolean | null>(null);

  // Check if the API server is reachable on mount
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE_URL.replace(/\/api\/v1$/, "")}/health`, {
      signal: controller.signal,
    })
      .then((res) => setApiAvailable(res.ok))
      .catch(() => setApiAvailable(false));
    return () => controller.abort();
  }, []);

  const googleLogin = useGoogleLogin({
    flow: "auth-code",
    onSuccess: async (response) => {
      setLoginError(null);
      try {
        await login(response.code);
        router.replace("/");
      } catch (err) {
        console.error("Login failed:", err);
        if (err instanceof TypeError && err.message === "Failed to fetch") {
          setLoginError(
            "Unable to reach the API server. Sign-in requires a running backend — try demo mode instead, or run the server locally.",
          );
        } else {
          setLoginError(
            err instanceof Error ? err.message : "Login failed. Please try again.",
          );
        }
      }
    },
    onError: (error) => {
      console.error("Google login error:", error);
      setLoginError("Google sign-in was cancelled or failed. Please try again.");
    },
    scope: "openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.readonly",
  });

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
          <Plane className="mx-auto mb-4 h-12 w-12" />
          <h1 className="text-2xl font-bold">Travel Itinerary Maker</h1>
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
              No API server detected. Sign-in requires a running backend.
              You can still explore the app with demo data below.
            </span>
          </div>
        )}
        <Button
          size="lg"
          className="w-full"
          disabled={apiAvailable === false}
          onClick={() => {
            setLoginError(null);
            googleLogin();
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
        {/*
          Plain <a> tag (not next/link) on purpose: we want a full page
          reload so the next page mounts with ?demo=true in the URL from
          the start, avoiding any RequireAuth → /login → / flicker loop.
          Relative href "../?demo=true" works in both dev and the GitHub
          Pages build (which uses basePath=/travel-itinerary-maker).
        */}
        <a
          href="../?demo=true"
          className="block text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Try with demo data
        </a>
      </div>
    </main>
  );
}
