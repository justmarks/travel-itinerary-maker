"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useDemoMode } from "@/lib/demo";

/**
 * Wraps children and redirects to /login if the user is not authenticated.
 * In demo mode (?demo=true), auth is bypassed entirely.
 *
 * Mobile-aware: requests that originate from /m/* routes redirect to the
 * mobile login at /m/login so users keep the mobile chrome rather than
 * bouncing through the desktop login.
 */
export function RequireAuth({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element | null {
  const isDemo = useDemoMode();
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isMobileRoute = pathname?.startsWith("/m") ?? false;

  useEffect(() => {
    if (!isDemo && !isLoading && !isAuthenticated) {
      router.replace(isMobileRoute ? "/m/login" : "/login");
    }
  }, [isDemo, isAuthenticated, isLoading, isMobileRoute, router]);

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
