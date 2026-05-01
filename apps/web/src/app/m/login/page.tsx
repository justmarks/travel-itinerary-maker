"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { startGoogleSignIn } from "@/lib/oauth";
import { useDemoMode } from "@/lib/demo";
import { MobileFrame } from "@/components/mobile/mobile-shell";
import { AppWordmark } from "@/components/app-wordmark";
import { AlertCircle, Info, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

export default function MobileLoginPage(): React.JSX.Element {
  const { isAuthenticated, isLoading } = useAuth();
  const isDemo = useDemoMode();
  const router = useRouter();
  const [loginError, setLoginError] = useState<string | null>(null);
  const [apiAvailable, setApiAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE_URL.replace(/\/api\/v1$/, "")}/health`, {
      signal: controller.signal,
    })
      .then((res) => setApiAvailable(res.ok))
      .catch(() => setApiAvailable(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace("/m");
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return (
      <MobileFrame>
        <div className="flex flex-1 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      </MobileFrame>
    );
  }

  return (
    <MobileFrame>
      <div className="flex flex-1 flex-col px-6 pb-10 pt-16">
        <div className="flex flex-col items-center text-center">
          <AppWordmark className="h-16" />
          <p className="mt-3 text-sm text-muted-foreground">
            Your trips, in your pocket.
          </p>
        </div>

        <div className="mt-12 flex flex-col gap-3">
          {loginError && (
            <div className="flex items-start gap-3 rounded-xl border border-destructive/50 bg-destructive/10 p-3 text-left text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{loginError}</span>
            </div>
          )}
          {apiAvailable === false && !loginError && !isDemo && (
            <div className="flex items-start gap-3 rounded-xl border bg-muted/50 p-3 text-left text-sm text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                No API server detected. Sign-in needs a backend — try demo
                mode below.
              </span>
            </div>
          )}

          <button
            type="button"
            disabled={apiAvailable === false}
            onClick={() => {
              setLoginError(null);
              try {
                startGoogleSignIn("/m");
              } catch (err) {
                setLoginError(
                  err instanceof Error ? err.message : "Sign-in is not configured.",
                );
              }
            }}
            className={cn(
              "flex h-12 w-full items-center justify-center gap-2 rounded-full bg-foreground text-base font-semibold text-background transition-opacity",
              "active:opacity-90 disabled:opacity-40",
            )}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
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
          </button>

          {/*
            Hard <a> with relative href so the destination mounts fresh with
            ?demo=true in the URL — same pattern as the desktop login.
          */}
          <a
            href="../m/?demo=true"
            className="flex h-11 w-full items-center justify-center gap-1.5 rounded-full border bg-background text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <Sparkles className="h-4 w-4" />
            Try the demo
          </a>
        </div>

        <div className="mt-auto pt-12 text-center">
          <a
            href="../?desktop=1"
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            Use desktop site instead
          </a>
        </div>
      </div>
    </MobileFrame>
  );
}
