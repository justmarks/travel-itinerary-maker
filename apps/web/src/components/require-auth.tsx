"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useDemoMode } from "@/lib/demo";

/**
 * Wraps children and redirects to /login if the user is not authenticated.
 * In demo mode (?demo=true), auth is bypassed entirely.
 */
export function RequireAuth({ children }: { children: React.ReactNode }): React.JSX.Element {
  const isDemo = useDemoMode();
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isDemo && !isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isDemo, isAuthenticated, isLoading, router]);

  if (isDemo) return <>{children}</>;

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </main>
    );
  }

  if (!isAuthenticated) return null;

  return <>{children}</>;
}
