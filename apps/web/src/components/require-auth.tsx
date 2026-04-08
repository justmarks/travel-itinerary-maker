"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

/**
 * Wraps children and redirects to /login if the user is not authenticated.
 * In demo mode, auth is bypassed entirely.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!IS_DEMO && !isLoading && !isAuthenticated) {
      router.replace("/login");
    }
  }, [isAuthenticated, isLoading, router]);

  if (IS_DEMO) return <>{children}</>;

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
