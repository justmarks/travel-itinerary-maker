"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useDemoMode } from "@/lib/demo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogIn, LogOut, Monitor, User } from "lucide-react";

const DESKTOP_OVERRIDE_KEY = "travel-app-prefer-desktop";

export function MobileUserMenu(): React.JSX.Element {
  const { user, isAuthenticated, logout } = useAuth();
  const isDemo = useDemoMode();
  const router = useRouter();

  const handleSwitchToDesktop = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem(DESKTOP_OVERRIDE_KEY, "1");
    }
    router.replace("/");
  };

  // In demo mode without auth, show a sign-in shortcut.
  if (isDemo && (!isAuthenticated || !user)) {
    return (
      <Link
        href="/m/login"
        className="flex h-9 items-center gap-1.5 rounded-full border bg-background px-3 text-sm font-medium"
      >
        <LogIn className="h-4 w-4" />
        Sign in
      </Link>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <button
        type="button"
        onClick={handleSwitchToDesktop}
        title="Use desktop site"
        className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
      >
        <Monitor className="h-4 w-4" />
      </button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted"
          aria-label="Account menu"
        >
          {user.picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.picture}
              alt=""
              className="h-7 w-7 rounded-full"
              referrerPolicy="no-referrer"
            />
          ) : (
            <User className="h-4 w-4" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5 text-sm">
          <p className="truncate font-medium">{user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSwitchToDesktop}>
          <Monitor className="mr-2 h-4 w-4" />
          Use desktop site
        </DropdownMenuItem>
        <DropdownMenuItem onClick={logout}>
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
        {process.env.NEXT_PUBLIC_APP_VERSION && (
          <div className="mt-1 border-t border-border px-2 py-1 text-[10px] text-muted-foreground/60">
            v{process.env.NEXT_PUBLIC_APP_VERSION}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
