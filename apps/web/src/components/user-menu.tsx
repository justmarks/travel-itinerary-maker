"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useDemoMode } from "@/lib/demo";
import { clearDesktopOverride } from "@/lib/mobile-redirect";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggleMenu } from "@/components/theme-toggle";
import { NotificationToggleMenu } from "@/components/notification-toggle";
import { AutoShareRulesDialog } from "@/components/auto-share-rules-panel";
import { UserAvatar } from "@/components/user-avatar";
import { LogIn, LogOut, Repeat, Smartphone, UserCog } from "lucide-react";

export function UserMenu(): React.JSX.Element | null {
  const { user, isAuthenticated, logout } = useAuth();
  const isDemo = useDemoMode();
  const router = useRouter();
  const [autoShareOpen, setAutoShareOpen] = useState(false);

  // Clears the persisted "prefer desktop" flag and routes to the mobile
  // site. Without this clear, the mobile-home redirect would bounce the
  // user straight back to /.
  const handleSwitchToMobile = () => {
    clearDesktopOverride();
    router.push(isDemo ? "/m?demo=true" : "/m");
  };

  // In demo mode without auth, show a "Sign in" button
  if (isDemo && (!isAuthenticated || !user)) {
    return (
      <Link href="/login">
        <Button variant="outline" size="sm" className="gap-2">
          <LogIn className="h-4 w-4" />
          <span className="hidden sm:inline">Sign in</span>
        </Button>
      </Link>
    );
  }

  if (!isAuthenticated || !user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <UserAvatar
            picture={user.picture}
            name={user.name}
            email={user.email}
            size="sm"
          />
          <span className="hidden sm:inline">{user.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <div className="px-2 py-1.5 text-sm text-muted-foreground">
          {user.email}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSwitchToMobile}>
          <Smartphone className="mr-2 h-4 w-4" />
          Use mobile site
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setAutoShareOpen(true)}>
          <Repeat className="mr-2 h-4 w-4" />
          Auto-share…
        </DropdownMenuItem>
        <NotificationToggleMenu />
        <ThemeToggleMenu />
        <DropdownMenuItem asChild>
          <Link href="/settings/account">
            <UserCog className="mr-2 h-4 w-4" />
            Account
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={logout}>
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
        {process.env.NEXT_PUBLIC_APP_VERSION && (
          <Link
            href="/release-notes"
            className="mt-1 block border-t border-border px-2 py-1 text-[10px] text-muted-foreground/60 hover:text-foreground"
          >
            v{process.env.NEXT_PUBLIC_APP_VERSION} — release notes
          </Link>
        )}
      </DropdownMenuContent>
      <AutoShareRulesDialog open={autoShareOpen} onOpenChange={setAutoShareOpen} />
    </DropdownMenu>
  );
}
