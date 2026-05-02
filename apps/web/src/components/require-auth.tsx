"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useDemoMode } from "@/lib/demo";

/**
 * Wraps children and redirects unauthenticated users away. Defaults to
 * `/login` (or `/m/login` for mobile routes); pass `redirectTo` to send
 * users somewhere else (e.g. a marketing page).
 *
 * In demo mode (?demo=true), auth is bypassed entirely.
 */
export function RequireAuth({
  children,
  redirectTo,
}: {
  children: React.ReactNode;
  redirectTo?: string;
}): React.JSX.Element | null {
  const isDemo = useDemoMode();
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const isMobileRoute = pathname?.startsWith("/m") ?? false;

  useEffect(() => {
    if (!isDemo && !isLoading && !isAuthenticated) {
      const fallback =
        redirectTo ?? (isMobileRoute ? "/m/login" : "/login");
      router.replace(fallback);
    }
  }, [isDemo, isAuthenticated, isLoading, isMobileRoute, redirectTo, router]);

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
